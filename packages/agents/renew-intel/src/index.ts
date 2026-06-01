import { BaseAgent, AgentContext } from '../../orchestrator/src/base-agent';
import { Alert, AGENT_IDS } from '@ip-centrum/shared';
import { getDb } from '@ip-centrum/database';

// =============================================
// AGENT 8: RenewIntel — Renewals Intelligence
// Risk: MEDIUM (recommendations only; client authorises)
// Cascade: MEDIUM
// =============================================

export interface RenewIntelInput {
  mode: 'PORTFOLIO_ANALYSIS' | 'AUTORENEW_OPTIMISE' | 'UP_RENEWAL_MODEL';
  clientId: string;
  portfolio?: Array<{
    epNumber: string;
    grantDate: string;
    validatedStates: string[];
    pathway: 'CLASSICAL' | 'UNITARY';
    technicalDomain: string;
    annualRenewalDates: string[]; // ISO dates upcoming
    currentAnnualCost: number;
    currency: string;
  }>;
  renewalRequest?: {
    epNumber: string;
    pathway: 'CLASSICAL' | 'UNITARY';
    validatedStates: string[];
    nextRenewalDate: string;
    yearsToTerm: number;
  };
}

export interface RenewIntelOutput {
  mode: string;
  portfolioAnalysis?: {
    totalPatents: number;
    annualRenewalCost: number;
    currency: string;
    upcomingDecisionPoints: Array<{
      epNumber: string;
      renewalDate: string;
      recommendation: 'RENEW' | 'ABANDON' | 'REVIEW';
      reasoning: string;
      annualCost: number;
    }>;
    totalPotentialSavings: number;
    upRenewalCandidates: string[];
  };
  autoRenewOptimisation?: {
    epNumber: string;
    optimalInstructionDate: string;
    priceBreakOpportunity: boolean;
    estimatedSaving: number;
    currency: string;
    reasoning: string;
  };
  upRenewalModel?: {
    epNumber: string;
    upAnnualFeeSchedule: Array<{ year: number; fee: number; currency: string }>;
    classicalComparison: Array<{ year: number; totalFee: number; states: string[] }>;
    cumulativeSavingUp: number;
    recommendation: string;
  };
}

export class RenewIntelAgent extends BaseAgent<RenewIntelInput, RenewIntelOutput> {
  readonly agentId = AGENT_IDS.RENEW_INTEL;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'complex' as const;

  protected async execute(input: RenewIntelInput, context: AgentContext) {
    switch (input.mode) {
      case 'PORTFOLIO_ANALYSIS': return this.executePortfolioAnalysis(input, context);
      case 'AUTORENEW_OPTIMISE': return this.executeAutoRenewOptimise(input, context);
      case 'UP_RENEWAL_MODEL': return this.executeUpRenewalModel(input, context);
      default: throw new Error(`Unknown RenewIntel mode`);
    }
  }

