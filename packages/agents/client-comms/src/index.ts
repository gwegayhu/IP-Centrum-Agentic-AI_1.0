import { BaseAgent, AgentContext } from '../../orchestrator/src/base-agent';
import { Alert, AGENT_IDS } from '@ip-centrum/shared';

// =============================================
// AGENT 6: ClientComms — Client Communication
// Risk: LOW | Cascade: MEDIUM
// Drafts proactive case status communications; human review for exceptions
// =============================================

export interface ClientCommsInput {
  mode: 'MILESTONE_UPDATE' | 'EXCEPTION_NOTIFICATION' | 'PORTFOLIO_SUMMARY';
  caseId?: string;
  clientId: string;
  clientProfile: {
    name: string;
    companyName: string;
    clientType: string;
    whiteLabel?: { name: string; tone: string };
    communicationPreferences: {
      milestoneUpdates: boolean;
      exceptionsOnly: boolean;
      preferredFrequency: 'ALL' | 'WEEKLY' | 'EXCEPTIONS_ONLY';
    };
  };
  milestone?: {
    type: string;
    epNumber: string;
    details: Record<string, unknown>;
  };
  exception?: {
    type: string;
    epNumber: string;
    severity: string;
    description: string;
    impact: string;
    proposedResolution: string;
  };
  portfolioSummary?: {
    totalCases: number;
    activeValidations: number;
    upcomingDeadlines: Array<{ epNumber: string; daysRemaining: number }>;
    completedThisMonth: number;
    exceptionsThisMonth: number;
  };
}

export interface ClientCommsOutput {
  draftId: string;
  subject: string;
  body: string;
  recipientEmail?: string;
  isTemplated: boolean;
  requiresHumanApproval: boolean;
  autoSendEligible: boolean;
  channelRecommendation: 'EMAIL' | 'PORTAL' | 'BOTH';
}

export class ClientCommsAgent extends BaseAgent<ClientCommsInput, ClientCommsOutput> {
  readonly agentId = AGENT_IDS.CLIENT_COMMS;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'standard' as const;

  protected async execute(input: ClientCommsInput, context: AgentContext) {
    const alerts: Alert[] = [];
    const isException = input.mode === 'EXCEPTION_NOTIFICATION';
    const senderName = input.clientProfile.whiteLabel?.name || 'IP Centrum';
    const tone = input.clientProfile.whiteLabel?.tone || 'professional and concise';

    const systemPrompt = `You are ClientComms, the client communication agent for ${senderName}.
You draft professional patent formalities communications on behalf of ${senderName}.

Communication principles:
- Be proactive, specific, and reassuring
- Never use jargon the client wouldn't understand
- For white-label clients, write as if you ARE that firm — never mention IP Centrum
- For exception notifications: be factual, own the issue, state resolution timeline clearly
- Keep updates concise — clients are busy IP professionals
- Match the requested tone: ${tone}

Output must be professional enough to send directly to a corporate IP department.
Respond ONLY with valid JSON.`;

    const userPrompt = `Draft a ${input.mode.toLowerCase().replace(/_/g, ' ')} communication:

Client: ${input.clientProfile.name}, ${input.clientProfile.companyName}
Client Type: ${input.clientProfile.clientType}
Sender Identity: ${senderName}
Communication Preferences: ${JSON.stringify(input.clientProfile.communicationPreferences)}

${input.milestone ? `Milestone Event:
Type: ${input.milestone.type}
EP Number: ${input.milestone.epNumber}
Details: ${JSON.stringify(input.milestone.details)}` : ''}

${input.exception ? `Exception Details:
Type: ${input.exception.type}
EP Number: ${input.exception.epNumber}
Severity: ${input.exception.severity}
Description: ${input.exception.description}
Client Impact: ${input.exception.impact}
Proposed Resolution: ${input.exception.proposedResolution}` : ''}

${input.portfolioSummary ? `Portfolio Summary:
${JSON.stringify(input.portfolioSummary, null, 2)}` : ''}

Return JSON:
{
  "subject": "email subject line",
  "body": "full email body",
  "isTemplated": boolean (true if using standard template, false if customised),
  "requiresHumanApproval": boolean,
  "autoSendEligible": boolean,
  "channelRecommendation": "EMAIL|PORTAL|BOTH",
  "confidence": 0.0-1.0,
  "reasoning": "communication strategy explanation"
}`;

    const { parsed } = await this.callClaude<{
      subject: string;
      body: string;
      isTemplated: boolean;
      requiresHumanApproval: boolean;
      autoSendEligible: boolean;
      channelRecommendation: string;
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    // Exception communications ALWAYS require human approval per Authority Gate Protocol
    const requiresHumanApproval = isException || parsed.requiresHumanApproval;
    const autoSendEligible = parsed.isTemplated && !isException;

    if (requiresHumanApproval) {
      alerts.push(
        this.createAlert({
          type: 'EXCEPTION_COMMS_READY',
          severity: isException ? 'HIGH' : 'MEDIUM',
          caseId: input.caseId,
          title: `Communication draft ready for approval: ${input.milestone?.epNumber || input.exception?.epNumber}`,
          description: `A ${isException ? 'exception' : 'milestone'} communication has been drafted and requires human review before sending.`,
          recommendedAction: 'Review draft and approve or edit before dispatching to client',
          data: {
            subject: parsed.subject,
            autoSendEligible,
            clientId: input.clientId,
          },
        })
      );
    }

    return {
      output: {
        draftId: require('crypto').randomUUID(),
        subject: parsed.subject,
        body: parsed.body,
        isTemplated: parsed.isTemplated,
        requiresHumanApproval,
        autoSendEligible,
        channelRecommendation: parsed.channelRecommendation as ClientCommsOutput['channelRecommendation'],
      } as ClientCommsOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts,
      requiresHumanGate: requiresHumanApproval,
      humanGateAction: requiresHumanApproval
        ? `Review and approve communication draft for ${input.clientProfile.companyName}`
        : undefined,
    };
  }
}

// =============================================
// AGENT 7: QuoteAdvisor — Intelligent Quote Optimisation
// Risk: LOW | Cascade: LOW-MEDIUM
// Advises on optimal validation strategy; UP vs. classical modeling
// =============================================

export interface QuoteAdvisorInput {
  epNumber: string;
  clientId: string;
  docIntelOutput: {
    technicalDomain: string;
    claimsCount: number;
    drawingSheets: number;
    descriptionPages: number;
    isUpEligible: boolean;
    upOptOutRegistered: boolean;
    translationWorkloadEstimate: string;
    upRecommendation: string;
    upRecommendationReasoning: string;
  };
  requestedStates: string[];
  pathway: string;
  clientHistory?: {
    averageStatesPerValidation: number;
    commonValidationCountries: string[];
    totalPortfolioSize: number;
    technicalFocus: string[];
  };
}

export interface QuoteAdvisorOutput {
  recommendedPathway: string;
  recommendedStates: string[];
  additionalStatesRecommended: string[];
  statesNotRecommended: string[];
  upAnalysis?: {
    upViable: boolean;
    upCostEstimate: number;
    classicalCostEstimate: number;
    potentialSaving: number;
    recommendation: string;
    reasoning: string;
  };
  advisoryNotes: string;
  confidenceScore: number;
}

export class QuoteAdvisorAgent extends BaseAgent<QuoteAdvisorInput, QuoteAdvisorOutput> {
  readonly agentId = AGENT_IDS.QUOTE_ADVISOR;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'complex' as const; // Uses Opus for complex advisory reasoning

