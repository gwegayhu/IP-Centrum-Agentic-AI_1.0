import { z } from 'zod';

// =============================================
// CORE DOMAIN TYPES
// =============================================

export const RiskTierSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const CaseStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'VERIFIED',
  'QUARANTINED',
  'TRANSLATION_IN_PROGRESS',
  'TRANSLATION_QA',
  'AWAITING_POA',
  'FILED',
  'CONFIRMATION_PENDING',
  'COMPLETE',
  'EXCEPTION',
  'ABANDONED',
]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const PatentPathwaySchema = z.enum(['CLASSICAL', 'UNITARY', 'HYBRID']);
export type PatentPathway = z.infer<typeof PatentPathwaySchema>;

export const TechnicalDomainSchema = z.enum([
  'CHEMISTRY',
  'PHARMA',
  'MECHANICAL',
  'ELECTRONICS',
  'BIOTECH',
  'SOFTWARE',
  'MATERIALS',
  'ENERGY',
  'OTHER',
]);
export type TechnicalDomain = z.infer<typeof TechnicalDomainSchema>;

// =============================================
// PATENT CASE
// =============================================

export const PatentCaseSchema = z.object({
  id: z.string().uuid(),
  epNumber: z.string().regex(/^EP\d{7,8}(A\d|B\d)?$/, 'Invalid EP number format'),
  clientId: z.string().uuid(),
  pathway: PatentPathwaySchema,
  status: CaseStatusSchema,
  riskScore: z.number().min(0).max(100),
  riskTier: RiskTierSchema,

  // Statutory deadline — the most critical field in the system
  validationDeadline: z.date(),
  renewalDeadline: z.date().optional(),

  // Patent metadata (from DocIntel/EPO)
  applicantName: z.string(),
  proprietorName: z.string().optional(),
  grantDate: z.date().optional(),
  technicalDomain: TechnicalDomainSchema.optional(),
  claimsCount: z.number().int().positive().optional(),
  drawingSheets: z.number().int().nonneg().optional(),
  descriptionPages: z.number().int().positive().optional(),

  // UPC/UP specific
  isUpEligible: z.boolean().default(false),
  upOptOutRegistered: z.boolean().default(false),
  upRegistrationNumber: z.string().optional(),
  targetStates: z.array(z.string()).min(1), // ISO country codes

  // Processing
  assignedAgentIds: z.record(z.string(), z.string()), // state -> agentId
  translationJobIds: z.array(z.string()).default([]),
  poaStatus: z.enum(['PENDING', 'RECEIVED', 'UPLOADED']).default('PENDING'),

  // Audit
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
  dataVerifiedAt: z.date().optional(),
  completedAt: z.date().optional(),
});
export type PatentCase = z.infer<typeof PatentCaseSchema>;

// =============================================
// ALERT / ESCALATION
// =============================================

export const AlertTypeSchema = z.enum([
  'TRANSLATOR_NON_ACCEPTANCE',
  'DEADLINE_CRITICAL',
  'AGENT_CONFIRMATION_OVERDUE',
  'DATA_DISCREPANCY',
  'EXCEPTION_COMMS_READY',
  'REGULATORY_CHANGE',
  'AUTORENEW_RECOMMENDATION',
  'TRANSLATION_QUALITY_FLAG',
  'EP_REGISTER_CONFLICT',
  'UP_OPTOUT_DETECTED',
  'ANOMALY_DETECTED',
]);
export type AlertType = z.infer<typeof AlertTypeSchema>;

export const AlertSchema = z.object({
  id: z.string().uuid(),
  type: AlertTypeSchema,
  caseId: z.string().uuid().optional(),
  severity: RiskTierSchema,
  title: z.string(),
  description: z.string(),
  recommendedAction: z.string(),
  routeTo: z.string(), // Role or person
  acknowledgmentSlaHours: z.number(),
  defaultIfUnacknowledged: z.string(),
  agentId: z.string(), // which agent raised it
  data: z.record(z.unknown()).optional(),
  acknowledgedAt: z.date().optional(),
  acknowledgedBy: z.string().optional(),
  resolvedAt: z.date().optional(),
  createdAt: z.date(),
  expiresAt: z.date(),
});
export type Alert = z.infer<typeof AlertSchema>;

// =============================================
// HUMAN OVERRIDE
// =============================================

export const OverrideClassificationSchema = z.enum([
  'MODEL_ERROR',
  'POLICY_OVERRIDE',
  'INCOMPLETE_INFORMATION',
]);
export type OverrideClassification = z.infer<typeof OverrideClassificationSchema>;

