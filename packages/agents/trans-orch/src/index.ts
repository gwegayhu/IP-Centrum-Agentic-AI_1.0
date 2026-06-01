import { BaseAgent, AgentContext } from '../../orchestrator/src/base-agent';
import { Alert, AGENT_IDS } from '@ip-centrum/shared';
import { getDb } from '@ip-centrum/database';

// =============================================
// AGENT 4: TransOrch — Translation Orchestration
// Risk: MEDIUM | Cascade: HIGH
// Matches translation tasks to qualified translators; validates deliveries
// =============================================

export interface TransOrchInput {
  mode: 'ASSIGN' | 'VALIDATE_DELIVERY';
  caseId: string;
  epNumber: string;
  // For ASSIGN mode
  assignmentRequest?: {
    targetStates: string[];
    sourceLanguage: string;
    technicalDomain: string;
    isUpTranslation: boolean;
    claimsCount: number;
    urgencyTier: 'STANDARD' | 'URGENT' | 'CRITICAL';
    deadline: Date;
  };
  // For VALIDATE_DELIVERY mode
  deliveryValidation?: {
    translationJobId: string;
    translatorId: string;
    targetState: string;
    expectedWordCount: number;
    expectedClaimsCount: number;
    targetLanguage: string;
    isUpTranslation: boolean;
    deliveredContent: string; // First 500 chars for format validation
    actualWordCount: number;
    actualClaimsCount: number;
  };
}

export interface TransOrchOutput {
  mode: string;
  assignments?: Array<{
    targetState: string;
    translatorId: string;
    translatorName: string;
    expectedDeliveryDate: string;
    confidence: number;
    reasoning: string;
  }>;
  validation?: {
    translationJobId: string;
    passed: boolean;
    flaggedIssues: string[];
    recommendation: 'PROCEED' | 'HUMAN_REVIEW' | 'REJECT';
  };
}

export class TransOrchAgent extends BaseAgent<TransOrchInput, TransOrchOutput> {
  readonly agentId = AGENT_IDS.TRANS_ORCH;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'standard' as const;

  protected async execute(input: TransOrchInput, context: AgentContext) {
    if (input.mode === 'ASSIGN') {
      return this.executeAssignment(input, context);
    } else {
      return this.executeValidation(input, context);
    }
  }