  protected async execute(input: QuoteAdvisorInput, context: AgentContext) {
    const systemPrompt = `You are QuoteAdvisor, the intelligent validation strategy advisor for IP Centrum.
Your role is to advise clients on optimal EP patent validation strategies, maximising 
territorial protection while optimising cost efficiency.

You have deep knowledge of:
- European patent validation costs by country (official fees + translation + agent fees)
- Unitary Patent economics vs. classical national validation
- Commercial validation patterns by technology sector
- Typical markets for different patent types

Provide specific, commercially relevant advice. Do not be generic.
When UP is viable, always model both pathways with real cost estimates.
Respond ONLY with valid JSON.`;

    const userPrompt = `Advise on validation strategy for this patent:

EP Number: ${input.epNumber}
Technical Domain: ${input.docIntelOutput.technicalDomain}
Claims Count: ${input.docIntelOutput.claimsCount}
Document Size: ${input.docIntelOutput.translationWorkloadEstimate} translation workload
UP Eligible: ${input.docIntelOutput.isUpEligible}
UP Opt-out Registered: ${input.docIntelOutput.upOptOutRegistered}
DocIntel UP Recommendation: ${input.docIntelOutput.upRecommendation}
DocIntel Reasoning: ${input.docIntelOutput.upRecommendationReasoning}
Client Requested States: ${input.requestedStates.join(', ')}
Client Pathway Choice: ${input.pathway}

Client History:
${input.clientHistory ? JSON.stringify(input.clientHistory, null, 2) : 'No history available'}

Provide strategic validation advice:
1. Should the client validate in additional states not yet selected?
2. Are any selected states commercially marginal for this technology?
3. Is UP the better option (if eligible)?
4. What are the estimated costs for both pathways?

Return JSON:
{
  "recommendedPathway": "CLASSICAL|UNITARY|HYBRID",
  "recommendedStates": ["additional states to consider"],
  "additionalStatesRecommended": ["states not currently selected but commercially relevant"],
  "statesNotRecommended": ["states in client list with marginal commercial case"],
  "upAnalysis": {
    "upViable": boolean,
    "upCostEstimate": number_in_GBP,
    "classicalCostEstimate": number_in_GBP,
    "potentialSaving": number_in_GBP,
    "recommendation": "string",
    "reasoning": "detailed commercial reasoning"
  },
  "advisoryNotes": "key advisory points for the client",
  "confidenceScore": 0.0-1.0,
  "reasoning": "strategy explanation"
}`;

    const { parsed } = await this.callClaude<QuoteAdvisorOutput & { reasoning: string }>(
      systemPrompt,
      userPrompt
    );

    return {
      output: {
        recommendedPathway: parsed.recommendedPathway,
        recommendedStates: parsed.recommendedStates,
        additionalStatesRecommended: parsed.additionalStatesRecommended,
        statesNotRecommended: parsed.statesNotRecommended,
        upAnalysis: parsed.upAnalysis,
        advisoryNotes: parsed.advisoryNotes,
        confidenceScore: parsed.confidenceScore,
      } as QuoteAdvisorOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidenceScore,
      alerts: [],
      requiresHumanGate: false, // Advisory only — client retains decision authority
    };
  }
}

// =============================================
// AGENT 10: BizSignal — Business Development Intelligence
// Risk: LOW | Cascade: NONE
// Monitors EPO grants for commercial opportunities
// =============================================

export interface BizSignalInput {
  scanType: 'EPO_GRANTS' | 'UPC_OPT_OUTS' | 'UP_REGISTRATIONS' | 'ALL';
  dateRange?: { from: string; to: string };
  filters?: {
    technologyAreas?: string[];
    minGrantsThreshold?: number;
    excludeExistingClients?: boolean;
  };
}

export interface BizSignalOutput {
  leadsGenerated: number;
  leads: Array<{
    organizationName: string;
    organizationType: string;
    epGrantsCount: number;
    technologyAreas: string[];
    estimatedValue: number;
    currency: string;
    source: string;
    opportunityReason: string;
    priorityScore: number;
  }>;
  marketSignals: string[];
  scanCompletedAt: string;
}

export class BizSignalAgent extends BaseAgent<BizSignalInput, BizSignalOutput> {
  readonly agentId = AGENT_IDS.BIZ_SIGNAL;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'standard' as const;

