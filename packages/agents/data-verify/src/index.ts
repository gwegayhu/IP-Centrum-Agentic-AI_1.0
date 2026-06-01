import { BaseAgent, AgentContext } from '../../orchestrator/src/base-agent';
import { Alert, AGENT_IDS, EPO_MEMBER_STATES, UP_COVERED_STATES } from '@ip-centrum/shared';
import { PatentCaseRepository, getDb } from '@ip-centrum/database';

// =============================================
// AGENT 9: DataVerify — Case Data Quality Gateway
// Risk: MEDIUM | Cascade: HIGH (GATEWAY AGENT)
// Rule: No case may proceed to TransOrch or AgentNet until DataVerify clears it
// =============================================

export interface DataVerifyInput {
  caseId: string;
  epNumber: string;
  clientProvidedData: {
    applicantName: string;
    proprietorName?: string;
    grantDate?: string;
    targetStates: string[];
    pathway: string;
    isUpEligible?: boolean;
    upOptOutRegistered?: boolean;
  };
  docIntelOutput?: {
    applicantName: string;
    grantDate?: string;
    isUpEligible: boolean;
    upOptOutRegistered: boolean;
    claimsCount: number;
    technicalDomain: string;
    dataSource: string;
  };
  translationInstructions?: Array<{
    targetState: string;
    sourceLanguage: string;
    targetLanguage: string;
  }>;
}

export interface DataVerifyOutput {
  caseId: string;
  cleared: boolean;
  quarantined: boolean;
  discrepancies: Array<{
    field: string;
    clientValue: string;
    epoValue: string;
    severity: 'BLOCKING' | 'WARNING';
    description: string;
  }>;
  upValidation: {
    eligibilityConfirmed: boolean;
    optOutChecked: boolean;
    stateSelectionValid: boolean;
    issues: string[];
  };
  stateValidation: {
    validStates: string[];
    invalidStates: string[];
    issues: string[];
  };
  translationValidation: {
    valid: boolean;
    issues: string[];
  };
  gateDecision: 'PROCEED' | 'QUARANTINE' | 'PROCEED_WITH_WARNINGS';
  quarantineReason?: string;
}

export class DataVerifyAgent extends BaseAgent<DataVerifyInput, DataVerifyOutput> {
  readonly agentId = AGENT_IDS.DATA_VERIFY;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'standard' as const;

