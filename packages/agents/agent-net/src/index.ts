import { BaseAgent, AgentContext } from '../../orchestrator/src/base-agent';
import { Alert, AGENT_IDS, daysUntil } from '@ip-centrum/shared';
import { getDb } from '@ip-centrum/database';

// =============================================
// AGENT 5: AgentNet — National Agent Network Manager
// Risk: HIGH | Cascade: HIGH
// CRITICAL: AgentNet does NOT instruct national agents to file.
// That instruction goes through human-reviewed process only.
// AgentNet manages everything before and after that instruction.
// =============================================

export interface AgentNetInput {
  mode: 'MONITOR' | 'DISTRIBUTE_DOCUMENTS' | 'CHECK_CONFIRMATIONS' | 'SCORE_AGENTS';
  caseId?: string;
  // For DISTRIBUTE_DOCUMENTS
  distribution?: {
    epNumber: string;
    targetState: string;
    nationalAgentId: string;
    documentType: 'TRANSLATION' | 'POA' | 'FILING_PACK';
    documentUrl: string;
  };
  // For CHECK_CONFIRMATIONS
  pendingConfirmations?: Array<{
    caseId: string;
    epNumber: string;
    countryCode: string;
    nationalAgentId: string;
    instructedAt: string;
    expectedConfirmationWithinHours: number;
  }>;
  // For MONITOR
  agentId?: string;
}

export interface AgentNetOutput {
  mode: string;
  monitoringResults?: Array<{
    nationalAgentId: string;
    countryCode: string;
    agentName: string;
    status: 'NORMAL' | 'LATENCY_ANOMALY' | 'UNRESPONSIVE' | 'BACKUP_RECOMMENDED';
    lastContactHoursAgo: number;
    openCasesCount: number;
    anomalyReason?: string;
  }>;
  distributionResult?: {
    success: boolean;
    deliveredAt?: string;
    error?: string;
  };
  confirmationResults?: Array<{
    caseId: string;
    countryCode: string;
    status: 'CONFIRMED' | 'OVERDUE' | 'CRITICAL_OVERDUE';
    hoursOverdue?: number;
    backupAgentId?: string;
  }>;
  agentScores?: Array<{
    nationalAgentId: string;
    countryCode: string;
    overallScore: number;
    onTimeRate: number;
    qualityScore: number;
    responsivenessScore: number;
    recommendation: 'RETAIN' | 'MONITOR' | 'REPLACE';
  }>;
}

export class AgentNetAgent extends BaseAgent<AgentNetInput, AgentNetOutput> {
  readonly agentId = AGENT_IDS.AGENT_NET;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'standard' as const;

  protected async execute(input: AgentNetInput, context: AgentContext) {
    switch (input.mode) {
      case 'MONITOR': return this.executeMonitoring(input, context);
      case 'DISTRIBUTE_DOCUMENTS': return this.executeDistribution(input, context);
      case 'CHECK_CONFIRMATIONS': return this.executeConfirmationCheck(input, context);
      case 'SCORE_AGENTS': return this.executeAgentScoring(input, context);
      default: throw new Error(`Unknown AgentNet mode: ${input.mode}`);
    }
  }

