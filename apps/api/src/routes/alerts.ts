import { Router, Request, Response } from 'express';
import { getDb, AlertRepository } from '@ip-centrum/database';
import { requireRole } from '../middleware/auth';
import { generateId } from '@ip-centrum/shared';

// ─── ALERTS ROUTER ───
export const alertsRouter = Router();

alertsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { acknowledged, severity, type, limit = 50 } = req.query;

    let query = db('alerts').select('*').limit(Number(limit)).orderBy('created_at', 'desc');
    if (acknowledged === 'false') query = query.whereNull('acknowledged_at');
    if (acknowledged === 'true') query = query.whereNotNull('acknowledged_at');
    if (severity) query = query.where('severity', severity as string);
    if (type) query = query.where('type', type as string);

    const alerts = await query;
    res.json({ alerts, count: alerts.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

alertsRouter.post('/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const { decision, notes } = req.body;
    if (!decision) return res.status(400).json({ error: 'Decision required' });

    const repo = new AlertRepository(getDb());
    await repo.acknowledge(req.params.id, req.user!.id, notes || '');

    // Log if this was an override
    if (req.body.overrideClassification) {
      const db = getDb();
      const alert = await db('alerts').where({ id: req.params.id }).first();
      await db('human_overrides').insert({
        id: generateId(),
        alert_id: req.params.id,
        case_id: alert?.case_id,
        agent_id: alert?.agent_id || 'unknown',
        agent_recommendation: alert?.recommended_action || '',
        human_decision: decision,
        classification: req.body.overrideClassification,
        justification: notes || decision,
        overridden_by: req.user!.id,
      });
    }

    res.json({ message: 'Alert acknowledged', decision });
  } catch (err) {
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

alertsRouter.get('/sla-breaches', requireRole('CONTROL_CENTRE_MANAGER', 'ADMIN'), async (_req, res) => {
  try {
    const repo = new AlertRepository(getDb());
    const breaches = await repo.findSlaBreaches();
    res.json({ breaches, count: breaches.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch SLA breaches' });
  }
});
