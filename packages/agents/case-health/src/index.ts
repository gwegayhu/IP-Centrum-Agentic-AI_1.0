import { BaseAgent, AgentContext } from '../../orchestrator/src/base-agent';
import { Alert, AGENT_IDS, RISK_THRESHOLDS, DEADLINE_RISK_DAYS, daysUntil } from '@ip-centrum/shared';
import { PatentCaseRepository } from '@ip-centrum/database';
import { getDb } from '@ip-centrum/database';

// =============================================
// AGENT 2: CaseHealth — Real-Time Risk Monitor
// Risk: MEDIUM | Cascade: HIGH
// Runs continuously; triggers human escalation for at-risk cases
// =============================================

export interface CaseHealthInput {
  caseId: string;
  // Current snapshot of case state
  case: {
    epNumber: string;
    status: string;
    validationDeadline: Date;
    targetStates: string[];
    pathway: string;
    isUpEligible: boolean;
    poaStatus: string;
    assignedAgentIds: Record<string, string>;
    translationJobIds: string[];
    updatedAt: Date;
  };
  // Operational signals
  translatorLastConfirmedAt?: Date;
  agentLastAcknowledgedAt?: Date;
  hasUnresolvedDataIssues: boolean;
  pendingTranslations: Array<{
    id: string;
    targetState: string;
    expectedDelivery: Date;
    status: string;
  }>;
  pendingFilingConfirmations: Array<{
    countryCode: string;
    nationalAgentId: string;
    instructedAt: Date;
  }>;
}

export interface CaseHealthOutput {
  caseId: string;
  riskScore: number;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskFactors: Array<{
    factor: string;
    weight: number;
    description: string;
  }>;
  daysToDeadline: number;
  isAnomaly: boolean;
  anomalyReason?: string;
  recommendedActions: string[];
  nextCheckAt: Date;
}

export class CaseHealthAgent extends BaseAgent<CaseHealthInput, CaseHealthOutput> {
  readonly agentId = AGENT_IDS.CASE_HEALTH;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'standard' as const;