  private async executeMonitoring(input: AgentNetInput, context: AgentContext) {
    const alerts: Alert[] = [];
    const db = getDb();

    const agents = await db('national_agents')
      .where({ is_active: true })
      .select('*');

    const systemPrompt = `You are AgentNet, the national agent network manager for IP Centrum.
You monitor the network of 46 national filing agents across EPO member states.

An agent is anomalous if:
- They have not responded in 2× their average acknowledgment time
- Their acknowledgment time has increased >50% vs. their historical average
- They have multiple unconfirmed cases simultaneously (normally reliable agents suddenly quiet = red flag)

CRITICAL: You do NOT instruct agents to file. You only monitor and flag issues.
Respond ONLY with valid JSON.`;

    const userPrompt = `Monitor national agent network:

Active Agents: ${agents.length}
Agent Data:
${JSON.stringify(agents.map(a => ({
  id: a.id,
  name: a.name,
  country: a.country_code,
  avgAckHours: a.average_acknowledgment_hours,
  lastContact: a.last_contact_at,
  onTimeRate: a.on_time_filing_rate,
  qualityScore: a.quality_score,
  isUpCertified: a.is_up_certified,
})), null, 2)}

Current time: ${new Date().toISOString()}

For each agent, determine:
1. Normal or anomalous?
2. If anomalous, what is the specific reason?
3. Should a backup be recommended?

Return JSON:
{
  "results": [
    {
      "nationalAgentId": "uuid",
      "countryCode": "XX",
      "agentName": "string",
      "status": "NORMAL|LATENCY_ANOMALY|UNRESPONSIVE|BACKUP_RECOMMENDED",
      "lastContactHoursAgo": number,
      "openCasesCount": 0,
      "anomalyReason": "string if not NORMAL"
    }
  ],
  "networkHealthScore": 0-100,
  "confidence": 0.0-1.0,
  "reasoning": "network assessment"
}`;

    const { parsed } = await this.callClaude<{
      results: AgentNetOutput['monitoringResults'];
      networkHealthScore: number;
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    // Alert on anomalies
    const anomalies = (parsed.results || []).filter(r =>
      r && r.status !== 'NORMAL'
    );

    for (const anomaly of anomalies) {
      if (!anomaly) continue;
      const severity = anomaly.status === 'UNRESPONSIVE' ? 'HIGH' : 'MEDIUM';
      alerts.push(this.createAlert({
        type: 'AGENT_CONFIRMATION_OVERDUE',
        severity,
        caseId: input.caseId,
        title: `Agent anomaly: ${anomaly.agentName} (${anomaly.countryCode})`,
        description: `National agent ${anomaly.agentName} shows ${anomaly.status}. ${anomaly.anomalyReason || ''}`,
        recommendedAction: anomaly.status === 'UNRESPONSIVE'
          ? 'Contact agent immediately. Identify backup agent for affected cases.'
          : 'Monitor closely. Contact agent to confirm capacity.',
        data: { agentId: anomaly.nationalAgentId, countryCode: anomaly.countryCode },
      }));
    }

    return {
      output: { mode: 'MONITOR', monitoringResults: parsed.results } as AgentNetOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts,
      requiresHumanGate: anomalies.some(a => a && a.status === 'UNRESPONSIVE'),
    };
  }

  private async executeConfirmationCheck(input: AgentNetInput, context: AgentContext) {
    const alerts: Alert[] = [];
    const results: NonNullable<AgentNetOutput['confirmationResults']> = [];

    for (const pending of (input.pendingConfirmations || [])) {
      const instructedAt = new Date(pending.instructedAt);
      const hoursElapsed = (Date.now() - instructedAt.getTime()) / (1000 * 60 * 60);
      const hoursOverdue = hoursElapsed - pending.expectedConfirmationWithinHours;

      let status: 'CONFIRMED' | 'OVERDUE' | 'CRITICAL_OVERDUE' = 'CONFIRMED';
      if (hoursOverdue > 24) status = 'CRITICAL_OVERDUE';
      else if (hoursOverdue > 0) status = 'OVERDUE';

      const result = {
        caseId: pending.caseId,
        countryCode: pending.countryCode,
        status,
        hoursOverdue: hoursOverdue > 0 ? Math.round(hoursOverdue) : undefined,
      };
      results.push(result);

      if (status === 'CRITICAL_OVERDUE') {
        alerts.push(this.createAlert({
          type: 'AGENT_CONFIRMATION_OVERDUE',
          severity: 'CRITICAL',
          caseId: pending.caseId,
          title: `CRITICAL: Filing confirmation overdue — ${pending.epNumber} in ${pending.countryCode}`,
          description:
            `National agent ${pending.nationalAgentId} has not confirmed filing for ` +
            `${pending.epNumber} in ${pending.countryCode}. ` +
            `${Math.round(hoursOverdue)} hours overdue.`,
          recommendedAction:
            'Contact agent directly. If unreachable within 2 hours, activate backup agent procedure. Notify client.',
          data: {
            epNumber: pending.epNumber,
            nationalAgentId: pending.nationalAgentId,
            hoursOverdue: Math.round(hoursOverdue),
          },
        }));
      } else if (status === 'OVERDUE') {
        alerts.push(this.createAlert({
          type: 'AGENT_CONFIRMATION_OVERDUE',
          severity: 'HIGH',
          caseId: pending.caseId,
          title: `Confirmation overdue: ${pending.epNumber} in ${pending.countryCode}`,
          description: `Agent confirmation ${Math.round(hoursOverdue)} hours overdue for ${pending.epNumber}.`,
          recommendedAction: 'Contact national agent for status update.',
          data: { epNumber: pending.epNumber, hoursOverdue: Math.round(hoursOverdue) },
        }));
      }
    }

    return {
      output: { mode: 'CHECK_CONFIRMATIONS', confirmationResults: results } as AgentNetOutput,
      reasoning: `Checked ${input.pendingConfirmations?.length || 0} pending confirmations. Found ${results.filter(r => r.status !== 'CONFIRMED').length} overdue.`,
      confidence: 0.97,
      alerts,
      requiresHumanGate: results.some(r => r.status === 'CRITICAL_OVERDUE'),
    };
  }

  private async executeDistribution(input: AgentNetInput, context: AgentContext) {
    const { distribution } = input;
    if (!distribution) throw new Error('distribution required');

    // In production: integrate with email/portal/API of national agent
    // This is a stub that logs and simulates delivery
    this.logger.info('Document distribution requested', {
      caseId: input.caseId,
      data: {
        targetState: distribution.targetState,
        documentType: distribution.documentType,
        nationalAgentId: distribution.nationalAgentId,
      },
    });

    return {
      output: {
        mode: 'DISTRIBUTE_DOCUMENTS',
        distributionResult: {
          success: true,
          deliveredAt: new Date().toISOString(),
        },
      } as AgentNetOutput,
      reasoning: `Document ${distribution.documentType} queued for delivery to agent in ${distribution.targetState}`,
      confidence: 0.95,
      alerts: [],
      requiresHumanGate: false,
    };
  }

  private async executeAgentScoring(input: AgentNetInput, context: AgentContext) {
    const db = getDb();
    const agents = await db('national_agents').where({ is_active: true });

    const scores = agents.map(a => ({
      nationalAgentId: a.id,
      countryCode: a.country_code,
      overallScore: Math.round(
        (a.on_time_filing_rate * 100 * 0.5) +
        (a.quality_score * 0.3) +
        (a.responsiveness_score * 0.2)
      ),
      onTimeRate: a.on_time_filing_rate,
      qualityScore: a.quality_score,
      responsivenessScore: a.responsiveness_score,
      recommendation: a.on_time_filing_rate < 0.85 || a.quality_score < 60
        ? 'REPLACE' as const
        : a.on_time_filing_rate < 0.92 || a.quality_score < 75
        ? 'MONITOR' as const
        : 'RETAIN' as const,
    }));

    return {
      output: { mode: 'SCORE_AGENTS', agentScores: scores } as AgentNetOutput,
      reasoning: `Scored ${agents.length} national agents. ${scores.filter(s => s.recommendation === 'REPLACE').length} flagged for replacement.`,
      confidence: 0.9,
      alerts: [],
      requiresHumanGate: scores.some(s => s.recommendation === 'REPLACE'),
    };
  }
}
