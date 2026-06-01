import type { Knex } from 'knex';
import { randomUUID } from 'crypto';

export async function seed(knex: Knex): Promise<void> {
  // Clear tables (dev only)
  await knex('translation_jobs').del();
  await knex('patent_cases').del();
  await knex('alerts').del();
  await knex('clients').del();
  await knex('national_agents').del();
  await knex('translators').del();

  // ─── Clients ───
  const clients = [
    {
      id: 'c1000000-0000-0000-0000-000000000001',
      name: 'Acme IP Department',
      email: 'ip@acme.com',
      company_name: 'Acme Corporation',
      client_type: 'IN_HOUSE',
      communication_preferences: JSON.stringify({ milestoneUpdates: true, exceptionsOnly: false, preferredFrequency: 'ALL' }),
      is_active: true,
    },
    {
      id: 'c1000000-0000-0000-0000-000000000002',
      name: 'Smith & Partners IP',
      email: 'ep@smithip.com',
      company_name: 'Smith & Partners LLP',
      client_type: 'WHITE_LABEL',
      white_label_name: 'Smith & Partners Patent Services',
      communication_preferences: JSON.stringify({ milestoneUpdates: true, exceptionsOnly: false, preferredFrequency: 'WEEKLY' }),
      is_active: true,
    },
  ];
  await knex('clients').insert(clients);

  // ─── National Agents ───
  const nationalAgents = [
    { id: randomUUID(), name: 'Hoffmann & Partner', country_code: 'DE', contact_email: 'ep@hoffmann.de', on_time_filing_rate: 0.98, quality_score: 95, responsiveness_score: 90, is_active: true, is_up_certified: true, average_acknowledgment_hours: 4 },
    { id: randomUUID(), name: 'Cabinet Dupont', country_code: 'FR', contact_email: 'ep@dupont.fr', on_time_filing_rate: 0.96, quality_score: 92, responsiveness_score: 85, is_active: true, is_up_certified: true, average_acknowledgment_hours: 6 },
    { id: randomUUID(), name: 'Rossi & Associates', country_code: 'IT', contact_email: 'ep@rossi.it', on_time_filing_rate: 0.94, quality_score: 88, responsiveness_score: 80, is_active: true, is_up_certified: false, average_acknowledgment_hours: 8 },
    { id: randomUUID(), name: 'Van der Berg Patents', country_code: 'NL', contact_email: 'ep@vdberg.nl', on_time_filing_rate: 0.99, quality_score: 97, responsiveness_score: 95, is_active: true, is_up_certified: true, average_acknowledgment_hours: 3 },
    { id: randomUUID(), name: 'Kowalski IP', country_code: 'PL', contact_email: 'ep@kowalski.pl', on_time_filing_rate: 0.91, quality_score: 85, responsiveness_score: 75, is_active: true, is_up_certified: false, average_acknowledgment_hours: 12 },
    { id: randomUUID(), name: 'Svensson Patent AB', country_code: 'SE', contact_email: 'ep@svensson.se', on_time_filing_rate: 0.97, quality_score: 93, responsiveness_score: 92, is_active: true, is_up_certified: true, average_acknowledgment_hours: 5 },
    { id: randomUUID(), name: 'García & Márquez', country_code: 'ES', contact_email: 'ep@garcia.es', on_time_filing_rate: 0.93, quality_score: 87, responsiveness_score: 78, is_active: true, is_up_certified: false, average_acknowledgment_hours: 10 },
  ];
  await knex('national_agents').insert(nationalAgents);

  // ─── Translators ───
  const translators = [
    {
      id: randomUUID(),
      name: 'Dr. Klaus Weber',
      email: 'k.weber@chemtrans.de',
      language_pairs: JSON.stringify([{ source: 'EN', target: 'DE' }, { source: 'EN', target: 'FR' }]),
      technical_domains: ['CHEMISTRY', 'PHARMA'],
      is_up_certified: true,
      quality_score: 96,
      on_time_delivery_rate: 0.97,
      current_workload: 3,
      max_workload: 8,
      is_available: true,
    },
    {
      id: randomUUID(),
      name: 'Marie Laurent',
      email: 'm.laurent@techpatent.fr',
      language_pairs: JSON.stringify([{ source: 'EN', target: 'FR' }, { source: 'EN', target: 'IT' }]),
      technical_domains: ['MECHANICAL', 'ELECTRONICS'],
      is_up_certified: true,
      quality_score: 94,
      on_time_delivery_rate: 0.95,
      current_workload: 2,
      max_workload: 10,
      is_available: true,
    },
    {
      id: randomUUID(),
      name: 'Piotr Nowak',
      email: 'p.nowak@patentpl.com',
      language_pairs: JSON.stringify([{ source: 'EN', target: 'PL' }]),
      technical_domains: ['MECHANICAL', 'SOFTWARE', 'ELECTRONICS'],
      is_up_certified: false,
      quality_score: 89,
      on_time_delivery_rate: 0.92,
      current_workload: 1,
      max_workload: 6,
      is_available: true,
    },
  ];
  await knex('translators').insert(translators);

  // ─── Sample Patent Cases ───
  const thirtyDays = new Date();
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  const ninetyDays = new Date();
  ninetyDays.setDate(ninetyDays.getDate() + 90);
  const tenDays = new Date();
  tenDays.setDate(tenDays.getDate() + 10);

  const cases = [
    {
      id: randomUUID(),
      ep_number: 'EP3456789',
      client_id: 'c1000000-0000-0000-0000-000000000001',
      pathway: 'CLASSICAL',
      status: 'TRANSLATION_IN_PROGRESS',
      validation_deadline: thirtyDays,
      applicant_name: 'Acme Corporation',
      target_states: ['DE', 'FR', 'GB', 'IT', 'NL', 'ES'],
      technical_domain: 'CHEMISTRY',
      claims_count: 15,
      drawing_sheets: 8,
      is_up_eligible: false,
      up_opt_out_registered: false,
      risk_score: 45,
      risk_tier: 'MEDIUM',
      poa_status: 'RECEIVED',
      assigned_agent_ids: JSON.stringify({}),
      translation_job_ids: '{}',
      created_by: 'seed',
      correlation_id: randomUUID(),
    },
    {
      id: randomUUID(),
      ep_number: 'EP4567890',
      client_id: 'c1000000-0000-0000-0000-000000000001',
      pathway: 'UNITARY',
      status: 'VERIFIED',
      validation_deadline: ninetyDays,
      applicant_name: 'Acme Corporation',
      target_states: ['DE', 'FR', 'IT', 'NL', 'BE', 'SE', 'PL'],
      technical_domain: 'BIOTECH',
      claims_count: 22,
      drawing_sheets: 12,
      is_up_eligible: true,
      up_opt_out_registered: false,
      risk_score: 15,
      risk_tier: 'LOW',
      poa_status: 'PENDING',
      assigned_agent_ids: JSON.stringify({}),
      translation_job_ids: '{}',
      created_by: 'seed',
      correlation_id: randomUUID(),
    },
    {
      id: randomUUID(),
      ep_number: 'EP2345678',
      client_id: 'c1000000-0000-0000-0000-000000000002',
      pathway: 'CLASSICAL',
      status: 'QUARANTINED',
      validation_deadline: tenDays,
      applicant_name: 'TechStartup GmbH',
      target_states: ['DE', 'FR'],
      technical_domain: 'SOFTWARE',
      claims_count: 8,
      drawing_sheets: 3,
      is_up_eligible: false,
      up_opt_out_registered: false,
      risk_score: 88,
      risk_tier: 'CRITICAL',
      poa_status: 'PENDING',
      assigned_agent_ids: JSON.stringify({}),
      translation_job_ids: '{}',
      created_by: 'seed',
      correlation_id: randomUUID(),
    },
  ];
  await knex('patent_cases').insert(cases);

  console.log('✅ Seed data inserted successfully');
}
