import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb, PatentCaseRepository } from '@ip-centrum/database';
import { getEventBus } from '@ip-centrum/event-bus';
import { EVENTS, generateId, generateCorrelationId } from '@ip-centrum/shared';
import { requireRole } from '../middleware/auth';

export const casesRouter = Router();

const CreateCaseSchema = z.object({
  epNumber: z.string().regex(/^EP\d{7,8}(A\d|B\d)?$/i, 'Invalid EP number format'),
  targetStates: z.array(z.string().length(2)).min(1),
  pathway: z.enum(['CLASSICAL', 'UNITARY', 'HYBRID']),
  validationDeadline: z.string().datetime(),
  applicantName: z.string().min(1),
  isUpEligible: z.boolean().optional(),
  upOptOutRegistered: z.boolean().optional(),
});

// GET /api/v1/cases — list cases
casesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { status, riskTier, clientId, limit = 50, offset = 0 } = req.query;

    let query = db('patent_cases').select('*').limit(Number(limit)).offset(Number(offset));

    if (status) query = query.where('status', status as string);
    if (riskTier) query = query.where('risk_tier', riskTier as string);
    if (clientId) query = query.where('client_id', clientId as string);
    if (req.user?.clientId) query = query.where('client_id', req.user.clientId);

    const [cases, [{ count }]] = await Promise.all([
      query.orderBy('validation_deadline', 'asc'),
      db('patent_cases').count('* as count'),
    ]);

    res.json({ cases, total: Number(count), limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch cases' });
  }
});

// GET /api/v1/cases/:id — get single case
casesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const repo = new PatentCaseRepository(getDb());
    const caseData = await repo.findById(req.params.id);
    if (!caseData) return res.status(404).json({ error: 'Case not found' });
    res.json(caseData);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch case' });
  }
});

// POST /api/v1/cases — create case (triggers DocIntel + DataVerify)
casesRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = CreateCaseSchema.parse(req.body);
    const db = getDb();

    const caseId = generateId();
    const correlationId = generateCorrelationId(body.epNumber, req.user?.id || 'api');

    const [newCase] = await db('patent_cases').insert({
      id: caseId,
      ep_number: body.epNumber.toUpperCase(),
      client_id: req.user?.clientId || req.body.clientId,
      pathway: body.pathway,
      status: 'PENDING_VERIFICATION',
      validation_deadline: body.validationDeadline,
      applicant_name: body.applicantName,
      target_states: body.targetStates,
      is_up_eligible: body.isUpEligible ?? false,
      up_opt_out_registered: body.upOptOutRegistered ?? false,
      risk_score: 0,
      risk_tier: 'LOW',
      poa_status: 'PENDING',
      created_by: req.user?.id || 'api',
      correlation_id: correlationId,
    }).returning('*');

    // Publish event to trigger agent processing
    await getEventBus().publish(
      EVENTS.CASE_CREATED,
      {
        caseId,
        epNumber: body.epNumber.toUpperCase(),
        clientId: newCase.client_id,
        targetStates: body.targetStates,
        pathway: body.pathway,
      },
      { source: 'api', correlationId, caseId }
    );

    res.status(201).json({
      case: newCase,
      message: 'Case created — DocIntel and DataVerify processing initiated',
      correlationId,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    res.status(500).json({ error: 'Failed to create case' });
  }
});

// PATCH /api/v1/cases/:id/status — update status (human action)
casesRouter.patch(
  '/:id/status',
  requireRole('CONTROL_CENTRE_TEAM_LEAD', 'CONTROL_CENTRE_MANAGER', 'ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { status, notes } = req.body;
      const repo = new PatentCaseRepository(getDb());

      const existing = await repo.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Case not found' });

      await repo.updateStatus(req.params.id, status, { notes });

      res.json({ message: 'Status updated', previousStatus: existing.status, newStatus: status });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update status' });
    }
  }
);

// POST /api/v1/cases/:id/release-quarantine — human override to release quarantined case
casesRouter.post(
  '/:id/release-quarantine',
  requireRole('CONTROL_CENTRE_MANAGER', 'ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { justification } = req.body;
      if (!justification || justification.length < 20) {
        return res.status(400).json({ error: 'Justification required (min 20 chars) for quarantine release' });
      }

      const db = getDb();
      await db('patent_cases').where({ id: req.params.id }).update({ status: 'VERIFIED' });

      // Log override
      await db('human_overrides').insert({
        case_id: req.params.id,
        agent_id: 'data-verify-v1',
        agent_recommendation: 'QUARANTINE',
        human_decision: 'RELEASE_FROM_QUARANTINE',
        classification: 'POLICY_OVERRIDE',
        justification,
        overridden_by: req.user!.id,
      });

      res.json({ message: 'Case released from quarantine', justification });
    } catch (err) {
      res.status(500).json({ error: 'Failed to release quarantine' });
    }
  }
);

// GET /api/v1/cases/:id/risk — get current risk assessment
casesRouter.get('/:id/risk', async (req: Request, res: Response) => {
  try {
    const orchestrator = (req.app as any).orchestrator;
    const result = await orchestrator.triggerCaseHealthScan(req.params.id);
    res.json(result.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to assess case risk' });
  }
});

// GET /api/v1/cases/at-risk — cases approaching deadlines
casesRouter.get('/dashboard/at-risk', async (req: Request, res: Response) => {
  try {
    const repo = new PatentCaseRepository(getDb());
    const days = parseInt(req.query.days as string || '14');
    const cases = await repo.findAtRisk(days);
    res.json({ cases, daysThreshold: days, count: cases.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch at-risk cases' });
  }
});
