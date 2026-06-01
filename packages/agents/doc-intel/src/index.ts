import { BaseAgent, AgentContext } from '../../orchestrator/src/base-agent';
import { Alert, AGENT_IDS, UP_COVERED_STATES } from '@ip-centrum/shared';
import { withRetry, CircuitBreaker } from '@ip-centrum/shared';

// =============================================
// AGENT 1: DocIntel — Document Intelligence
// Risk: LOW | Cascade: MEDIUM
// Retrieves & analyses EP patents; flags UP eligibility
// =============================================

export interface DocIntelInput {
  epNumber: string;
  clientProvidedData?: {
    claimsCount?: number;
    technicalDomain?: string;
    targetStates?: string[];
  };
}

export interface DocIntelOutput {
  epNumber: string;
  applicantName: string;
  proprietorName?: string;
  grantDate?: string;
  filingDate?: string;
  technicalDomain: string;
  technicalDomainConfidence: number;
  claimsCount: number;
  independentClaimsCount: number;
  drawingSheets: number;
  descriptionPages: number;
  familyMembers: string[];
  isUpEligible: boolean;
  upOptOutRegistered: boolean;
  upRecommendation: 'UP_RECOMMENDED' | 'CLASSICAL_RECOMMENDED' | 'REQUIRES_ANALYSIS';
  upRecommendationReasoning: string;
  discrepanciesWithClientData: Array<{ field: string; clientValue: string; epoValue: string }>;
  translationWorkloadEstimate: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  dataSource: 'EPO_OPS' | 'FALLBACK_CLIENT_DATA';
  rawEpoData?: Record<string, unknown>;
}

const epoCircuitBreaker = new CircuitBreaker('epo-ops-api', {
  failureThreshold: 3,
  timeout: 30000,
  onOpen: () => console.warn('[DocIntel] EPO OPS circuit breaker OPEN — using fallback'),
  onClose: () => console.info('[DocIntel] EPO OPS circuit breaker CLOSED — API restored'),
});

export class DocIntelAgent extends BaseAgent<DocIntelInput, DocIntelOutput> {
  readonly agentId = AGENT_IDS.DOC_INTEL;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'standard' as const;

