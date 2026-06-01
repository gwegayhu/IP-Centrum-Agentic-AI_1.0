import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { errorHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { authMiddleware } from './middleware/auth';

import { casesRouter } from './routes/cases';
import { alertsRouter } from './routes/alerts';
import { agentsRouter } from './routes/agents';
import { quotesRouter } from './routes/quotes';
import { adminRouter } from './routes/admin';
import { healthRouter } from './routes/health';
import { renewalsRouter } from './routes/renewals';
import { regulatoryRouter } from './routes/regulatory';

import { IPCentrumOrchestrator } from '@ip-centrum/agent-orchestrator';
import { createLogger } from '@ip-centrum/shared';

const logger = createLogger('api-server');
const app = express();
const PORT = parseInt(process.env.API_PORT || '3000');

// ─── Security middleware ───
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-ID'],
}));

// ─── General middleware ───
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// ─── Rate limiting ───
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down' },
});
app.use('/api/', limiter);

// ─── Routes ───
app.use('/health', healthRouter);
app.use('/api/v1/cases', authMiddleware, casesRouter);
app.use('/api/v1/alerts', authMiddleware, alertsRouter);
app.use('/api/v1/agents', authMiddleware, agentsRouter);
app.use('/api/v1/quotes', authMiddleware, quotesRouter);
app.use('/api/v1/renewals', authMiddleware, renewalsRouter);
app.use('/api/v1/regulatory', authMiddleware, regulatoryRouter);
app.use('/api/v1/admin', authMiddleware, adminRouter);

// ─── Error handler (must be last) ───
app.use(errorHandler);

// ─── Start ───
async function main() {
  try {
    // Start agent orchestrator
    const orchestrator = new IPCentrumOrchestrator();
    await orchestrator.start();

    // Store orchestrator on app for route access
    (app as any).orchestrator = orchestrator;

    app.listen(PORT, () => {
      logger.info(`IP Centrum API running on port ${PORT}`, {
        data: { env: process.env.NODE_ENV, version: process.env.APP_VERSION },
      });
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received — shutting down gracefully`);
      await orchestrator.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error('Failed to start API server', { data: { error: String(err) } });
    process.exit(1);
  }
}

main();

export { app };