  private async executeAssignment(input: TransOrchInput, context: AgentContext) {
    const { assignmentRequest } = input;
    if (!assignmentRequest) throw new Error('assignmentRequest required for ASSIGN mode');

    const alerts: Alert[] = [];

    // Fetch available translators from DB
    const db = getDb();
    const availableTranslators = await db('translators')
      .where('is_available', true)
      .whereRaw(
        `? = ANY(technical_domains)`,
        [assignmentRequest.technicalDomain]
      )
      .orderBy('quality_score', 'desc');

    // Filter for UP-certified if needed
    const eligibleTranslators = assignmentRequest.isUpTranslation
      ? availableTranslators.filter((t) => t.is_up_certified)
      : availableTranslators;

    if (eligibleTranslators.length === 0) {
      alerts.push(
        this.createAlert({
          type: 'TRANSLATOR_NON_ACCEPTANCE',
          severity: 'HIGH',
          caseId: input.caseId,
          title: `No eligible translators for ${input.epNumber}`,
          description:
            `No ${assignmentRequest.isUpTranslation ? 'UP-certified ' : ''}translators available ` +
            `for technical domain: ${assignmentRequest.technicalDomain}. ` +
            `${assignmentRequest.targetStates.length} states require translation.`,
          recommendedAction:
            'Manually assign translator or expand translator network. ' +
            'Consider non-certified translator for non-UP states.',
          data: {
            requiredDomain: assignmentRequest.technicalDomain,
            isUpRequired: assignmentRequest.isUpTranslation,
            states: assignmentRequest.targetStates,
          },
        })
      );

      return {
        output: { mode: 'ASSIGN', assignments: [] } as TransOrchOutput,
        reasoning: 'No eligible translators found — human assignment required',
        confidence: 0,
        alerts,
        requiresHumanGate: true,
        humanGateAction: 'Manually assign translators — no eligible match found',
      };
    }

    const systemPrompt = `You are TransOrch, the translation orchestration agent for IP Centrum.
Your role is to optimally match patent translation tasks to qualified translators.

Matching criteria (in priority order):
1. Technical domain expertise — a pharma patent MUST go to a pharma translator
2. UP certification — UP translations MUST go to UP-certified translators
3. Language pair capability
4. Current capacity (workload vs. max_workload)
5. Historical quality score
6. On-time delivery rate
7. Urgency fit (urgent cases need confirmed availability)

One translator may cover multiple target states if they have the language pairs.
Aim to minimise the number of translators (reduces coordination overhead).
Respond ONLY with valid JSON.`;

    const userPrompt = `Match translation tasks for this case:

EP Number: ${input.epNumber}
Case ID: ${input.caseId}
Technical Domain: ${assignmentRequest.technicalDomain}
Source Language: ${assignmentRequest.sourceLanguage}
Target States: ${assignmentRequest.targetStates.join(', ')}
Urgency: ${assignmentRequest.urgencyTier}
Deadline: ${assignmentRequest.deadline.toISOString()}
UP Translation Required: ${assignmentRequest.isUpTranslation}
Claims Count: ${assignmentRequest.claimsCount}

Available Translators:
${JSON.stringify(eligibleTranslators.slice(0, 20), null, 2)}

Return JSON:
{
  "assignments": [
    {
      "targetState": "country code",
      "translatorId": "uuid",
      "translatorName": "name",
      "expectedDeliveryDays": integer,
      "confidence": 0.0-1.0,
      "reasoning": "why this translator for this state"
    }
  ],
  "unassignedStates": ["states that could not be matched"],
  "confidence": 0.0-1.0,
  "reasoning": "overall assignment strategy explanation"
}`;

    const { parsed } = await this.callClaude<{
      assignments: Array<{
        targetState: string;
        translatorId: string;
        translatorName: string;
        expectedDeliveryDays: number;
        confidence: number;
        reasoning: string;
      }>;
      unassignedStates: string[];
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    // Alert for unassigned states
    if (parsed.unassignedStates.length > 0) {
      alerts.push(
        this.createAlert({
          type: 'TRANSLATOR_NON_ACCEPTANCE',
          severity: 'HIGH',
          caseId: input.caseId,
          title: `Unassigned states: ${parsed.unassignedStates.join(', ')}`,
          description: `Could not find eligible translators for ${parsed.unassignedStates.length} state(s).`,
          recommendedAction: 'Manually assign translators for unmatched states',
          data: { unassignedStates: parsed.unassignedStates },
        })
      );
    }

    // Save translation jobs to DB
    const db2 = getDb();
    const deadline = assignmentRequest.deadline;

    for (const assignment of parsed.assignments) {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + assignment.expectedDeliveryDays);

      await db2('translation_jobs').insert({
        case_id: input.caseId,
        translator_id: assignment.translatorId,
        source_language: assignmentRequest.sourceLanguage,
        target_language: 'auto', // resolved from state
        target_country_code: assignment.targetState,
        is_up_translation: assignmentRequest.isUpTranslation,
        status: 'ASSIGNED',
        expected_delivery_date: deliveryDate,
      });
    }

    const assignments = parsed.assignments.map(a => {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + a.expectedDeliveryDays);
      return { ...a, expectedDeliveryDate: deliveryDate.toISOString() };
    });