  protected async execute(input: DataVerifyInput, context: AgentContext) {
    const alerts: Alert[] = [];

    // Step 1: Deterministic validation rules (no AI needed for these)
    const stateValidation = this.validateStates(input.clientProvidedData.targetStates);
    const upValidation = this.validateUpLogic(input);
    const discrepancies = this.compareWithEpoData(input);

    // Step 2: Translation instruction validation
    const translationValidation = this.validateTranslationInstructions(
      input.translationInstructions || [],
      input.clientProvidedData.targetStates,
      input.clientProvidedData.pathway
    );

    // Step 3: Use Claude for complex validation reasoning
    const systemPrompt = `You are DataVerify, the data quality gateway agent for IP Centrum.
Your role is to validate all case data before it enters the processing pipeline.

CRITICAL: You are a gate. No case proceeds to translation or national filing without 
your explicit clearance. When in doubt, QUARANTINE — never let ambiguous data proceed.

The consequences of data errors:
- Wrong applicant name: filing rejected, patent rights at risk
- Wrong state selection: missed national validations, permanent rights loss
- UP/classical conflict: double filing, wasted cost, potential legal issue
- Wrong translation instruction: incorrect translation filed, rejection

Your clearance is the last automated check before human review or processing begins.
Respond ONLY with valid JSON.`;

    const userPrompt = `Validate this patent case data:

EP Number: ${input.epNumber}
Client Data: ${JSON.stringify(input.clientProvidedData, null, 2)}
DocIntel Data: ${JSON.stringify(input.docIntelOutput || 'NOT AVAILABLE', null, 2)}

Pre-computed Checks:
State Validation: ${JSON.stringify(stateValidation, null, 2)}
UP Logic Validation: ${JSON.stringify(upValidation, null, 2)}
Discrepancies Found: ${JSON.stringify(discrepancies, null, 2)}
Translation Validation: ${JSON.stringify(translationValidation, null, 2)}

EPO Member States (valid): ${EPO_MEMBER_STATES.join(', ')}
UP Covered States: ${UP_COVERED_STATES.join(', ')}

Determine:
1. Are there any blocking issues that prevent processing?
2. Are there warnings that should be noted but don't block?
3. Is the UP pathway selection logically consistent?
4. Is the translation instruction set complete and correct?

Return JSON:
{
  "gateDecision": "PROCEED|QUARANTINE|PROCEED_WITH_WARNINGS",
  "quarantineReason": "string if quarantine",
  "additionalDiscrepancies": [{"field": "...", "clientValue": "...", "epoValue": "...", "severity": "BLOCKING|WARNING", "description": "..."}],
  "upValidationNotes": ["string"],
  "stateIssues": ["string"],
  "translationIssues": ["string"],
  "confidence": 0.0-1.0,
  "reasoning": "step by step validation reasoning"
}`;

    const { parsed } = await this.callClaude<{
      gateDecision: string;
      quarantineReason?: string;
      additionalDiscrepancies: Array<{
        field: string;
        clientValue: string;
        epoValue: string;
        severity: string;
        description: string;
      }>;
      upValidationNotes: string[];
      stateIssues: string[];
      translationIssues: string[];
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    // Merge discrepancies
    const allDiscrepancies = [
      ...discrepancies,
      ...parsed.additionalDiscrepancies.map(d => ({
        ...d,
        severity: d.severity as 'BLOCKING' | 'WARNING',
      })),
    ];

    const hasBlockingDiscrepancy = allDiscrepancies.some(d => d.severity === 'BLOCKING');
    const gateDecision = hasBlockingDiscrepancy ? 'QUARANTINE' :
      (parsed.gateDecision as DataVerifyOutput['gateDecision']);

    // Quarantine if blocking issues found
    if (gateDecision === 'QUARANTINE') {
      const caseRepo = new PatentCaseRepository(getDb());
      await caseRepo.quarantine(
        input.caseId,
        parsed.quarantineReason || 'Blocking data discrepancies detected'
      );

      alerts.push(
        this.createAlert({
          type: 'DATA_DISCREPANCY',
          severity: 'CRITICAL',
          caseId: input.caseId,
          title: `CASE QUARANTINED: ${input.epNumber} — data issues block processing`,
          description:
            `Case ${input.epNumber} has been quarantined due to blocking data discrepancies. ` +
            `${allDiscrepancies.filter(d => d.severity === 'BLOCKING').length} blocking issue(s) found. ` +
            `Case will not proceed until resolved.`,
          recommendedAction:
            'Review discrepancies with client. Obtain correct data. Use override with documented justification to release.',
          data: {
            discrepancies: allDiscrepancies.filter(d => d.severity === 'BLOCKING'),
            quarantineReason: parsed.quarantineReason,
          },
        })
      );
    } else if (allDiscrepancies.some(d => d.severity === 'WARNING')) {
      alerts.push(
        this.createAlert({
          type: 'EP_REGISTER_CONFLICT',
          severity: 'MEDIUM',
          caseId: input.caseId,
          title: `Data warnings for ${input.epNumber} — review recommended`,
          description:
            `Case ${input.epNumber} has ${allDiscrepancies.filter(d => d.severity === 'WARNING').length} ` +
            `data warning(s) that should be reviewed, but are not blocking processing.`,
          recommendedAction: 'Review warnings and confirm with client if needed',
          data: { warnings: allDiscrepancies.filter(d => d.severity === 'WARNING') },
        })
      );
    }

    const output: DataVerifyOutput = {
      caseId: input.caseId,
      cleared: gateDecision !== 'QUARANTINE',
      quarantined: gateDecision === 'QUARANTINE',
      discrepancies: allDiscrepancies,
      upValidation: {
        ...upValidation,
        issues: [...upValidation.issues, ...parsed.upValidationNotes],
      },
      stateValidation: {
        ...stateValidation,
        issues: [...stateValidation.issues, ...parsed.stateIssues],
      },
      translationValidation: {
        ...translationValidation,
        issues: [...translationValidation.issues, ...parsed.translationIssues],
      },
      gateDecision: gateDecision as DataVerifyOutput['gateDecision'],
      quarantineReason: gateDecision === 'QUARANTINE' ? parsed.quarantineReason : undefined,
    };

    return {
      output,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts,
      requiresHumanGate: gateDecision === 'QUARANTINE',
      humanGateAction: gateDecision === 'QUARANTINE'
        ? 'Case quarantined — resolve data discrepancies before releasing'
        : undefined,
    };
  }

  private validateStates(targetStates: string[]): {
    validStates: string[];
    invalidStates: string[];
    issues: string[];
  } {
    const validStates = targetStates.filter(s =>
      (EPO_MEMBER_STATES as readonly string[]).includes(s)
    );
    const invalidStates = targetStates.filter(s =>
      !(EPO_MEMBER_STATES as readonly string[]).includes(s)
    );
    const issues = invalidStates.map(s =>
      `State '${s}' is not a valid EPO member state and cannot be included in validation`
    );

    if (targetStates.length === 0) {
      issues.push('No target states specified — at least one state required');
    }

    return { validStates, invalidStates, issues };
  }

  private validateUpLogic(input: DataVerifyInput): {
    eligibilityConfirmed: boolean;
    optOutChecked: boolean;
    stateSelectionValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    const { pathway, isUpEligible, upOptOutRegistered, targetStates } = input.clientProvidedData;

    let stateSelectionValid = true;

    if (pathway === 'UNITARY' && !isUpEligible) {
      issues.push('BLOCKING: Unitary pathway selected but patent is not UP-eligible');
      stateSelectionValid = false;
    }

    if (pathway === 'UNITARY' && upOptOutRegistered) {
      issues.push('BLOCKING: Unitary pathway selected but opt-out has been registered');
      stateSelectionValid = false;
    }

    // Warn if UP and classical selected for same state
    if (pathway === 'HYBRID') {
      const upStatesInTarget = targetStates.filter(s =>
        (UP_COVERED_STATES as readonly string[]).includes(s)
      );
      if (upStatesInTarget.length > 0) {
        issues.push(
          `WARNING: Hybrid pathway with UP-covered states: ${upStatesInTarget.join(', ')}. ` +
          'Confirm intentional classical validation alongside UP registration.'
        );
      }
    }

    // Check DocIntel conflict
    if (input.docIntelOutput) {
      if (
        isUpEligible !== undefined &&
        input.docIntelOutput.isUpEligible !== isUpEligible
      ) {
        issues.push(
          `WARNING: UP eligibility conflict — client says ${isUpEligible}, ` +
          `DocIntel says ${input.docIntelOutput.isUpEligible}`
        );
      }
    }

    return {
      eligibilityConfirmed: isUpEligible !== undefined,
      optOutChecked: upOptOutRegistered !== undefined,
      stateSelectionValid: stateSelectionValid && issues.filter(i => i.startsWith('BLOCKING')).length === 0,
      issues,
    };
  }

  private compareWithEpoData(input: DataVerifyInput): Array<{
    field: string;
    clientValue: string;
    epoValue: string;
    severity: 'BLOCKING' | 'WARNING';
    description: string;
  }> {
    const discrepancies = [];

    if (!input.docIntelOutput || input.docIntelOutput.dataSource !== 'EPO_OPS') {
      return discrepancies;
    }

    // Compare applicant name
    const clientName = input.clientProvidedData.applicantName.toLowerCase().trim();
    const epoName = input.docIntelOutput.applicantName.toLowerCase().trim();
    if (clientName !== epoName && !clientName.includes(epoName) && !epoName.includes(clientName)) {
      discrepancies.push({
        field: 'applicantName',
        clientValue: input.clientProvidedData.applicantName,
        epoValue: input.docIntelOutput.applicantName,
        severity: 'BLOCKING' as const,
        description: 'Applicant name does not match EPO register — filing may be rejected',
      });
    }

    // Compare grant date
    if (
      input.clientProvidedData.grantDate &&
      input.docIntelOutput.grantDate &&
      input.clientProvidedData.grantDate !== input.docIntelOutput.grantDate
    ) {
      discrepancies.push({
        field: 'grantDate',
        clientValue: input.clientProvidedData.grantDate,
        epoValue: input.docIntelOutput.grantDate,
        severity: 'WARNING' as const,
        description: 'Grant date differs from EPO register — verify and confirm',
      });
    }

    return discrepancies;
  }

  private validateTranslationInstructions(
    instructions: Array<{ targetState: string; sourceLanguage: string; targetLanguage: string }>,
    targetStates: string[],
    pathway: string
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    if (pathway === 'CLASSICAL' || pathway === 'HYBRID') {
      // Every target state should have a translation instruction
      for (const state of targetStates) {
        const hasInstruction = instructions.some(i => i.targetState === state);
        if (!hasInstruction) {
          issues.push(`No translation instruction provided for state: ${state}`);
        }
      }

      // Check for duplicate states in instructions
      const stateCounts = instructions.reduce((acc, i) => {
        acc[i.targetState] = (acc[i.targetState] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      for (const [state, count] of Object.entries(stateCounts)) {
        if (count > 1) {
          issues.push(`BLOCKING: Duplicate translation instruction for state: ${state}`);
        }
      }
    }

    return { valid: issues.filter(i => i.startsWith('BLOCKING')).length === 0, issues };
  }
}
