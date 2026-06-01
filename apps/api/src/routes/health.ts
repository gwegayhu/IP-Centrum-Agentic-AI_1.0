import { Router } from 'express';
import { getDb } from '@ip-centrum/database';
import { getEventBus } from '@ip-centrum/event-bus';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const checks: Record<string, 'ok' | 'error'> = {};

  // Database check
  try {
    await getDb().raw('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  // Redis check
  try {
    const client = getEventBus().getClient();
    await client.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  const allHealthy = Object.values(checks).every(v => v === 'ok');
  const status = allHealthy ? 200 : 503;

  res.status(status).json({
    status: allHealthy ? 'healthy' : 'degraded',
    version: process.env.APP_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
    checks,
  });
});

healthRouter.get('/ready', async (_req, res) => {
  res.json({ ready: true });
});
