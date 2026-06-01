// =============================================
// IP Centrum — Governance Constants
// These are non-negotiable operational controls
// =============================================

// Alert escalation SLAs (hours) — from the Authority Gate Protocol
export const ALERT_SLA_HOURS = {
  TRANSLATOR_NON_ACCEPTANCE: 4,
  DEADLINE_CRITICAL: 2, // < 14 days with open task
  AGENT_CONFIRMATION_OVERDUE: 8,
  DATA_DISCREPANCY: 1,
  EXCEPTION_COMMS_READY: 4,
  REGULATORY_CHANGE: 24,
  AUTORENEW_RECOMMENDATION: 48,
  TRANSLATION_QUALITY_FLAG: 4,
  EP_REGISTER_CONFLICT: 2,
} as const;

// Default actions if SLA is breached without human acknowledgment
export const DEFAULT_IF_UNACKNOWLEDGED = {
  TRANSLATOR_NON_ACCEPTANCE: 'ESCALATE_TO_MANAGER_AND_DRAFT_DELAY_NOTIFICATION',
  DEADLINE_CRITICAL: 'EMERGENCY_PROTOCOL_ASSIGN_BACKUP_NOTIFY_CLIENT',
  AGENT_CONFIRMATION_OVERDUE: 'FLAG_AGENT_NETWORK_REVIEW_DRAFT_CLIENT_ALERT',
  DATA_DISCREPANCY: 'QUARANTINE_CASE_DO_NOT_PROCEED',
  EXCEPTION_COMMS_READY: 'AUTO_SEND_IF_TEMPLATED_HOLD_IF_NOT',
  REGULATORY_CHANGE: 'STAGE_UPDATE_NO_ACTIVE_CASE_DATA_CHANGED',
  AUTORENEW_RECOMMENDATION: 'CLIENT_RECEIVES_ADVISORY_NO_ACTION',
  TRANSLATION_QUALITY_FLAG: 'TRANSLATION_HELD_STATUS_QA_REVIEW',
  EP_REGISTER_CONFLICT: 'CASE_HELD_CLIENT_NOTIFIED_DATA_MISMATCH',
} as const;

// Alert routing — who handles each type
export const ALERT_ROUTING = {
  TRANSLATOR_NON_ACCEPTANCE: 'CONTROL_CENTRE_TEAM_LEAD',
  DEADLINE_CRITICAL: 'CONTROL_CENTRE_MANAGER',
  AGENT_CONFIRMATION_OVERDUE: 'AGENT_RELATIONS_MANAGER',
  DATA_DISCREPANCY: 'CONTROL_CENTRE_TEAM_LEAD',
  EXCEPTION_COMMS_READY: 'CONTROL_CENTRE_TEAM_LEAD',
  REGULATORY_CHANGE: 'LAW_ENGINE_MANAGER',
  AUTORENEW_RECOMMENDATION: 'CLIENT_ACCOUNT_MANAGER',
  TRANSLATION_QUALITY_FLAG: 'TRANSLATION_QA_LEAD',
  EP_REGISTER_CONFLICT: 'CONTROL_CENTRE_TEAM_LEAD',
} as const;

// Mandatory human authorization actions — AgentNet MUST NOT proceed without these
export const MANDATORY_HUMAN_GATES = [
  'INSTRUCT_NATIONAL_AGENT_TO_FILE',
  'SEND_CLIENT_EXCEPTION_NOTIFICATION',
  'UPDATE_LAW_ENGINE_AFFECTING_ACTIVE_CASES',
  'ABANDON_OR_NOT_RENEW_PATENT',
  'ISSUE_MATERIAL_REVISED_QUOTE',
  'MARK_CASE_COMPLETE', // until confidence threshold validated
  'FILE_UNITARY_PATENT_REQUEST',
  'UPDATE_CLIENT_PORTFOLIO_CRM_FROM_INFERENCE',
] as const;

// CaseHealth risk thresholds
export const RISK_THRESHOLDS = {
  CRITICAL: 85, // Immediate escalation
  HIGH: 70,     // 2-hour SLA
  MEDIUM: 50,   // 4-hour SLA
  LOW: 0,       // Monitoring only
} as const;

// Deadline risk bands (days remaining)
export const DEADLINE_RISK_DAYS = {
  CRITICAL: 7,
  HIGH: 14,
  MEDIUM: 30,
  LOW: 60,
} as const;

// Supported EPO member states for classical validation (46 states)
export const EPO_MEMBER_STATES = [
  'AL', 'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE',
  'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT',
  'LI', 'LT', 'LU', 'LV', 'MC', 'ME', 'MK', 'MT', 'NL', 'NO',
  'PL', 'PT', 'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'TR', 'BA',
  'KH', 'MA', 'MD', 'SY', 'TN', 'GE',
] as const;

// UP (Unitary Patent) covered states (as of June 2023 + expansions)
export const UP_COVERED_STATES = [
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'FI', 'FR',
  'GR', 'HU', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'NO', 'PL',
  'PT', 'RO', 'SE', 'SI', 'SK',
] as const;

// Agent IDs — stable identifiers for the 10 agents
export const AGENT_IDS = {
  DOC_INTEL: 'doc-intel-v1',
  CASE_HEALTH: 'case-health-v1',
  REG_WATCH: 'reg-watch-v1',
  TRANS_ORCH: 'trans-orch-v1',
  AGENT_NET: 'agent-net-v1',
  CLIENT_COMMS: 'client-comms-v1',
  QUOTE_ADVISOR: 'quote-advisor-v1',
  RENEW_INTEL: 'renew-intel-v1',
  DATA_VERIFY: 'data-verify-v1',
  BIZ_SIGNAL: 'biz-signal-v1',
} as const;

// Minimum confidence score before agent result is acted upon
export const MIN_CONFIDENCE_THRESHOLD = 0.75;

// DataVerify gate — no downstream processing without clearance
export const DATAVERIFY_GATE_REQUIRED_FOR = [
  AGENT_IDS.TRANS_ORCH,
  AGENT_IDS.AGENT_NET,
] as const;

// Audit log retention (years)
export const AUDIT_RETENTION_YEARS = 7;
