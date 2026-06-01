import 'dotenv/config';
import cron from 'node-cron';
import { IPCentrumOrchestrator } from '@ip-centrum/agent-orchestrator';
import { createLogger } from '@ip-centrum/shared';
import { getDb, PatentCaseRepository } from '@ip-centrum/database';

const logger = createLogger('worker');

// =============================================
// IP CENTRUM BACKGROUND WORKER
// Runs all scheduled agent jobs
// =============================================

async function main() {
  logger.info('Starting IP Centrum background worker');

  const orchestrator = new IPCentrumOrchestrator();
  await orchestrator.start();

  // ─── Every 15 minutes: scan all active cases for risk ───
  cron.schedule('*/15 * * * *', async () => {
    logger.info('[CRON] Running CaseHealth scan on all active cases');
    try {
      const repo = new PatentCaseRepository(getDb());
      const activeCases = await repo.findAtRisk(60); // next 60 days
      logger.info(`[CRON] Scanning ${activeCases.length} at-risk cases`);

      for (const c of activeCases) {
        try {
          await orchestrator.triggerCaseHealthScan(c.id);
        } catch (err) {
          logger.error(`CaseHealth failed for ${c.id}`, { data: { error: String(err) } });
        }
      }
    } catch (err) {
      logger.error('[CRON] CaseHealth scan failed', { data: { error: String(err) } });
    }
  });

  // ─── Every 5 minutes: check SLA breaches ───
  cron.schedule('*/5 * * * *', async () => {
    try {
      const count = await orchestrator.checkSlaBreaches();
      if (count > 0) logger.warn(`[CRON] Found ${count} SLA breaches`);
    } catch (err) {
      logger.error('[CRON] SLA check failed', { data: { error: String(err) } });
    }
  });

  // ─── Every 6 hours: regulatory scan ───
  cron.schedule('0 */6 * * *', async () => {
    logger.info('[CRON] Running RegWatch regulatory scan');
    try {
      const result = await orchestrator.triggerRegWatchScan();
      logger.info(`[CRON] RegWatch complete: ${(result.data as any).changesDetected} changes`);
    } catch (err) {
      logger.error('[CRON] RegWatch scan failed', { data: { error: String(err) } });
    }
  });

  // ─── Every hour: AgentNet monitoring ───
  cron.schedule('0 * * * *', async () => {
    logger.info('[CRON] Running AgentNet network monitoring');
    try {
      const result = await orchestrator.triggerAgentNetMonitoring();
      const anomalies = (result.data as any)?.monitoringResults?.filter(
        (r: any) => r.status !== 'NORMAL'
      ).length || 0;
      if (anomalies > 0) logger.warn(`[CRON] AgentNet: ${anomalies} agent anomalies detected`);
    } catch (err) {
      logger.error('[CRON] AgentNet monitoring failed', { data: { error: String(err) } });
    }
  });

  // ─── Daily at 7am: BizSignal scan ───
  cron.schedule('0 7 * * *', async () => {
    logger.info('[CRON] Running BizSignal commercial scan');
    try {
      const result = await orchestrator.triggerBizSignalScan();
      logger.info(`[CRON] BizSignal: ${(result.data as any).leadsGenerated} new leads`);
    } catch (err) {
      logger.error('[CRON] BizSignal scan failed', { data: { error: String(err) } });
    }
  });

  // ─── Daily at 6am: Check agent confirmation deadlines ───
  cron.schedule('0 6 * * *', async () => {
    logger.info('[CRON] Checking national agent filing confirmations');
    try {
      const db = getDb();
      const pendingConfirmations = await db('patent_cases')
        .join('translation_jobs', 'patent_cases.id', 'translation_jobs.case_id')
        .where('patent_cases.status', 'FILED')
        .whereNull('patent_cases.completed_at')
        .select(
          'patent_cases.id as caseId',
          'patent_cases.ep_number as epNumber',
          'patent_cases.validation_deadline as deadline'
        );

      if (pendingConfirmations.length > 0) {
        logger.info(`[CRON] ${pendingConfirmations.length} cases pending filing confirmation`);
      }
    } catch (err) {
      logger.error('[CRON] Confirmation check failed', { data: { error: String(err) } });
    }
  });

  logger.info('Worker running — all scheduled jobs active');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — shutting down worker');
    await orchestrator.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received — shutting down worker');
    await orchestrator.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error('Worker failed to start', { data: { error: String(err) } });
  process.exit(1);
});