  protected async execute(input: DocIntelInput, context: AgentContext) {
    const alerts: Alert[] = [];

    // Step 1: Retrieve patent data from EPO OPS API
    let epoData: Record<string, unknown> | null = null;
    let dataSource: 'EPO_OPS' | 'FALLBACK_CLIENT_DATA' = 'EPO_OPS';

    try {
      epoData = await epoCircuitBreaker.execute(() =>
        withRetry(() => this.fetchFromEpoOps(input.epNumber), {
          maxAttempts: 3,
          onRetry: (attempt, err) =>
            this.logger.warn(`EPO OPS retry ${attempt}`, { data: { error: err.message } }),
        })
      );
    } catch (err) {
      // Graceful degradation — fall back to client-provided data with UNVERIFIED flag
      this.logger.warn('EPO OPS unavailable — using client data as fallback', {
        caseId: context.caseId,
        data: { error: String(err) },
      });
      dataSource = 'FALLBACK_CLIENT_DATA';

      alerts.push(
        this.createAlert({
          type: 'EP_REGISTER_CONFLICT',
          severity: 'MEDIUM',
          title: `EPO OPS unavailable for ${input.epNumber}`,
          description:
            'Could not retrieve patent data from EPO OPS API. ' +
            'Case data is unverified — using client-provided input. ' +
            'Manual verification required.',
          recommendedAction:
            'Verify patent data manually against EPO public register before proceeding',
          caseId: context.caseId,
          data: { epNumber: input.epNumber, fallbackUsed: true },
        })
      );
    }

    // Step 2: Use Claude to analyse patent data and generate structured output
    const systemPrompt = `You are DocIntel, an expert patent analysis AI for IP Centrum, 
a European patent validation and renewals service. Your role is to analyse patent data 
and produce accurate structured analysis for quote generation and case setup.

Critical rules:
- Your output feeds into quote generation. Accuracy is paramount.
- Always classify technical domain using the taxonomy: CHEMISTRY, PHARMA, MECHANICAL, ELECTRONICS, BIOTECH, SOFTWARE, MATERIALS, ENERGY, OTHER
- UP eligibility: A patent is UP-eligible if granted after June 2023 and not yet subject to an opt-out declaration
- Translation workload: LOW (<20 pages, <10 claims), MEDIUM (20-50 pages, 10-20 claims), HIGH (50-100 pages, 20-40 claims), VERY_HIGH (>100 pages or >40 claims)
- Always explain your UP recommendation clearly
- Respond ONLY with a valid JSON object, no preamble`;

    const userPrompt = `Analyse this EP patent and produce structured analysis:

EP Number: ${input.epNumber}
EPO Data Available: ${dataSource === 'EPO_OPS' ? 'YES' : 'NO — using client data'}
Raw EPO Data: ${JSON.stringify(epoData || {}, null, 2)}
Client-Provided Data: ${JSON.stringify(input.clientProvidedData || {}, null, 2)}
UP Covered States: ${UP_COVERED_STATES.join(', ')}

Return JSON with this exact structure:
{
  "applicantName": "string",
  "proprietorName": "string or null",
  "grantDate": "YYYY-MM-DD or null",
  "filingDate": "YYYY-MM-DD or null",
  "technicalDomain": "CHEMISTRY|PHARMA|MECHANICAL|ELECTRONICS|BIOTECH|SOFTWARE|MATERIALS|ENERGY|OTHER",
  "technicalDomainConfidence": 0.0-1.0,
  "claimsCount": integer,
  "independentClaimsCount": integer,
  "drawingSheets": integer,
  "descriptionPages": integer,
  "familyMembers": ["EP...", ...],
  "isUpEligible": boolean,
  "upOptOutRegistered": boolean,
  "upRecommendation": "UP_RECOMMENDED|CLASSICAL_RECOMMENDED|REQUIRES_ANALYSIS",
  "upRecommendationReasoning": "string explaining recommendation",
  "discrepanciesWithClientData": [{"field": "...", "clientValue": "...", "epoValue": "..."}],
  "translationWorkloadEstimate": "LOW|MEDIUM|HIGH|VERY_HIGH",
  "confidence": 0.0-1.0,
  "reasoning": "step by step explanation of analysis"
}`;

    const { parsed, tokensUsed } = await this.callClaude<{
      applicantName: string;
      proprietorName?: string;
      grantDate?: string;
      filingDate?: string;
      technicalDomain: string;
      technicalDomainConfidence: number;
      claimsCount: number;
      independentClaimsCount: number;
      drawingSheets: number;
      descriptionPages: number;
      familyMembers: string[];
      isUpEligible: boolean;
      upOptOutRegistered: boolean;
      upRecommendation: string;
      upRecommendationReasoning: string;
      discrepanciesWithClientData: Array<{ field: string; clientValue: string; epoValue: string }>;
      translationWorkloadEstimate: string;
      confidence: number;
      reasoning: string;
    }>(systemPrompt, userPrompt);

    // Step 3: Check for discrepancies requiring alert
    if (parsed.discrepanciesWithClientData.length > 0) {
      alerts.push(
        this.createAlert({
          type: 'EP_REGISTER_CONFLICT',
          severity: 'HIGH',
          title: `Data discrepancy detected for ${input.epNumber}`,
          description:
            `EPO register data conflicts with client-provided data in ` +
            `${parsed.discrepanciesWithClientData.length} field(s): ` +
            parsed.discrepanciesWithClientData.map((d) => d.field).join(', '),
          recommendedAction:
            'Review discrepancies and confirm correct data with client before proceeding',
          caseId: context.caseId,
          data: {
            discrepancies: parsed.discrepanciesWithClientData,
            epNumber: input.epNumber,
          },
        })
      );
    }

    const output: DocIntelOutput = {
      epNumber: input.epNumber,
      applicantName: parsed.applicantName,
      proprietorName: parsed.proprietorName,
      grantDate: parsed.grantDate,
      filingDate: parsed.filingDate,
      technicalDomain: parsed.technicalDomain,
      technicalDomainConfidence: parsed.technicalDomainConfidence,
      claimsCount: parsed.claimsCount,
      independentClaimsCount: parsed.independentClaimsCount,
      drawingSheets: parsed.drawingSheets,
      descriptionPages: parsed.descriptionPages,
      familyMembers: parsed.familyMembers,
      isUpEligible: parsed.isUpEligible,
      upOptOutRegistered: parsed.upOptOutRegistered,
      upRecommendation: parsed.upRecommendation as DocIntelOutput['upRecommendation'],
      upRecommendationReasoning: parsed.upRecommendationReasoning,
      discrepanciesWithClientData: parsed.discrepanciesWithClientData,
      translationWorkloadEstimate: parsed.translationWorkloadEstimate as DocIntelOutput['translationWorkloadEstimate'],
      dataSource,
      rawEpoData: epoData || undefined,
    };

    return {
      output,
      reasoning: parsed.reasoning,
      confidence: dataSource === 'FALLBACK_CLIENT_DATA' ? parsed.confidence * 0.6 : parsed.confidence,
      alerts,
      requiresHumanGate: parsed.discrepanciesWithClientData.length > 0 || dataSource === 'FALLBACK_CLIENT_DATA',
      humanGateAction: parsed.discrepanciesWithClientData.length > 0
        ? 'Resolve data discrepancies with client before case proceeds'
        : undefined,
    };
  }

  private async fetchFromEpoOps(epNumber: string): Promise<Record<string, unknown>> {
    // Get OAuth token from EPO OPS
    const tokenResponse = await fetch('https://ops.epo.org/3.2/auth/accesstoken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${process.env.EPO_OPS_KEY}:${process.env.EPO_OPS_SECRET}`
        ).toString('base64')}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!tokenResponse.ok) {
      throw new Error(`EPO OPS auth failed: ${tokenResponse.status}`);
    }

    const { access_token } = await tokenResponse.json() as { access_token: string };

    // Normalise EP number (remove leading EP if present)
    const normalised = epNumber.replace(/^EP/i, '');

    // Fetch bibliographic data
    const bibResponse = await fetch(
      `https://ops.epo.org/3.2/rest-services/published-data/publication/epodoc/EP${normalised}/biblio`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!bibResponse.ok) {
      throw new Error(`EPO OPS biblio fetch failed: ${bibResponse.status} for EP${normalised}`);
    }

    const bibData = await bibResponse.json();

    // Fetch claims data
    const claimsResponse = await fetch(
      `https://ops.epo.org/3.2/rest-services/published-data/publication/epodoc/EP${normalised}/claims`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Accept': 'application/json',
        },
      }
    );

    const claimsData = claimsResponse.ok ? await claimsResponse.json() : null;

    return {
      bibliographic: bibData,
      claims: claimsData,
      retrievedAt: new Date().toISOString(),
    };
  }
}
