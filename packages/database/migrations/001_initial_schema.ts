import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enable UUID extension
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  // =============================================
  // CLIENTS
  // =============================================
  await knex.schema.createTable('clients', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name').notNullable();
    t.string('email').notNullable().unique();
    t.string('company_name');
    t.enum('client_type', ['DIRECT', 'IP_FIRM', 'WHITE_LABEL', 'IN_HOUSE']).notNullable();
    t.string('white_label_name'); // For partner firms
    t.jsonb('communication_preferences').defaultTo('{}');
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);
  });

  // =============================================
  // PATENT CASES
  // =============================================
  await knex.schema.createTable('patent_cases', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('ep_number').notNullable();
    t.uuid('client_id').notNullable().references('id').inTable('clients');
    t.enum('pathway', ['CLASSICAL', 'UNITARY', 'HYBRID']).notNullable();
    t.enum('status', [
      'PENDING_VERIFICATION', 'VERIFIED', 'QUARANTINED',
      'TRANSLATION_IN_PROGRESS', 'TRANSLATION_QA', 'AWAITING_POA',
      'FILED', 'CONFIRMATION_PENDING', 'COMPLETE', 'EXCEPTION', 'ABANDONED'
    ]).notNullable().defaultTo('PENDING_VERIFICATION');

    // Statutory deadline — THE most critical field
    t.date('validation_deadline').notNullable();
    t.date('renewal_deadline');

    // Risk scoring
    t.integer('risk_score').notNullable().defaultTo(0);
    t.enum('risk_tier', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).notNullable().defaultTo('LOW');

    // Patent metadata
    t.string('applicant_name').notNullable();
    t.string('proprietor_name');
    t.date('grant_date');
    t.enum('technical_domain', ['CHEMISTRY', 'PHARMA', 'MECHANICAL', 'ELECTRONICS', 'BIOTECH', 'SOFTWARE', 'MATERIALS', 'ENERGY', 'OTHER']);
    t.integer('claims_count');
    t.integer('drawing_sheets');
    t.integer('description_pages');

    // UP/UPC
    t.boolean('is_up_eligible').defaultTo(false);
    t.boolean('up_opt_out_registered').defaultTo(false);
    t.string('up_registration_number');
    t.specificType('target_states', 'text[]').notNullable();

    // Processing
    t.jsonb('assigned_agent_ids').defaultTo('{}'); // state -> nationalAgentId
    t.specificType('translation_job_ids', 'uuid[]').defaultTo('{}');
    t.enum('poa_status', ['PENDING', 'RECEIVED', 'UPLOADED']).defaultTo('PENDING');

    // Audit
    t.string('created_by').notNullable();
    t.timestamp('data_verified_at');
    t.timestamp('completed_at');
    t.string('correlation_id').notNullable();
    t.timestamps(true, true);

    // Indexes for performance
    t.index('ep_number');
    t.index('client_id');
    t.index('status');
    t.index('risk_tier');
    t.index('validation_deadline');
  });

  // =============================================
  // ALERTS
  // =============================================
  await knex.schema.createTable('alerts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.enum('type', [
      'TRANSLATOR_NON_ACCEPTANCE', 'DEADLINE_CRITICAL', 'AGENT_CONFIRMATION_OVERDUE',
      'DATA_DISCREPANCY', 'EXCEPTION_COMMS_READY', 'REGULATORY_CHANGE',
      'AUTORENEW_RECOMMENDATION', 'TRANSLATION_QUALITY_FLAG', 'EP_REGISTER_CONFLICT',
      'UP_OPTOUT_DETECTED', 'ANOMALY_DETECTED'
    ]).notNullable();
    t.uuid('case_id').references('id').inTable('patent_cases');
    t.enum('severity', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).notNullable();
    t.string('title').notNullable();
    t.text('description').notNullable();
    t.text('recommended_action').notNullable();
    t.string('route_to').notNullable();
    t.integer('acknowledgment_sla_hours').notNullable();
    t.string('default_if_unacknowledged').notNullable();
    t.string('agent_id').notNullable();
    t.jsonb('data').defaultTo('{}');
    t.timestamp('acknowledged_at');
    t.string('acknowledged_by');
    t.string('acknowledgment_notes');
    t.timestamp('resolved_at');
    t.timestamp('expires_at').notNullable();
    t.timestamps(true, true);

    t.index('case_id');
    t.index('type');
    t.index('severity');
    t.index('acknowledged_at');
  });

  // =============================================
  // HUMAN OVERRIDES (audit trail — 7 year retention)
  // =============================================
  await knex.schema.createTable('human_overrides', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('alert_id').references('id').inTable('alerts');
    t.uuid('case_id').references('id').inTable('patent_cases');
    t.string('agent_id').notNullable();
    t.text('agent_recommendation').notNullable();
    t.text('human_decision').notNullable();
    t.enum('classification', ['MODEL_ERROR', 'POLICY_OVERRIDE', 'INCOMPLETE_INFORMATION']).notNullable();
    t.text('justification').notNullable();
    t.string('overridden_by').notNullable();
    t.timestamps(true, true);

    t.index('agent_id');
    t.index('classification');
    t.index('created_at');
  });

  // =============================================
  // AGENT AUDIT LOG (every decision — mandatory)
  // =============================================
  await knex.schema.createTable('agent_audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('agent_id').notNullable();
    t.string('agent_version').notNullable();
    t.uuid('case_id').references('id').inTable('patent_cases');
    t.string('action').notNullable();
    t.boolean('success').notNullable();
    t.decimal('confidence', 4, 3).notNullable();
    t.text('reasoning').notNullable(); // Human-readable — mandatory
    t.jsonb('input_data').notNullable();
    t.jsonb('output_data').notNullable();
    t.boolean('required_human_gate').defaultTo(false);
    t.string('human_gate_action');
    t.integer('execution_ms').notNullable();
    t.string('model_used').notNullable();
    t.integer('tokens_used');
    t.string('correlation_id');
    t.timestamps(true, true);

    t.index('agent_id');
    t.index('case_id');
    t.index('created_at');
  });

  // =============================================
  // NATIONAL AGENTS (filing partners)
  // =============================================
  await knex.schema.createTable('national_agents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name').notNullable();
    t.string('country_code', 2).notNullable();
    t.string('contact_email').notNullable();
    t.string('contact_phone');
    t.string('api_endpoint');
    t.decimal('on_time_filing_rate', 4, 3).notNullable().defaultTo(1.0);
    t.integer('quality_score').notNullable().defaultTo(100);
    t.integer('responsiveness_score').notNullable().defaultTo(100);
    t.boolean('is_active').defaultTo(true);
    t.boolean('is_up_certified').defaultTo(false);
    t.timestamp('last_contact_at');
    t.decimal('average_acknowledgment_hours', 5, 2);
    t.timestamps(true, true);

    t.unique(['country_code', 'name']);
    t.index('country_code');
    t.index('is_active');
  });

  // =============================================
  // TRANSLATORS
  // =============================================
  await knex.schema.createTable('translators', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name').notNullable();
    t.string('company_name');
    t.string('email').notNullable().unique();
    t.jsonb('language_pairs').notNullable(); // [{source, target}]
    t.specificType('technical_domains', 'text[]').notNullable();
    t.boolean('is_up_certified').defaultTo(false);
    t.integer('quality_score').notNullable().defaultTo(100);
    t.decimal('on_time_delivery_rate', 4, 3).notNullable().defaultTo(1.0);
    t.integer('current_workload').defaultTo(0);
    t.integer('max_workload').defaultTo(10);
    t.boolean('is_available').defaultTo(true);
    t.timestamps(true, true);
  });

  // =============================================
  // TRANSLATION JOBS
  // =============================================
  await knex.schema.createTable('translation_jobs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('case_id').notNullable().references('id').inTable('patent_cases');
    t.uuid('translator_id').references('id').inTable('translators');
    t.string('source_language', 5).notNullable();
    t.string('target_language', 5).notNullable();
    t.string('target_country_code', 2).notNullable();
    t.boolean('is_up_translation').defaultTo(false);
    t.enum('status', ['ASSIGNED', 'IN_PROGRESS', 'DELIVERED', 'QA_PASSED', 'QA_FAILED', 'REJECTED']).defaultTo('ASSIGNED');
    t.date('expected_delivery_date').notNullable();
    t.timestamp('delivered_at');
    t.boolean('quality_check_passed');
    t.specificType('flagged_issues', 'text[]').defaultTo('{}');
    t.integer('word_count');
    t.integer('claims_count_actual');
    t.timestamps(true, true);

    t.index('case_id');
    t.index('translator_id');
    t.index('status');
  });

  // =============================================
  // QUOTES
  // =============================================
  await knex.schema.createTable('quotes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('case_id').references('id').inTable('patent_cases');
    t.uuid('client_id').notNullable().references('id').inTable('clients');
    t.string('ep_number').notNullable();
    t.enum('pathway', ['CLASSICAL', 'UNITARY', 'HYBRID']).notNullable();
    t.specificType('target_states', 'text[]').notNullable();
    t.jsonb('line_items').notNullable();
    t.decimal('total_amount', 10, 2).notNullable();
    t.string('currency', 3).defaultTo('GBP');
    t.date('valid_until').notNullable();
    t.text('advisory_notes');
    t.boolean('up_alternative_offered').defaultTo(false);
    t.decimal('up_alternative_saving', 10, 2);
    t.enum('status', ['DRAFT', 'SENT', 'ACCEPTED', 'REVISED', 'EXPIRED']).defaultTo('DRAFT');
    t.enum('generated_by', ['HUMAN', 'DOC_INTEL', 'QUOTE_ADVISOR']).notNullable();
    t.timestamps(true, true);

    t.index('client_id');
    t.index('ep_number');
  });

  // =============================================
  // REGULATORY CHANGES
  // =============================================
  await knex.schema.createTable('regulatory_changes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.enum('source', ['EPO', 'WIPO', 'UPC', 'NATIONAL_OFFICE', 'OTHER']).notNullable();
    t.string('country_code', 2);
    t.enum('change_type', ['FEE_CHANGE', 'DEADLINE_RULE', 'TRANSLATION_REQUIREMENT', 'UP_TERRITORIAL', 'PROCEDURAL']).notNullable();
    t.string('title').notNullable();
    t.text('description').notNullable();
    t.date('effective_date').notNullable();
    t.integer('affected_cases_count').defaultTo(0);
    t.text('proposed_law_engine_update');
    t.enum('status', ['DETECTED', 'STAGED', 'APPROVED', 'APPLIED', 'REJECTED']).defaultTo('DETECTED');
    t.timestamp('detected_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('applied_at');
    t.string('applied_by');
    t.timestamps(true, true);
  });

  // =============================================
  // BIZ SIGNAL LEADS
  // =============================================
  await knex.schema.createTable('biz_signal_leads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('organization_name').notNullable();
    t.string('organization_type'); // Individual, SME, Corporate
    t.integer('ep_grants_count').notNullable();
    t.specificType('technology_areas', 'text[]');
    t.decimal('estimated_value', 10, 2);
    t.string('currency', 3).defaultTo('GBP');
    t.enum('source', ['EPO_GRANTS_DB', 'UPC_OPT_OUT', 'UP_REGISTRATION', 'OTHER']);
    t.enum('status', ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'REJECTED']).defaultTo('NEW');
    t.string('crm_id'); // If synced to CRM
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'biz_signal_leads', 'regulatory_changes', 'quotes',
    'translation_jobs', 'translators', 'national_agents',
    'agent_audit_log', 'human_overrides', 'alerts',
    'patent_cases', 'clients',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