  protected async execute(input: BizSignalInput, context: AgentContext) {
    const systemPrompt = `You are BizSignal, the business development intelligence agent for IP Centrum.
Your role is to identify commercial opportunities from EPO patent grant data and UPC activities.

A high-value lead is:
- An organisation with >5 EP grants not currently using IP Centrum
- A patent attorney firm managing high-volume EP portfolios
- An applicant with UP opt-out activity (signals active EP validation decision-making)
- A company in a technology area that IP Centrum specialises in

Estimate validation value based on: number of grants × average states × estimated fee per state.
Average: 8 states, £2,500 per state total.

Prioritise: corporate applicants > IP firms > individual inventors
Respond ONLY with valid JSON.`;

    const userPrompt = `Analyse EPO grants data for business development opportunities:

Scan Type: ${input.scanType}
Date Range: ${JSON.stringify(input.dateRange || 'Last 30 days')}
Filters: ${JSON.stringify(input.filters || {})}

Note: In production this would receive actual EPO grants database content.
Generate representative analysis of what BizSignal would find scanning EPO data.

Return JSON:
{
  "leads": [
    {
      "organizationName": "string",
      "organizationType": "INDIVIDUAL|SME|CORPORATE|IP_FIRM",
      "epGrantsCount": integer,
      "technologyAreas": ["string"],
      "estimatedValue": number_in_GBP,
      "currency": "GBP",
      "source": "EPO_GRANTS_DB|UPC_OPT_OUT|UP_REGISTRATION",
      "opportunityReason": "why this is a good prospect",
      "priorityScore": 1-100
    }
  ],
  "marketSignals": ["key market trend observations"],
  "confidence": 0.0-1.0,
  "reasoning": "scan methodology and findings summary"
}`;

    const { parsed } = await this.callClaude<{
      leads: BizSignalOutput['leads'];
      marketSignals: string[];
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    // Save leads to DB
    const db = getDb();
    for (const lead of parsed.leads) {
      await db('biz_signal_leads').insert({
        organization_name: lead.organizationName,
        organization_type: lead.organizationType,
        ep_grants_count: lead.epGrantsCount,
        technology_areas: lead.technologyAreas,
        estimated_value: lead.estimatedValue,
        currency: lead.currency,
        source: lead.source,
        status: 'NEW',
      }).onConflict().ignore();
    }

    return {
      output: {
        leadsGenerated: parsed.leads.length,
        leads: parsed.leads,
        marketSignals: parsed.marketSignals,
        scanCompletedAt: new Date().toISOString(),
      } as BizSignalOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts: [],
      requiresHumanGate: false, // Intelligence output only
    };
  }
}
