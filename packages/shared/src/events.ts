// =============================================
// IP Centrum — Event Bus Definitions
// All inter-agent communication flows through these typed events
// =============================================

export type EventPayload = Record<string, unknown>;

export interface DomainEvent<T extends EventPayload = EventPayload> {
  id: string;
  type: string;
  version: number;
  timestamp: string;
  source: string; // agent that emitted
  correlationId: string; // ties events in a case lifecycle
  payload: T;
}

// =============================================
// CASE LIFECYCLE EVENTS
// =============================================

export interface CaseCreatedPayload {
  caseId: string;
  epNumber: string;
  clientId: string;
  targetStates: string[];
  pathway: string;
}

export interface DataVerifiedPayload {
  caseId: string;
  verifiedAt: string;
  discrepanciesFound: number;
  discrepancies: Array<{ field: string; expected: string; actual: string }>;
  cleared: boolean;
}

export interface DataQuarantinedPayload {
  caseId: string;
  reason: string;
  discrepancies: Array<{ field: string; expected: string; actual: string }>;
}

export interface TranslationAssignedPayload {
  caseId: string;
  translationJobId: string;
  translatorId: string;
  targetLanguage: string;
  expectedDeliveryDate: string;
  isUpTranslation: boolean;
}

export interface TranslationDeliveredPayload {
  caseId: string;
  translationJobId: string;
  translatorId: string;
  deliveredAt: string;
  qualityCheckPassed: boolean;
  flaggedIssues: string[];
}

export interface AgentFilingConfirmedPayload {
  caseId: string;
  countryCode: string;
  nationalAgentId: string;
  filingReference: string;
  filedAt: string;
}

export interface CaseCompletedPayload {
  caseId: string;
  completedAt: string;
  pathway: string;
  statesCompleted: string[];
  totalInvoiceAmount: number;
  currency: string;
}

// =============================================
// ALERT EVENTS
// =============================================

export interface AlertRaisedPayload {
  alertId: string;
  type: string;
  severity: string;
  caseId?: string;
  title: string;
  description: string;
  recommendedAction: string;
  routeTo: string;
  slaHours: number;
}

export interface AlertAcknowledgedPayload {
  alertId: string;
  acknowledgedBy: string;
  decision: string;
  notes: string;
}

// =============================================
// REGULATORY EVENTS
// =============================================

export interface RegulatoryChangeDetectedPayload {
  changeId: string;
  source: string;
  countryCode?: string;
  changeType: string;
  title: string;
  effectiveDate: string;
  affectedCasesCount: number;
}

export interface LawEngineUpdateApprovedPayload {
  changeId: string;
  approvedBy: string;
  approvedAt: string;
}

// =============================================
// UP/UPC EVENTS
// =============================================

export interface UpOptOutRegisteredPayload {
  epNumber: string;
  optOutDate: string;
  registeredBy: string;
  implication: string;
}

export interface UpRegistrationConfirmedPayload {
  caseId: string;
  upRegistrationNumber: string;
  confirmedAt: string;
  coveredStates: string[];
}

// =============================================
// COMMERCIAL EVENTS
// =============================================

export interface BizSignalLeadDetectedPayload {
  leadId: string;
  organizationName: string;
  epGrantsCount: number;
  technologyAreas: string[];
  estimatedValue: number;
  currency: string;
  source: string;
}

// =============================================
// EVENT NAMES REGISTRY
// =============================================

export const EVENTS = {
  // Case lifecycle
  CASE_CREATED: 'case.created',
  DATA_VERIFIED: 'case.data.verified',
  DATA_QUARANTINED: 'case.data.quarantined',
  TRANSLATION_ASSIGNED: 'case.translation.assigned',
  TRANSLATION_DELIVERED: 'case.translation.delivered',
  TRANSLATION_QA_PASSED: 'case.translation.qa_passed',
  TRANSLATION_QA_FAILED: 'case.translation.qa_failed',
  AGENT_FILING_CONFIRMED: 'case.agent.filing_confirmed',
  AGENT_CONFIRMATION_OVERDUE: 'case.agent.confirmation_overdue',
  CASE_COMPLETED: 'case.completed',

  // Alerts
  ALERT_RAISED: 'alert.raised',
  ALERT_ACKNOWLEDGED: 'alert.acknowledged',
  ALERT_ESCALATED: 'alert.escalated',
  ALERT_SLA_BREACHED: 'alert.sla_breached',

  // Regulatory
  REGULATORY_CHANGE_DETECTED: 'regulatory.change.detected',
  LAW_ENGINE_UPDATE_STAGED: 'regulatory.law_engine.staged',
  LAW_ENGINE_UPDATE_APPROVED: 'regulatory.law_engine.approved',

  // UP/UPC
  UP_OPT_OUT_REGISTERED: 'up.optout.registered',
  UP_REGISTRATION_CONFIRMED: 'up.registration.confirmed',
  UP_ELIGIBILITY_DETECTED: 'up.eligibility.detected',

  // Commercial
  BIZ_SIGNAL_LEAD_DETECTED: 'biz.signal.lead_detected',
  QUOTE_GENERATED: 'quote.generated',
  QUOTE_ACCEPTED: 'quote.accepted',

  // Human gates
  HUMAN_GATE_TRIGGERED: 'human_gate.triggered',
  HUMAN_GATE_ACKNOWLEDGED: 'human_gate.acknowledged',
  HUMAN_GATE_SLA_BREACH: 'human_gate.sla_breach',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