export const HumanOverrideSchema = z.object({
  id: z.string().uuid(),
  alertId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
  agentId: z.string(),
  agentRecommendation: z.string(),
  humanDecision: z.string(),
  classification: OverrideClassificationSchema,
  justification: z.string().min(10, 'Justification required for all overrides'),
  overriddenBy: z.string(),
  createdAt: z.date(),
});
export type HumanOverride = z.infer<typeof HumanOverrideSchema>;

// =============================================
// AGENT RESULT
// =============================================

export const AgentResultSchema = z.object({
  agentId: z.string(),
  agentVersion: z.string(),
  caseId: z.string().uuid().optional(),
  success: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(), // Human-readable audit trail — mandatory
  data: z.record(z.unknown()),
  alerts: z.array(AlertSchema).default([]),
  requiresHumanGate: z.boolean().default(false),
  humanGateAction: z.string().optional(),
  executionMs: z.number(),
  modelUsed: z.string(),
  tokensUsed: z.number().optional(),
  createdAt: z.date(),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

// =============================================
// NATIONAL AGENT (filing partner)
// =============================================

export const NationalAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  countryCode: z.string().length(2),
  contactEmail: z.string().email(),
  contactPhone: z.string().optional(),
  apiEndpoint: z.string().url().optional(),
  onTimeFilingRate: z.number().min(0).max(1),
  qualityScore: z.number().min(0).max(100),
  responsivenessScore: z.number().min(0).max(100),
  isActive: z.boolean().default(true),
  isUpCertified: z.boolean().default(false),
  lastContactAt: z.date().optional(),
  averageAcknowledgmentHours: z.number().optional(),
});
export type NationalAgent = z.infer<typeof NationalAgentSchema>;

// =============================================
// TRANSLATOR
// =============================================

export const TranslatorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  companyName: z.string().optional(),
  email: z.string().email(),
  languagePairs: z.array(z.object({ source: z.string(), target: z.string() })),
  technicalDomains: z.array(TechnicalDomainSchema),
  isUpCertified: z.boolean().default(false),
  qualityScore: z.number().min(0).max(100),
  onTimeDeliveryRate: z.number().min(0).max(1),
  currentWorkload: z.number().int().nonneg().default(0),
  maxWorkload: z.number().int().positive().default(10),
  isAvailable: z.boolean().default(true),
});
export type Translator = z.infer<typeof TranslatorSchema>;

// =============================================
// QUOTE
// =============================================

export const QuoteSchema = z.object({
  id: z.string().uuid(),
  caseId: z.string().uuid().optional(),
  clientId: z.string().uuid(),
  epNumber: z.string(),
  pathway: PatentPathwaySchema,
  targetStates: z.array(z.string()),
  lineItems: z.array(z.object({
    description: z.string(),
    countryCode: z.string().optional(),
    amount: z.number(),
    currency: z.string().default('GBP'),
    category: z.enum(['OFFICIAL_FEE', 'TRANSLATION', 'AGENT_FEE', 'IP_CENTRUM_FEE']),
  })),
  totalAmount: z.number(),
  currency: z.string().default('GBP'),
  validUntil: z.date(),
  advisoryNotes: z.string().optional(),
  upAlternativeOffered: z.boolean().default(false),
  upAlternativeSaving: z.number().optional(),
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REVISED', 'EXPIRED']),
  generatedBy: z.enum(['HUMAN', 'DOC_INTEL', 'QUOTE_ADVISOR']),
  createdAt: z.date(),
});
export type Quote = z.infer<typeof QuoteSchema>;

// =============================================
// REGULATORY CHANGE
// =============================================

export const RegulatoryChangeSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(['EPO', 'WIPO', 'UPC', 'NATIONAL_OFFICE', 'OTHER']),
  countryCode: z.string().optional(),
  changeType: z.enum(['FEE_CHANGE', 'DEADLINE_RULE', 'TRANSLATION_REQUIREMENT', 'UP_TERRITORIAL', 'PROCEDURAL']),
  title: z.string(),
  description: z.string(),
  effectiveDate: z.date(),
  affectedCasesCount: z.number().int().nonneg().default(0),
  proposedLawEngineUpdate: z.string().optional(),
  status: z.enum(['DETECTED', 'STAGED', 'APPROVED', 'APPLIED', 'REJECTED']),
  detectedAt: z.date(),
  appliedAt: z.date().optional(),
  appliedBy: z.string().optional(),
});
export type RegulatoryChange = z.infer<typeof RegulatoryChangeSchema>;
