import { EventBus, getEventBus } from '@ip-centrum/event-bus';
import { EVENTS, AGENT_IDS, createLogger, generateCorrelationId } from '@ip-centrum/shared';
import { getDb, PatentCaseRepository, AlertRepository } from '@ip-centrum/database';

// Import all 10 agents
import { DocIntelAgent } from '../../doc-intel/src/index';
import { CaseHealthAgent } from '../../case-health/src/index';
import { RegWatchAgent } from '../../reg-watch/src/index';
import { TransOrchAgent } from '../../trans-orch/src/index';
import { AgentNetAgent } from '../../agent-net/src/index';
import { ClientCommsAgent } from '../../client-comms/src/index';
import { QuoteAdvisorAgent } from '../../client-comms/src/index';
import { RenewIntelAgent } from '../../renew-intel/src/index';
import { DataVerifyAgent } from '../../data-verify/src/index';
import { BizSignalAgent } from '../../client-comms/src/index';

const logger = createLogger('orchestrator');

// =============================================
// MAIN ORCHESTRATOR
// Wires all 10 agents to the event bus
// Enforces agent interlocks and human gate rules
// =============================================

export class IPCentrumOrchestrator {
  private eventBus: EventBus;
  private caseRepo: PatentCaseRepository;
  private alertRepo: AlertRepository;

  // Agent instances
  private docIntel = new DocIntelAgent();
  private caseHealth = new CaseHealthAgent();
  private regWatch = new RegWatchAgent();
  private transOrch = new TransOrchAgent();
  private agentNet = new AgentNetAgent();
  private clientComms = new ClientCommsAgent();
  private quoteAdvisor = new QuoteAdvisorAgent();
  private renewIntel = new RenewIntelAgent();
  private dataVerify = new DataVerifyAgent();
  private bizSignal = new BizSignalAgent();

  constructor() {
    this.eventBus = getEventBus();
    const db = getDb();
    this.caseRepo = new PatentCaseRepository(db);
    this.alertRepo = new AlertRepository(db);
  }

  async start() {
    await this.eventBus.connect();
    this.registerEventHandlers();
    logger.info('IP Centrum Orchestrator started — all 10 agents active');
  }