  protected async execute(input: CaseHealthInput, context: AgentContext) {
    const alerts: Alert[] = [];
    const daysToDeadline = daysUntil(new Date(input.case.validationDeadline));

    // Step 1: Calculate rule-based risk factors (deterministic, auditable)
    const riskFactors = this.calculateRiskFactors(input, daysToDeadline);
    const rawRiskScore = Math.min(100, riskFactors.reduce((sum, f) => sum + f.weight, 0));

    // Step 2: Use Claude for contextual analysis and anomaly detection
    const systemPrompt = `You are CaseHealth, the real-time risk monitor for IP Centrum's 
patent validation platform. Your role is to assess case risk and generate specific, 
actionable escalation recommendations.

CRITICAL: Patent validation deadlines are statutory and irrevocable. A missed deadline 
permanently destroys patent rights. Always err on the side of escalation.

Risk scoring:
- CRITICAL (85-100): Immediate human intervention required
- HIGH (70-84): 2-hour SLA for human review
- MEDIUM (50-69): 4-hour SLA
- LOW (0-49): Monitoring only

Your reasoning must be specific enough that a Control Centre team member knows 
exactly what action to take. Respond ONLY with valid JSON.`;

    const userPrompt = `Assess risk for this patent validation case:

Case ID: ${input.caseId}
EP Number: ${input.case.epNumber}
Days to Statutory Deadline: ${daysToDeadline}
Current Status: ${input.case.status}
Pathway: ${input.case.pathway}
UP Eligible: ${input.case.isUpEligible}
POA Status: ${input.case.poaStatus}
Target States: ${input.case.targetStates.join(', ')} (${input.case.targetStates.length} states)

Risk Factors Calculated:
${riskFactors.map(f => `- ${f.factor}: ${f.description} (weight: ${f.weight})`).join('\n')}
Pre-calculated Risk Score: ${rawRiskScore}/100

Operational Signals:
- Translator last confirmed: ${input.translatorLastConfirmedAt?.toISOString() || 'NEVER'}
- Agent last acknowledged: ${input.agentLastAcknowledgedAt?.toISOString() || 'NEVER'}
- Has unresolved data issues: ${input.hasUnresolvedDataIssues}
- Pending translations: ${input.pendingTranslations.length}
- Pending filing confirmations: ${input.pendingFilingConfirmations.length}
${input.pendingTranslations.length > 0 ? `
Pending Translation Details:
${input.pendingTranslations.map(t => 
  `  - ${t.targetState}: ${t.status}, expected ${t.expectedDelivery.toISOString()}`
).join('\n')}` : ''}
${input.pendingFilingConfirmations.length > 0 ? `
Pending Confirmation Details:
${input.pendingFilingConfirmations.map(f =>
  `  - ${f.countryCode}: instructed ${daysUntil(f.instructedAt)} days ago`
).join('\n')}` : ''}

Return JSON:
{
  "riskScore": 0-100,
  "riskTier": "LOW|MEDIUM|HIGH|CRITICAL",
  "adjustedRiskFactors": [{"factor": "...", "weight": 0-30, "description": "..."}],
  "isAnomaly": boolean,
  "anomalyReason": "string if anomaly",
  "recommendedActions": ["specific action 1", "specific action 2"],
  "nextCheckAt": "ISO8601 - when to next evaluate this case",
  "confidence": 0.0-1.0,
  "reasoning": "step by step risk assessment explanation"
}`;

    const { parsed } = await this.callClaude<{
      riskScore: number;
      riskTier: string;
      adjustedRiskFactors: Array<{ factor: string; weight: number; description: string }>;
      isAnomaly: boolean;
      anomalyReason?: string;
      recommendedActions: string[];
      nextCheckAt: string;
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    const finalRiskScore = parsed.riskScore;
    const riskTier = parsed.riskTier as CaseHealthOutput['riskTier'];

    // Step 3: Generate alerts based on risk tier
    if (riskTier === 'CRITICAL' || riskTier === 'HIGH') {
      const alertType = daysToDeadline <= DEADLINE_RISK_DAYS.CRITICAL
        ? 'DEADLINE_CRITICAL'
        : input.translatorLastConfirmedAt === undefined
        ? 'TRANSLATOR_NON_ACCEPTANCE'
        : 'DEADLINE_CRITICAL';

      alerts.push(
        this.createAlert({
          type: alertType,
          severity: riskTier,
          caseId: input.caseId,
          title: `${riskTier} RISK: ${input.case.epNumber} — ${daysToDeadline} days to deadline`,
          description:
            `Case ${input.case.epNumber} has reached ${riskTier} risk status. ` +
            `${daysToDeadline} days remaining to statutory validation deadline. ` +
            `Risk factors: ${riskFactors.map(f => f.factor).join(', ')}.`,
          recommendedAction: parsed.recommendedActions[0] || 'Immediate review required',
          data: {
            riskScore: finalRiskScore,
            daysToDeadline,
            riskFactors,
            recommendedActions: parsed.recommendedActions,
          },
        })
      );
    }

    // Anomaly alert
    if (parsed.isAnomaly) {
      alerts.push(
        this.createAlert({
          type: 'ANOMALY_DETECTED',
          severity: 'HIGH',
          caseId: input.caseId,
          title: `Anomaly detected: ${input.case.epNumber}`,
          description: parsed.anomalyReason || 'Unexpected risk pattern detected',
          recommendedAction: 'Route to AI Quality Owner for manual verification',
          data: { anomalyReason: parsed.anomalyReason },
        })
      );
    }

    // Data issues block
    if (input.hasUnresolvedDataIssues) {
      alerts.push(
        this.createAlert({
          type: 'DATA_DISCREPANCY',
          severity: 'HIGH',
          caseId: input.caseId,
          title: `Unresolved data issues: ${input.case.epNumber}`,
          description: 'Case has unresolved data discrepancies. Cannot proceed to translation or filing.',
          recommendedAction: 'Resolve data discrepancies immediately — case is blocked',
          data: { caseStatus: input.case.status },
        })
      );
    }

    // Update case risk score in DB
    const caseRepo = new PatentCaseRepository(getDb());
    await caseRepo.updateRiskScore(input.caseId, finalRiskScore, riskTier);

    const output: CaseHealthOutput = {
      caseId: input.caseId,
      riskScore: finalRiskScore,
      riskTier,
      riskFactors: parsed.adjustedRiskFactors,
      daysToDeadline,
      isAnomaly: parsed.isAnomaly,
      anomalyReason: parsed.anomalyReason,
      recommendedActions: parsed.recommendedActions,
      nextCheckAt: new Date(parsed.nextCheckAt),
    };

    return {
      output,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts,
      requiresHumanGate: riskTier === 'CRITICAL' || riskTier === 'HIGH',
      humanGateAction: riskTier === 'CRITICAL'
        ? 'IMMEDIATE: Escalate to Control Centre Manager — deadline critical'
        : riskTier === 'HIGH'
        ? 'URGENT: Review required within 2 hours'
        : undefined,
    };
  }

  private calculateRiskFactors(
    input: CaseHealthInput,
    daysToDeadline: number
  ): Array<{ factor: string; weight: number; description: string }> {
    const factors = [];

    // Deadline proximity (highest weight)
    if (daysToDeadline <= DEADLINE_RISK_DAYS.CRITICAL) {
      factors.push({ factor: 'DEADLINE_CRITICAL', weight: 40, description: `Only ${daysToDeadline} days to statutory deadline` });
    } else if (daysToDeadline <= DEADLINE_RISK_DAYS.HIGH) {
      factors.push({ factor: 'DEADLINE_HIGH', weight: 25, description: `${daysToDeadline} days to deadline — high urgency` });
    } else if (daysToDeadline <= DEADLINE_RISK_DAYS.MEDIUM) {
      factors.push({ factor: 'DEADLINE_MEDIUM', weight: 10, description: `${daysToDeadline} days to deadline` });
    }

    // Translator not confirmed
    if (!input.translatorLastConfirmedAt && input.pendingTranslations.length > 0) {
      factors.push({ factor: 'TRANSLATOR_UNCONFIRMED', weight: 20, description: 'No translator acceptance confirmed' });
    }

    // Agent not acknowledged
    if (!input.agentLastAcknowledgedAt && input.pendingFilingConfirmations.length > 0) {
      factors.push({ factor: 'AGENT_UNACKNOWLEDGED', weight: 25, description: 'National agent has not acknowledged filing instructions' });
    }

    // Data issues
    if (input.hasUnresolvedDataIssues) {
      factors.push({ factor: 'DATA_ISSUES', weight: 30, description: 'Unresolved data discrepancies blocking case progression' });
    }

    // POA missing
    if (input.case.poaStatus === 'PENDING' && daysToDeadline < 30) {
      factors.push({ factor: 'POA_PENDING', weight: 15, description: 'Power of Attorney not yet received' });
    }

    // Many states increases risk
    if (input.case.targetStates.length > 10) {
      factors.push({ factor: 'HIGH_STATE_COUNT', weight: 5, description: `${input.case.targetStates.length} target states increases coordination complexity` });
    }

    return factors;
  }
}