    return {
      output: { mode: 'ASSIGN', assignments } as TransOrchOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts,
      requiresHumanGate: parsed.unassignedStates.length > 0,
    };
  }

  private async executeValidation(input: TransOrchInput, context: AgentContext) {
    const { deliveryValidation: dv } = input;
    if (!dv) throw new Error('deliveryValidation required for VALIDATE_DELIVERY mode');

    const alerts: Alert[] = [];

    // Rule-based checks first
    const issues: string[] = [];
    const wordCountVariance = Math.abs(dv.actualWordCount - dv.expectedWordCount) / dv.expectedWordCount;
    const claimsCountMatch = dv.actualClaimsCount === dv.expectedClaimsCount;

    if (wordCountVariance > 0.25) {
      issues.push(
        `Word count variance ${(wordCountVariance * 100).toFixed(1)}% exceeds 25% threshold ` +
        `(expected ~${dv.expectedWordCount}, got ${dv.actualWordCount})`
      );
    }

    if (!claimsCountMatch) {
      issues.push(
        `Claims count mismatch: expected ${dv.expectedClaimsCount}, got ${dv.actualClaimsCount} ` +
        `— may indicate incomplete translation`
      );
    }

    const systemPrompt = `You are TransOrch performing quality validation of a delivered patent translation.
Assess whether the translation meets the minimum quality requirements for filing.

A translation FAILS if:
- Claims count does not match source (indicates missing claims — CRITICAL)
- Word count variance >25% (indicates significant content missing or added)
- Format does not comply with target state requirements
- Obvious structural issues in the provided content sample

Respond ONLY with valid JSON.`;

    const userPrompt = `Validate this translation delivery:

Translation Job: ${dv.translationJobId}
Target State: ${dv.targetState}
Target Language: ${dv.targetLanguage}
UP Translation: ${dv.isUpTranslation}
Expected Word Count: ${dv.expectedWordCount}
Actual Word Count: ${dv.actualWordCount}
Expected Claims Count: ${dv.expectedClaimsCount}
Actual Claims Count: ${dv.actualClaimsCount}

Pre-computed Issues:
${issues.length > 0 ? issues.join('\n') : 'None detected by rule engine'}

Content Sample (first 500 chars):
${dv.deliveredContent.slice(0, 500)}

Return JSON:
{
  "passed": boolean,
  "additionalIssues": ["string"],
  "recommendation": "PROCEED|HUMAN_REVIEW|REJECT",
  "confidence": 0.0-1.0,
  "reasoning": "detailed quality assessment"
}`;

    const { parsed } = await this.callClaude<{
      passed: boolean;
      additionalIssues: string[];
      recommendation: string;
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    const allIssues = [...issues, ...parsed.additionalIssues];
    const finalPassed = allIssues.length === 0 && parsed.passed;

    if (!finalPassed) {
      // Update job status
      const db = getDb();
      await db('translation_jobs')
        .where({ id: dv.translationJobId })
        .update({
          status: parsed.recommendation === 'REJECT' ? 'QA_FAILED' : 'QA_FAILED',
          flagged_issues: allIssues,
        });

      alerts.push(
        this.createAlert({
          type: 'TRANSLATION_QUALITY_FLAG',
          severity: parsed.recommendation === 'REJECT' ? 'HIGH' : 'MEDIUM',
          caseId: input.caseId,
          title: `Translation QA failed: ${input.epNumber} — ${dv.targetState}`,
          description: `Translation for state ${dv.targetState} failed quality check. Issues: ${allIssues.join('; ')}`,
          recommendedAction:
            parsed.recommendation === 'REJECT'
              ? 'Reject and reassign translation — do not file'
              : 'Human QA review required before proceeding to filing',
          data: { issues: allIssues, jobId: dv.translationJobId },
        })
      );
    } else {
      const db = getDb();
      await db('translation_jobs')
        .where({ id: dv.translationJobId })
        .update({ status: 'QA_PASSED', quality_check_passed: true });
    }

    return {
      output: {
        mode: 'VALIDATE_DELIVERY',
        validation: {
          translationJobId: dv.translationJobId,
          passed: finalPassed,
          flaggedIssues: allIssues,
          recommendation: parsed.recommendation as 'PROCEED' | 'HUMAN_REVIEW' | 'REJECT',
        },
      } as TransOrchOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts,
      requiresHumanGate: !finalPassed,
      humanGateAction: !finalPassed ? `Review failed translation for ${dv.targetState}` : undefined,
    };
  }
}
