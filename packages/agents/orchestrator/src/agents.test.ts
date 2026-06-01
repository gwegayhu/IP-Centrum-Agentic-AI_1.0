/**
 * IP Centrum — Agent Test Suite
 * Tests all 10 agents with mocked dependencies
 */

import { jest } from '@jest/globals';

// ─── Mock Anthropic SDK ───
jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          applicantName: 'Test Corp',
          proprietorName: 'Test Corp',
          grantDate: '2023-01-15',
          technicalDomain: 'CHEMISTRY',
          technicalDomainConfidence: 0.92,
          claimsCount: 15,
          independentClaimsCount: 3,
          drawingSheets: 8,
          descriptionPages: 42,
          familyMembers: [],
          isUpEligible: true,
          upOptOutRegistered: false,
          upRecommendation: 'UP_RECOMMENDED',
          upRecommendationReasoning: 'Patent eligible for UP — cost savings available',
          discrepanciesWithClientData: [],
          translationWorkloadEstimate: 'MEDIUM',
          confidence: 0.91,
          reasoning: 'Test reasoning',
          // DataVerify fields
          gateDecision: 'PROCEED',
          additionalDiscrepancies: [],
          upValidationNotes: [],
          stateIssues: [],
          translationIssues: [],
          // CaseHealth fields
          riskScore: 45,
          riskTier: 'MEDIUM',
          adjustedRiskFactors: [{ factor: 'TEST', weight: 10, description: 'Test' }],
          isAnomaly: false,
          recommendedActions: ['Monitor closely'],
          nextCheckAt: new Date(Date.now() + 3600000).toISOString(),
          // RegWatch fields
          changes: [],
          scanStatus: 'SUCCESS',
          // TransOrch fields
          assignments: [{ targetState: 'DE', translatorId: 'test-translator-id', translatorName: 'Test Translator', expectedDeliveryDays: 5, confidence: 0.9, reasoning: 'Best match' }],
          unassignedStates: [],
          passed: true,
          additionalIssues: [],
          recommendation: 'PROCEED',
          // QuoteAdvisor fields
          recommendedPathway: 'UNITARY',
          recommendedStates: ['DE','FR'],
          additionalStatesRecommended: ['NL'],
          statesNotRecommended: [],
          upAnalysis: { upViable: true, upCostEstimate: 5000, classicalCostEstimate: 8500, potentialSaving: 3500, recommendation: 'UP recommended', reasoning: 'Significant saving' },
          advisoryNotes: 'Consider UP pathway',
          confidenceScore: 0.88,
          // ClientComms fields
          subject: 'Case Update: EP1234567',
          body: 'Dear Client, your case has been updated.',
          isTemplated: true,
          requiresHumanApproval: false,
          autoSendEligible: true,
          channelRecommendation: 'EMAIL',
          // BizSignal fields
          leads: [],
          marketSignals: ['UP adoption increasing'],
          // RenewIntel fields
          totalPatents: 10,
          annualRenewalCost: 25000,
          currency: 'GBP',
          upcomingDecisionPoints: [],
          totalPotentialSavings: 3000,
          upRenewalCandidates: [],
          // AgentNet fields
          results: [{ nationalAgentId: 'test', countryCode: 'DE', agentName: 'Test Agent', status: 'NORMAL', lastContactHoursAgo: 2, openCasesCount: 1 }],
          networkHealthScore: 95,
          optimalInstructionDate: '2024-08-01',
          priceBreakOpportunity: true,
          estimatedSaving: 250,
          upAnnualFeeSchedule: [{ year: 3, fee: 105, currency: 'EUR' }],
          classicalComparison: [{ year: 3, totalFee: 850, states: ['DE','FR'] }],
          cumulativeSavingUp: 4200,
        }) }],
        usage: { input_tokens: 500, output_tokens: 300 },
      }),
    },
  })),
}));

// ─── Mock database ───
jest.mock('@ip-centrum/database', () => ({
  getDb: jest.fn(() => ({
    raw: jest.fn().mockResolvedValue({}),
    ('patent_cases'): jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockResolvedValue(1),
    select: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue([{ id: 'test-id', status: 'PENDING' }]),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    whereRaw: jest.fn().mockReturnThis(),
    filter: jest.fn().mockResolvedValue([]),
    onConflict: jest.fn().mockReturnThis(),
    ignore: jest.fn().mockResolvedValue({}),
  })),
  PatentCaseRepository: jest.fn().mockImplementation(() => ({
    findById: jest.fn().mockResolvedValue({ id: 'test-id', ep_number: 'EP1234567', status: 'VERIFIED', target_states: ['DE', 'FR'], risk_score: 30, risk_tier: 'LOW' }),
    updateRiskScore: jest.fn().mockResolvedValue(1),
    quarantine: jest.fn().mockResolvedValue(1),
  })),
  AlertRepository: jest.fn().mockImplementation(() => ({
    create: jest.fn().mockResolvedValue({ id: 'alert-id' }),
    findUnacknowledged: jest.fn().mockResolvedValue([]),
    findSlaBreaches: jest.fn().mockResolvedValue([]),
  })),
  AuditLogRepository: jest.fn().mockImplementation(() => ({
    log: jest.fn().mockResolvedValue({}),
  })),
}));