  private registerEventHandlers() {
    // ─── case.created → DataVerify + DocIntel (in parallel) ───
    this.eventBus.subscribe(
      EVENTS.CASE_CREATED,
      'orchestrator-case-created',
      async (event) => {
        const { caseId, epNumber, clientId, targetStates, pathway } = event.payload as any;
        const context = { caseId, correlationId: event.correlationId };

        logger.info(`New case received: ${epNumber}`, { caseId, correlationId: event.correlationId });

        // Run DocIntel and DataVerify in parallel
        const [docResult] = await Promise.all([
          this.docIntel.run({
            input: { epNumber },
            context,
          }),
          // DataVerify will run again after DocIntel completes with enriched data
        ]);

        // Now run DataVerify with DocIntel output
        const verifyResult = await this.dataVerify.run({
          input: {
            caseId,
            epNumber,
            clientProvidedData: {
              applicantName: (docResult.data as any).applicantName || 'Unknown',
              targetStates,
              pathway,
            },
            docIntelOutput: docResult.data as any,
          },
          context,
        });

        // Persist alerts
        await this.persistAlerts(verifyResult.alerts);

        if ((verifyResult.data as any).cleared) {
          await this.eventBus.publish(EVENTS.DATA_VERIFIED, {
            caseId,
            verifiedAt: new Date().toISOString(),
            discrepanciesFound: 0,
            discrepancies: [],
            cleared: true,
          }, { source: AGENT_IDS.DATA_VERIFY, correlationId: event.correlationId, caseId });
        } else {
          await this.eventBus.publish(EVENTS.DATA_QUARANTINED, {
            caseId,
            reason: (verifyResult.data as any).quarantineReason,
            discrepancies: (verifyResult.data as any).discrepancies,
          }, { source: AGENT_IDS.DATA_VERIFY, correlationId: event.correlationId, caseId });
        }
      }
    );

    // ─── case.data.verified → TransOrch ───
    this.eventBus.subscribe(
      EVENTS.DATA_VERIFIED,
      'orchestrator-data-verified',
      async (event) => {
        const { caseId } = event.payload as any;
        const caseData = await this.caseRepo.findById(caseId);
        if (!caseData) return;

        const context = { caseId, correlationId: event.correlationId };

        await this.transOrch.run({
          input: {
            mode: 'ASSIGN',
            caseId,
            epNumber: caseData.ep_number,
            assignmentRequest: {
              targetStates: caseData.target_states,
              sourceLanguage: 'EN',
              technicalDomain: caseData.technical_domain || 'OTHER',
              isUpTranslation: caseData.pathway === 'UNITARY',
              claimsCount: caseData.claims_count || 10,
              urgencyTier: 'STANDARD',
              deadline: new Date(caseData.validation_deadline),
            },
          },
          context,
        });
      }
    );

    // ─── case.translation.delivered → TransOrch QA ───
    this.eventBus.subscribe(
      EVENTS.TRANSLATION_DELIVERED,
      'orchestrator-translation-delivered',
      async (event) => {
        const { caseId, translationJobId, translatorId } = event.payload as any;
        const context = { caseId, correlationId: event.correlationId };

        const result = await this.transOrch.run({
          input: {
            mode: 'VALIDATE_DELIVERY',
            caseId,
            epNumber: '',
            deliveryValidation: {
              translationJobId,
              translatorId,
              targetState: (event.payload as any).targetState,
              expectedWordCount: (event.payload as any).expectedWordCount || 5000,
              expectedClaimsCount: (event.payload as any).expectedClaimsCount || 10,
              targetLanguage: (event.payload as any).targetLanguage,
              isUpTranslation: (event.payload as any).isUpTranslation || false,
              deliveredContent: (event.payload as any).contentSample || '',
              actualWordCount: (event.payload as any).actualWordCount || 0,
              actualClaimsCount: (event.payload as any).actualClaimsCount || 0,
            },
          },
          context,
        });

        await this.persistAlerts(result.alerts);

        if ((result.data as any).validation?.passed) {
          await this.eventBus.publish(EVENTS.TRANSLATION_QA_PASSED, {
            caseId,
            translationJobId,
          }, { source: AGENT_IDS.TRANS_ORCH, correlationId: event.correlationId, caseId });
        } else {
          await this.eventBus.publish(EVENTS.TRANSLATION_QA_FAILED, {
            caseId,
            translationJobId,
            issues: (result.data as any).validation?.flaggedIssues,
          }, { source: AGENT_IDS.TRANS_ORCH, correlationId: event.correlationId, caseId });
        }
      }
    );

    // ─── alert.sla_breach → escalation ───
    this.eventBus.subscribe(
      EVENTS.ALERT_SLA_BREACH,
      'orchestrator-sla-breach',
      async (event) => {
        const { alertId, alertType, caseId } = event.payload as any;
        logger.warn(`SLA BREACH: alert ${alertId} type ${alertType}`, { caseId });
        // In production: trigger Slack/PagerDuty/email escalation
      }
    );

    // ─── UP opt-out detected → re-evaluate classical validation ───
    this.eventBus.subscribe(
      EVENTS.UP_OPT_OUT_REGISTERED,
      'orchestrator-up-optout',
      async (event) => {
        const { epNumber } = event.payload as any;
        logger.info(`UP opt-out registered for ${epNumber} — triggering classical validation review`);
        // Find active cases for this EP number and flag for re-evaluation
        const cases = await this.caseRepo.findByEpNumber(epNumber);
        for (const c of cases) {
          if (c.pathway === 'UNITARY' || c.pathway === 'HYBRID') {
            logger.warn(`Case ${c.id} needs pathway re-evaluation due to UP opt-out`);
          }
        }
      }
    );
  }

  // ─── Manual triggers (called from API) ───