  private async executePortfolioAnalysis(input: RenewIntelInput, context: AgentContext) {
    const alerts: Alert[] = [];

    const systemPrompt = `You are RenewIntel, the patent renewals intelligence agent for IP Centrum.
You analyse client patent portfolios to provide renewal decision intelligence.

Your analysis should identify:
1. Patents approaching renewal decision points (next 90 days)
2. Patents in technology areas with declining commercial relevance
3. UP renewal candidates (patents currently renewed classically that would benefit from UP)
4. Cost optimisation opportunities via timing and price-break windows

IMPORTANT: You are advisory only. The client must authorise all renewals and abandonments.
A wrong abandonment recommendation = permanent rights loss. Be conservative.
Respond ONLY with valid JSON.`;

    const userPrompt = `Analyse this patent renewal portfolio:

Client ID: ${input.clientId}
Portfolio Size: ${input.portfolio?.length || 0} patents

Portfolio:
${JSON.stringify(input.portfolio || [], null, 2)}

Current date: ${new Date().toISOString().split('T')[0]}

Analyse each patent and provide:
1. Renewal vs. abandon recommendations for decision-point patents
2. Technology lifecycle assessment
3. UP renewal migration candidates
4. Cost trajectories

Return JSON:
{
  "totalPatents": number,
  "annualRenewalCost": number,
  "currency": "GBP",
  "upcomingDecisionPoints": [
    {
      "epNumber": "string",
      "renewalDate": "YYYY-MM-DD",
      "recommendation": "RENEW|ABANDON|REVIEW",
      "reasoning": "specific commercial reasoning",
      "annualCost": number
    }
  ],
  "totalPotentialSavings": number,
  "upRenewalCandidates": ["EP numbers"],
  "confidence": 0.0-1.0,
  "reasoning": "portfolio assessment methodology"
}`;

    const { parsed } = await this.callClaude<{
      totalPatents: number;
      annualRenewalCost: number;
      currency: string;
      upcomingDecisionPoints: RenewIntelOutput['portfolioAnalysis'] extends infer T ? T extends object ? (T extends { upcomingDecisionPoints: infer U } ? U : never) : never : never;
      totalPotentialSavings: number;
      upRenewalCandidates: string[];
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    return {
      output: {
        mode: 'PORTFOLIO_ANALYSIS',
        portfolioAnalysis: {
          totalPatents: parsed.totalPatents,
          annualRenewalCost: parsed.annualRenewalCost,
          currency: parsed.currency,
          upcomingDecisionPoints: parsed.upcomingDecisionPoints as any,
          totalPotentialSavings: parsed.totalPotentialSavings,
          upRenewalCandidates: parsed.upRenewalCandidates,
        },
      } as RenewIntelOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts,
      requiresHumanGate: false, // Advisory; client always authorises
    };
  }

  private async executeAutoRenewOptimise(input: RenewIntelInput, context: AgentContext) {
    const { renewalRequest } = input;
    if (!renewalRequest) throw new Error('renewalRequest required');

    const systemPrompt = `You are RenewIntel advising on optimal AutoRenew timing.
Patent renewal fees often have price-break windows based on:
- Early payment discounts (typically 3-6 months before due date)
- Currency exchange rate trends
- Annuity price increases scheduled at start of renewal year

Model the optimal instruction timing to minimise cost.
Respond ONLY with valid JSON.`;

    const userPrompt = `Optimise AutoRenew timing for:

EP Number: ${renewalRequest.epNumber}
Pathway: ${renewalRequest.pathway}
Validated States: ${renewalRequest.validatedStates.join(', ')}
Next Renewal Date: ${renewalRequest.nextRenewalDate}
Years to Term: ${renewalRequest.yearsToTerm}
Today: ${new Date().toISOString().split('T')[0]}

Return JSON:
{
  "optimalInstructionDate": "YYYY-MM-DD",
  "priceBreakOpportunity": boolean,
  "estimatedSaving": number_in_GBP,
  "currency": "GBP",
  "reasoning": "timing optimisation explanation",
  "confidence": 0.0-1.0
}`;

    const { parsed } = await this.callClaude<{
      optimalInstructionDate: string;
      priceBreakOpportunity: boolean;
      estimatedSaving: number;
      currency: string;
      reasoning: string;
      confidence: number;
    }>(systemPrompt, userPrompt);

    return {
      output: {
        mode: 'AUTORENEW_OPTIMISE',
        autoRenewOptimisation: {
          epNumber: renewalRequest.epNumber,
          optimalInstructionDate: parsed.optimalInstructionDate,
          priceBreakOpportunity: parsed.priceBreakOpportunity,
          estimatedSaving: parsed.estimatedSaving,
          currency: parsed.currency,
          reasoning: parsed.reasoning,
        },
      } as RenewIntelOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts: [],
      requiresHumanGate: false,
    };
  }

  private async executeUpRenewalModel(input: RenewIntelInput, context: AgentContext) {
    const { renewalRequest } = input;
    if (!renewalRequest) throw new Error('renewalRequest required');

    const systemPrompt = `You are RenewIntel modelling UP vs classical renewal economics.

UP renewal fees (EPO single payment, 2024 schedule):
Year 2: €35, Year 3: €105, Year 4: €145, Year 5: €315, Year 6: €475,
Year 7: €630, Year 8: €815, Year 9: €990, Year 10: €1175, Year 11+: escalating

Classical: sum of individual national renewal fees across validated states.
Average national fee per state per year ranges from €100 (small) to €700 (DE, FR, GB).

Model cumulative costs to patent term (20 years from filing).
Respond ONLY with valid JSON.`;

    const userPrompt = `Model UP vs classical renewal for:

EP Number: ${renewalRequest.epNumber}  
Currently Validated States: ${renewalRequest.validatedStates.join(', ')}
Years to Term: ${renewalRequest.yearsToTerm}

Return JSON:
{
  "upAnnualFeeSchedule": [{"year": N, "fee": number, "currency": "EUR"}],
  "classicalComparison": [{"year": N, "totalFee": number, "states": ["XX"]}],
  "cumulativeSavingUp": number,
  "recommendation": "string",
  "confidence": 0.0-1.0,
  "reasoning": "economic modelling explanation"
}`;

    const { parsed } = await this.callClaude<{
      upAnnualFeeSchedule: Array<{ year: number; fee: number; currency: string }>;
      classicalComparison: Array<{ year: number; totalFee: number; states: string[] }>;
      cumulativeSavingUp: number;
      recommendation: string;
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    return {
      output: {
        mode: 'UP_RENEWAL_MODEL',
        upRenewalModel: {
          epNumber: renewalRequest.epNumber,
          upAnnualFeeSchedule: parsed.upAnnualFeeSchedule,
          classicalComparison: parsed.classicalComparison,
          cumulativeSavingUp: parsed.cumulativeSavingUp,
          recommendation: parsed.recommendation,
        },
      } as RenewIntelOutput,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      alerts: [],
      requiresHumanGate: false,
    };
  }
}