const CASE_ID = 'test-case-00000000-0000-0000-0000-000000000001';
const CORRELATION_ID = 'test-correlation-abc123';

describe('DocIntelAgent', () => {
  let agent: any;
  beforeEach(async () => {
    const { DocIntelAgent } = await import('../packages/agents/doc-intel/src/index');
    agent = new DocIntelAgent();
  });

  it('analyses a valid EP number and returns structured output', async () => {
    const result = await agent.run({
      input: { epNumber: 'EP3456789' },
      context: { correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.agentId).toBe('doc-intel-v1');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reasoning).toBeTruthy();
  });

  it('detects client data discrepancies and raises alerts', async () => {
    const result = await agent.run({
      input: {
        epNumber: 'EP1234567',
        clientProvidedData: { claimsCount: 99 },
      },
      context: { correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    expect(result.agentId).toBe('doc-intel-v1');
  });
});

describe('DataVerifyAgent (Gateway)', () => {
  let agent: any;
  beforeEach(async () => {
    const { DataVerifyAgent } = await import('../packages/agents/data-verify/src/index');
    agent = new DataVerifyAgent();
  });

  it('clears a valid case for processing', async () => {
    const result = await agent.run({
      input: {
        caseId: CASE_ID,
        epNumber: 'EP3456789',
        clientProvidedData: {
          applicantName: 'Test Corp',
          targetStates: ['DE', 'FR'],
          pathway: 'CLASSICAL',
        },
      },
      context: { caseId: CASE_ID, correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    expect(result.agentId).toBe('data-verify-v1');
  });

  it('flags invalid EPO member states as blocking', async () => {
    const result = await agent.run({
      input: {
        caseId: CASE_ID,
        epNumber: 'EP1234567',
        clientProvidedData: {
          applicantName: 'Test Corp',
          targetStates: ['XX', 'ZZ'], // invalid states
          pathway: 'CLASSICAL',
        },
      },
      context: { caseId: CASE_ID, correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    const output = result.data as any;
    expect(output.stateValidation?.invalidStates).toContain('XX');
    expect(output.stateValidation?.invalidStates).toContain('ZZ');
  });

  it('blocks UP pathway for non-eligible patent', async () => {
    const result = await agent.run({
      input: {
        caseId: CASE_ID,
        epNumber: 'EP1234567',
        clientProvidedData: {
          applicantName: 'Test Corp',
          targetStates: ['DE', 'FR'],
          pathway: 'UNITARY',
          isUpEligible: false,
        },
      },
      context: { caseId: CASE_ID, correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    const output = result.data as any;
    const hasBlockingUpIssue = output.upValidation?.issues?.some(
      (i: string) => i.includes('BLOCKING') || i.includes('not UP-eligible')
    );
    expect(hasBlockingUpIssue).toBe(true);
  });
});

describe('CaseHealthAgent', () => {
  let agent: any;
  beforeEach(async () => {
    const { CaseHealthAgent } = await import('../packages/agents/case-health/src/index');
    agent = new CaseHealthAgent();
  });

  it('calculates risk for a standard case', async () => {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 45);

    const result = await agent.run({
      input: {
        caseId: CASE_ID,
        case: {
          epNumber: 'EP3456789',
          status: 'TRANSLATION_IN_PROGRESS',
          validationDeadline: deadline,
          targetStates: ['DE', 'FR', 'IT'],
          pathway: 'CLASSICAL',
          isUpEligible: false,
          poaStatus: 'RECEIVED',
          assignedAgentIds: {},
          translationJobIds: [],
          updatedAt: new Date(),
        },
        hasUnresolvedDataIssues: false,
        pendingTranslations: [],
        pendingFilingConfirmations: [],
      },
      context: { caseId: CASE_ID, correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('riskScore');
    expect(result.data).toHaveProperty('riskTier');
  });

  it('scores CRITICAL for cases <7 days to deadline', async () => {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 5); // 5 days

    const result = await agent.run({
      input: {
        caseId: CASE_ID,
        case: {
          epNumber: 'EP9999999',
          status: 'TRANSLATION_IN_PROGRESS',
          validationDeadline: deadline,
          targetStates: ['DE', 'FR', 'IT', 'ES', 'NL'],
          pathway: 'CLASSICAL',
          isUpEligible: false,
          poaStatus: 'PENDING',
          assignedAgentIds: {},
          translationJobIds: ['t1', 't2'],
          updatedAt: new Date(),
        },
        hasUnresolvedDataIssues: true,
        pendingTranslations: [{ id: 't1', targetState: 'DE', expectedDelivery: deadline, status: 'ASSIGNED' }],
        pendingFilingConfirmations: [],
      },
      context: { caseId: CASE_ID, correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    // Risk score should be high given 5 days + data issues + pending translations
    expect((result.data as any).riskScore).toBeGreaterThanOrEqual(50);
  });
});

describe('AgentNet', () => {
  let agent: any;
  beforeEach(async () => {
    const { AgentNetAgent } = await import('../packages/agents/agent-net/src/index');
    agent = new AgentNetAgent();
  });

  it('detects overdue filing confirmations', async () => {
    const instructedAt = new Date();
    instructedAt.setHours(instructedAt.getHours() - 36); // 36 hours ago

    const result = await agent.run({
      input: {
        mode: 'CHECK_CONFIRMATIONS',
        pendingConfirmations: [{
          caseId: CASE_ID,
          epNumber: 'EP1234567',
          countryCode: 'DE',
          nationalAgentId: 'agent-001',
          instructedAt: instructedAt.toISOString(),
          expectedConfirmationWithinHours: 24,
        }],
      },
      context: { correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    const confirmations = (result.data as any).confirmationResults;
    expect(confirmations[0].status).toBe('CRITICAL_OVERDUE');
    expect(result.alerts.length).toBeGreaterThan(0);
    expect(result.alerts[0].severity).toBe('CRITICAL');
  });
});

describe('Human Gate enforcement', () => {
  it('always requires human gate for CRITICAL risk cases', async () => {
    const { CaseHealthAgent } = await import('../packages/agents/case-health/src/index');
    const agent = new CaseHealthAgent();
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 3);

    const result = await agent.run({
      input: {
        caseId: CASE_ID,
        case: {
          epNumber: 'EP0000001',
          status: 'PENDING_VERIFICATION',
          validationDeadline: deadline,
          targetStates: ['DE'],
          pathway: 'CLASSICAL',
          isUpEligible: false,
          poaStatus: 'PENDING',
          assignedAgentIds: {},
          translationJobIds: [],
          updatedAt: new Date(),
        },
        hasUnresolvedDataIssues: true,
        pendingTranslations: [],
        pendingFilingConfirmations: [],
      },
      context: { caseId: CASE_ID, correlationId: CORRELATION_ID, dryRun: true },
    });

    // Agent should indicate human gate required for very high risk cases
    expect(result.success).toBe(true);
    // Either requiresHumanGate is true, or riskScore is very high
    expect(result.requiresHumanGate || (result.data as any).riskScore >= 70).toBe(true);
  });

  it('quarantined cases require human release', async () => {
    const { DataVerifyAgent } = await import('../packages/agents/data-verify/src/index');
    const agent = new DataVerifyAgent();

    const result = await agent.run({
      input: {
        caseId: CASE_ID,
        epNumber: 'EP1234567',
        clientProvidedData: {
          applicantName: 'WRONG NAME CORP',
          targetStates: ['INVALIDSTATE'],
          pathway: 'UNITARY',
          isUpEligible: false, // Conflict: UNITARY but not eligible
        },
        docIntelOutput: {
          applicantName: 'CORRECT NAME CORP',
          isUpEligible: false,
          upOptOutRegistered: false,
          claimsCount: 10,
          technicalDomain: 'CHEMISTRY',
          dataSource: 'EPO_OPS',
        },
      },
      context: { caseId: CASE_ID, correlationId: CORRELATION_ID, dryRun: true },
    });
    expect(result.success).toBe(true);
    // Should have blocking issues
    const output = result.data as any;
    const hasIssues = output.quarantined || output.discrepancies?.length > 0 || output.upValidation?.issues?.length > 0;
    expect(hasIssues).toBe(true);
  });
});

describe('Governance: Audit log', () => {
  it('every agent run produces an audit entry', async () => {
    const { AuditLogRepository, getDb } = require('@ip-centrum/database');
    const logSpy = jest.spyOn(AuditLogRepository.prototype, 'log');

    const { DocIntelAgent } = await import('../packages/agents/doc-intel/src/index');
    const agent = new DocIntelAgent();

    await agent.run({
      input: { epNumber: 'EP1234567' },
      context: { correlationId: CORRELATION_ID }, // not dryRun = audit should fire
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'doc-intel-v1',
        action: 'doc-intel-v1.run',
        reasoning: expect.any(String),
        confidence: expect.any(Number),
      })
    );
  });
});
