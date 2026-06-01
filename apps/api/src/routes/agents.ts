import { Router, Request, Response } from 'express';
import { requireRole } from '../middleware/auth';
import { generateCorrelationId } from '@ip-centrum/shared';
import { DocIntelAgent } from '@ip-centrum/agent-doc-intel';
import { QuoteAdvisorAgent } from '@ip-centrum/agent-quote-advisor';
import { RenewIntelAgent } from '@ip-centrum/agent-renew-intel';
import { BizSignalAgent } from '@ip-centrum/agent-biz-signal';

export const agentsRouter = Router();

// POST /api/v1/agents/doc-intel — run DocIntel on demand
agentsRouter.post('/doc-intel', async (req: Request, res: Response) => {
  try {
    const { epNumber, clientProvidedData } = req.body;
    if (!epNumber) return res.status(400).json({ error: 'epNumber required' });

    const agent = new DocIntelAgent();
    const result = await agent.run({
      input: { epNumber, clientProvidedData },
      context: {
        correlationId: generateCorrelationId(epNumber, req.user?.id || 'api'),
        requestedBy: req.user?.id,
      },
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'DocIntel failed', details: String(err) });
  }
});

// POST /api/v1/agents/quote-advisor
agentsRouter.post('/quote-advisor', async (req: Request, res: Response) => {
  try {
    const agent = new QuoteAdvisorAgent();
    const result = await agent.run({
      input: req.body,
      context: {
        correlationId: generateCorrelationId(req.body.epNumber, req.user?.id || 'api'),
        requestedBy: req.user?.id,
      },
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'QuoteAdvisor failed', details: String(err) });
  }
});

// POST /api/v1/agents/renew-intel
agentsRouter.post('/renew-intel', async (req: Request, res: Response) => {
  try {
    const agent = new RenewIntelAgent();
    const result = await agent.run({
      input: req.body,
      context: {
        correlationId: generateCorrelationId(req.body.clientId, req.user?.id || 'api'),
        requestedBy: req.user?.id,
      },
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'RenewIntel failed', details: String(err) });
  }
});

// POST /api/v1/agents/biz-signal/scan
agentsRouter.post(
  '/biz-signal/scan',
  requireRole('ADMIN', 'AI_QUALITY_OWNER'),
  async (req: Request, res: Response) => {
    try {
      const orchestrator = (req.app as any).orchestrator;
      const result = await orchestrator.triggerBizSignalScan();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'BizSignal scan failed' });
    }
  }
);

// POST /api/v1/agents/reg-watch/scan
agentsRouter.post(
  '/reg-watch/scan',
  requireRole('LAW_ENGINE_MANAGER', 'ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const orchestrator = (req.app as any).orchestrator;
      const result = await orchestrator.triggerRegWatchScan();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'RegWatch scan failed' });
    }
  }
);

// GET /api/v1/agents/override-stats
agentsRouter.get(
  '/override-stats',
  requireRole('AI_QUALITY_OWNER', 'ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const { getDb, AuditLogRepository } = await import('@ip-centrum/database');
      const repo = new AuditLogRepository(getDb());
      const stats = await Promise.all([
        repo.getOverrideStats('doc-intel-v1'),
        repo.getOverrideStats('case-health-v1'),
        repo.getOverrideStats('data-verify-v1'),
        repo.getOverrideStats('trans-orch-v1'),
      ]);
      res.json({
        'doc-intel': stats[0],
        'case-health': stats[1],
        'data-verify': stats[2],
        'trans-orch': stats[3],
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch override stats' });
    }
  }
);