  async triggerCaseHealthScan(caseId: string) {
    const caseData = await this.caseRepo.findById(caseId);
    if (!caseData) throw new Error(`Case ${caseId} not found`);

    const correlationId = generateCorrelationId(caseData.ep_number, caseData.client_id);
    const result = await this.caseHealth.run({
      input: {
        caseId,
        case: {
          epNumber: caseData.ep_number,
          status: caseData.status,
          validationDeadline: new Date(caseData.validation_deadline),
          targetStates: caseData.target_states,
          pathway: caseData.pathway,
          isUpEligible: caseData.is_up_eligible,
          poaStatus: caseData.poa_status,
          assignedAgentIds: caseData.assigned_agent_ids || {},
          translationJobIds: caseData.translation_job_ids || [],
          updatedAt: new Date(caseData.updated_at),
        },
        hasUnresolvedDataIssues: caseData.status === 'QUARANTINED',
        pendingTranslations: [],
        pendingFilingConfirmations: [],
      },
      context: { caseId, correlationId },
    });

    await this.persistAlerts(result.alerts);
    return result;
  }

  async triggerRegWatchScan() {
    const correlationId = generateCorrelationId('reg-watch', 'system');
    return this.regWatch.run({
      input: { scanSources: ['EPO', 'WIPO', 'UPC'] },
      context: { correlationId },
    });
  }

  async triggerBizSignalScan() {
    const correlationId = generateCorrelationId('biz-signal', 'system');
    return this.bizSignal.run({
      input: { scanType: 'ALL' },
      context: { correlationId },
    });
  }

  async triggerAgentNetMonitoring() {
    const correlationId = generateCorrelationId('agent-net', 'system');
    const result = await this.agentNet.run({
      input: { mode: 'MONITOR' },
      context: { correlationId },
    });
    await this.persistAlerts(result.alerts);
    return result;
  }

  // ─── SLA enforcement job ───
  async checkSlaBreaches() {
    const db = getDb();
    const alertRepo = new AlertRepository(db);
    const breaches = await alertRepo.findSlaBreaches();

    for (const breach of breaches) {
      const correlationId = generateCorrelationId(breach.id, 'sla-check');
      await this.eventBus.publish(
        EVENTS.ALERT_SLA_BREACH,
        {
          alertId: breach.id,
          alertType: breach.type,
          caseId: breach.case_id,
          severity: breach.severity,
          hoursOverSla: Math.round(
            (Date.now() - new Date(breach.created_at).getTime()) / (1000 * 60 * 60) -
            breach.acknowledgment_sla_hours
          ),
        },
        { source: 'sla-monitor', correlationId }
      );
    }

    return breaches.length;
  }

  private async persistAlerts(alerts: any[]) {
    for (const alert of alerts) {
      try {
        await this.alertRepo.create({
          id: alert.id,
          type: alert.type,
          case_id: alert.caseId,
          severity: alert.severity,
          title: alert.title,
          description: alert.description,
          recommended_action: alert.recommendedAction,
          route_to: alert.routeTo,
          acknowledgment_sla_hours: alert.acknowledgmentSlaHours,
          default_if_unacknowledged: alert.defaultIfUnacknowledged,
          agent_id: alert.agentId,
          data: JSON.stringify(alert.data || {}),
          expires_at: alert.expiresAt,
        });

        // Publish alert event
        await this.eventBus.publish(
          EVENTS.ALERT_RAISED,
          {
            alertId: alert.id,
            type: alert.type,
            severity: alert.severity,
            caseId: alert.caseId,
            title: alert.title,
            description: alert.description,
            recommendedAction: alert.recommendedAction,
            routeTo: alert.routeTo,
            slaHours: alert.acknowledgmentSlaHours,
          },
          { source: 'orchestrator', correlationId: generateCorrelationId(alert.id, 'alert') }
        );
      } catch (err) {
        logger.error('Failed to persist alert', { data: { alertId: alert.id, error: String(err) } });
      }
    }
  }

  async stop() {
    await this.eventBus.disconnect();
    logger.info('Orchestrator stopped');
  }
}

export { DocIntelAgent, CaseHealthAgent, RegWatchAgent, TransOrchAgent,
  AgentNetAgent, ClientCommsAgent, QuoteAdvisorAgent, RenewIntelAgent,
  DataVerifyAgent, BizSignalAgent };
