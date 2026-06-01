import Knex from 'knex';

let db: Knex.Knex | null = null;

export function getDb(): Knex.Knex {
  if (!db) {
    db = Knex.default({
      client: 'pg',
      connection: process.env.DATABASE_URL,
      pool: {
        min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
        max: parseInt(process.env.DATABASE_POOL_MAX || '20'),
      },
      acquireConnectionTimeout: 10000,
    });
  }
  return db;
}

export async function closeDb() {
  if (db) {
    await db.destroy();
    db = null;
  }
}

// Repository helpers — typed query builders for key entities

export class PatentCaseRepository {
  constructor(private readonly db: Knex.Knex) {}

  async findById(id: string) {
    return this.db('patent_cases').where({ id }).first();
  }

  async findByEpNumber(epNumber: string) {
    return this.db('patent_cases').where({ ep_number: epNumber });
  }

  async findAtRisk(daysThreshold = 14) {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + daysThreshold);
    return this.db('patent_cases')
      .whereIn('status', ['VERIFIED', 'TRANSLATION_IN_PROGRESS', 'AWAITING_POA', 'FILED'])
      .where('validation_deadline', '<=', deadline)
      .orderBy('validation_deadline', 'asc');
  }

  async findByStatus(status: string) {
    return this.db('patent_cases').where({ status });
  }

  async updateStatus(id: string, status: string, meta?: Record<string, unknown>) {
    return this.db('patent_cases')
      .where({ id })
      .update({ status, updated_at: new Date(), ...meta });
  }

  async updateRiskScore(id: string, riskScore: number, riskTier: string) {
    return this.db('patent_cases')
      .where({ id })
      .update({ risk_score: riskScore, risk_tier: riskTier, updated_at: new Date() });
  }

  async quarantine(id: string, reason: string) {
    return this.db('patent_cases')
      .where({ id })
      .update({
        status: 'QUARANTINED',
        updated_at: new Date(),
      });
  }
}

export class AlertRepository {
  constructor(private readonly db: Knex.Knex) {}

  async create(alert: Record<string, unknown>) {
    const [created] = await this.db('alerts').insert(alert).returning('*');
    return created;
  }

  async findUnacknowledged() {
    return this.db('alerts')
      .whereNull('acknowledged_at')
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'asc');
  }

  async acknowledge(id: string, acknowledgedBy: string, notes: string) {
    return this.db('alerts').where({ id }).update({
      acknowledged_at: new Date(),
      acknowledged_by: acknowledgedBy,
      acknowledgment_notes: notes,
    });
  }

  async findSlaBreaches() {
    return this.db('alerts')
      .whereNull('acknowledged_at')
      .whereRaw(
        'created_at + (acknowledgment_sla_hours || \' hours\')::interval < NOW()'
      );
  }
}

export class AuditLogRepository {
  constructor(private readonly db: Knex.Knex) {}

  async log(entry: {
    agentId: string;
    agentVersion: string;
    caseId?: string;
    action: string;
    success: boolean;
    confidence: number;
    reasoning: string;
    inputData: Record<string, unknown>;
    outputData: Record<string, unknown>;
    requiredHumanGate: boolean;
    humanGateAction?: string;
    executionMs: number;
    modelUsed: string;
    tokensUsed?: number;
    correlationId?: string;
  }) {
    return this.db('agent_audit_log').insert({
      agent_id: entry.agentId,
      agent_version: entry.agentVersion,
      case_id: entry.caseId,
      action: entry.action,
      success: entry.success,
      confidence: entry.confidence,
      reasoning: entry.reasoning,
      input_data: JSON.stringify(entry.inputData),
      output_data: JSON.stringify(entry.outputData),
      required_human_gate: entry.requiredHumanGate,
      human_gate_action: entry.humanGateAction,
      execution_ms: entry.executionMs,
      model_used: entry.modelUsed,
      tokens_used: entry.tokensUsed,
      correlation_id: entry.correlationId,
    });
  }

  async getOverrideStats(agentId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return this.db('human_overrides')
      .where('agent_id', agentId)
      .where('created_at', '>=', since)
      .groupBy('classification')
      .select('classification')
      .count('* as count');
  }
}

export { Knex };
