import { Router, Request, Response } from 'express';
import { getDb } from '@ip-centrum/database';
import { requireRole } from '../middleware/auth';
import { generateId } from '@ip-centrum/shared';

// ─── QUOTES ROUTER ───
export const quotesRouter = Router();

quotesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const quotes = await db('quotes')
      .where(req.user?.clientId ? { client_id: req.user.clientId } : {})
      .orderBy('created_at', 'desc')
      .limit(50);
    res.json({ quotes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

quotesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const quote = await getDb()('quotes').where({ id: req.params.id }).first();
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

quotesRouter.post('/:id/accept', async (req: Request, res: Response) => {
  try {
    await getDb()('quotes').where({ id: req.params.id }).update({ status: 'ACCEPTED' });
    res.json({ message: 'Quote accepted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to accept quote' });
  }
});

// ─── RENEWALS ROUTER ───
export const renewalsRouter = Router();

renewalsRouter.get('/portfolio/:clientId', async (req: Request, res: Response) => {
  try {
    const cases = await getDb()('patent_cases')
      .where({ client_id: req.params.clientId })
      .whereNotNull('renewal_deadline')
      .orderBy('renewal_deadline', 'asc');
    res.json({ portfolio: cases, count: cases.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch renewals portfolio' });
  }
});

renewalsRouter.get('/upcoming', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string || '90');
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + days);

    const renewals = await getDb()('patent_cases')
      .where('renewal_deadline', '<=', deadline)
      .whereNotIn('status', ['COMPLETE', 'ABANDONED'])
      .orderBy('renewal_deadline', 'asc');

    res.json({ renewals, daysThreshold: days });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch upcoming renewals' });
  }
});

// ─── REGULATORY ROUTER ───
export const regulatoryRouter = Router();

regulatoryRouter.get('/changes', async (req: Request, res: Response) => {
  try {
    const { status, source } = req.query;
    let query = getDb()('regulatory_changes').select('*').orderBy('detected_at', 'desc').limit(100);
    if (status) query = query.where('status', status as string);
    if (source) query = query.where('source', source as string);
    const changes = await query;
    res.json({ changes, count: changes.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch regulatory changes' });
  }
});

regulatoryRouter.post(
  '/changes/:id/approve',
  requireRole('LAW_ENGINE_MANAGER', 'ADMIN'),
  async (req: Request, res: Response) => {
    try {
      await getDb()('regulatory_changes').where({ id: req.params.id }).update({
        status: 'APPROVED',
        applied_at: new Date(),
        applied_by: req.user!.id,
      });
      res.json({ message: 'Regulatory change approved and applied to Law Engine' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to approve regulatory change' });
    }
  }
);

regulatoryRouter.post(
  '/changes/:id/reject',
  requireRole('LAW_ENGINE_MANAGER', 'ADMIN'),
  async (req: Request, res: Response) => {
    try {
      await getDb()('regulatory_changes').where({ id: req.params.id }).update({ status: 'REJECTED' });
      res.json({ message: 'Regulatory change rejected' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to reject regulatory change' });
    }
  }
);

// ─── ADMIN ROUTER ───
export const adminRouter = Router();

adminRouter.use(requireRole('ADMIN'));

adminRouter.get('/stats', async (_req, res: Response) => {
  try {
    const db = getDb();
    const [cases, alerts, overrides, leads] = await Promise.all([
      db('patent_cases').count('* as count').first(),
      db('alerts').whereNull('acknowledged_at').count('* as count').first(),
      db('human_overrides').count('* as count').first(),
      db('biz_signal_leads').where({ status: 'NEW' }).count('* as count').first(),
    ]);

    res.json({
      totalCases: Number(cases?.count || 0),
      unacknowledgedAlerts: Number(alerts?.count || 0),
      totalOverrides: Number(overrides?.count || 0),
      newBizLeads: Number(leads?.count || 0),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

adminRouter.get('/audit-log', async (req: Request, res: Response) => {
  try {
    const logs = await getDb()('agent_audit_log')
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(parseInt(req.query.limit as string || '100'))
      .offset(parseInt(req.query.offset as string || '0'));
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

adminRouter.get('/biz-leads', async (_req, res: Response) => {
  try {
    const leads = await getDb()('biz_signal_leads')
      .orderBy('created_at', 'desc')
      .limit(100);
    res.json({ leads });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});
