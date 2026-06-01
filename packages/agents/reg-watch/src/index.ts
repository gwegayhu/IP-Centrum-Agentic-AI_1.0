import { BaseAgent, AgentContext } from '../../orchestrator/src/base-agent';
import { Alert, AGENT_IDS } from '@ip-centrum/shared';
import { getDb } from '@ip-centrum/database';

// =============================================
// AGENT 3: RegWatch — Regulatory Intelligence
// Risk: LOW | Cascade: MEDIUM
// Monitors EPO/WIPO/UPC publications for changes; maintains Law Engine
// =============================================

export interface RegWatchInput {
  scanSources?: Array<'EPO' | 'WIPO' | 'UPC' | 'NATIONAL_OFFICE'>;
  specificCountryCodes?: string[];
  forceFullScan?: boolean;
}

export interface RegWatchOutput {
  changesDetected: number;
  changes: Array<{
    id: string;
    source: string;
    countryCode?: string;
    changeType: string;
    title: string;
    description: string;
    effectiveDate: string;
    affectedCasesCount: number;
    proposedLawEngineUpdate: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
  }>;
  scanCompletedAt: string;
  nextScheduledScan: string;
  staleSources: string[];
}

// Monitored regulatory sources
const REGULATORY_SOURCES = [
  {
    id: 'EPO_OFFICIAL_JOURNAL',
    url: 'https://www.epo.org/en/legal/official-journal.html',
    name: 'EPO Official Journal',
    type: 'EPO' as const,
  },
  {
    id: 'UPC_REGISTRY',
    url: 'https://www.unified-patent-court.org/en/news',
    name: 'UPC Registry News',
    type: 'UPC' as const,
  },
  {
    id: 'WIPO_GAZETTE',
    url: 'https://www.wipo.int/pct/en/official_notices',
    name: 'WIPO Gazette',
    type: 'WIPO' as const,
  },
];

export class RegWatchAgent extends BaseAgent<RegWatchInput, RegWatchOutput> {
  readonly agentId = AGENT_IDS.REG_WATCH;
  readonly agentVersion = '1.0.0';
  readonly modelTier = 'standard' as const;

  protected async execute(input: RegWatchInput, context: AgentContext) {
    const alerts: Alert[] = [];
    const changesDetected: RegWatchOutput['changes'] = [];
    const staleSources: string[] = [];

    const sourcesToScan = input.scanSources || ['EPO', 'WIPO', 'UPC'];

    // Scan each regulatory source
    for (const source of REGULATORY_SOURCES) {
      if (!sourcesToScan.includes(source.type)) continue;

      try {
        const sourceContent = await this.fetchRegulatorySource(source.url);

        const systemPrompt = `You are RegWatch, the regulatory intelligence agent for IP Centrum.
Your role is to monitor official patent office publications and identify changes that 
affect IP Centrum's operations: fee changes, deadline rule amendments, translation 
requirement updates, UP/UPC developments, and territorial changes.

For each change detected, you must:
1. Classify the change type precisely
2. Assess which active cases might be affected
3. Draft a proposed Law Engine update (specific, actionable text)
4. Assess severity: HIGH (affects active cases immediately), MEDIUM (affects future cases), LOW (monitoring)

Current date: ${new Date().toISOString().split('T')[0]}
Only report genuine regulatory changes — not general news or press releases.
Respond ONLY with valid JSON.`;

        const userPrompt = `Analyse this regulatory source for changes relevant to EP patent validation:

Source: ${source.name} (${source.type})
URL: ${source.url}
Content:
${sourceContent.slice(0, 8000)} // Truncated for token management

Identify any regulatory changes and return JSON:
{
  "changes": [
    {
      "source": "${source.type}",
      "countryCode": "2-letter ISO or null",
      "changeType": "FEE_CHANGE|DEADLINE_RULE|TRANSLATION_REQUIREMENT|UP_TERRITORIAL|PROCEDURAL",
      "title": "concise title",
      "description": "detailed description of the change",
      "effectiveDate": "YYYY-MM-DD",
      "affectedCasesCount": estimated_number_or_0,
      "proposedLawEngineUpdate": "specific update text for Law Engine",
      "severity": "LOW|MEDIUM|HIGH"
    }
  ],
  "scanStatus": "SUCCESS|STALE|ERROR",
  "reasoning": "explanation of what was found"
}`;

        const { parsed } = await this.callClaude<{
          changes: Array<{
            source: string;
            countryCode?: string;
            changeType: string;
            title: string;
            description: string;
            effectiveDate: string;
            affectedCasesCount: number;
            proposedLawEngineUpdate: string;
            severity: string;
          }>;
          scanStatus: string;
          reasoning: string;
        }>(systemPrompt, userPrompt);

        if (parsed.scanStatus === 'STALE') {
          staleSources.push(source.name);
        }

        // Store detected changes
        for (const change of parsed.changes) {
          const db = getDb();
          const [stored] = await db('regulatory_changes').insert({
            source: change.source,
            country_code: change.countryCode,
            change_type: change.changeType,
            title: change.title,
            description: change.description,
            effective_date: change.effectiveDate,
            affected_cases_count: change.affectedCasesCount,
            proposed_law_engine_update: change.proposedLawEngineUpdate,
            status: 'DETECTED',
            detected_at: new Date(),
          }).returning('*');

          changesDetected.push({
            id: stored.id,
            source: change.source,
            countryCode: change.countryCode,
            changeType: change.changeType,
            title: change.title,
            description: change.description,
            effectiveDate: change.effectiveDate,
            affectedCasesCount: change.affectedCasesCount,
            proposedLawEngineUpdate: change.proposedLawEngineUpdate,
            severity: change.severity as 'LOW' | 'MEDIUM' | 'HIGH',
          });

          // Alert for high-severity changes
          if (change.severity === 'HIGH') {
            alerts.push(
              this.createAlert({
                type: 'REGULATORY_CHANGE',
                severity: 'HIGH',
                title: `HIGH-IMPACT REGULATORY CHANGE: ${change.title}`,
                description:
                  `${change.source} has published a change affecting ${change.affectedCasesCount} active cases. ` +
                  `Effective: ${change.effectiveDate}. ` +
                  `Proposed Law Engine update staged for approval.`,
                recommendedAction:
                  'Review and approve proposed Law Engine update within 24 hours',
                data: {
                  changeId: stored.id,
                  proposedUpdate: change.proposedLawEngineUpdate,
                  affectedCases: change.affectedCasesCount,
                },
              })
            );
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to scan ${source.name}`, {
          data: { source: source.id, error: String(err) },
        });
        staleSources.push(source.name);

        // Flag stale source — do NOT suppress
        alerts.push(
          this.createAlert({
            type: 'REGULATORY_CHANGE',
            severity: 'MEDIUM',
            title: `STALE SOURCE: ${source.name} could not be scanned`,
            description:
              `RegWatch was unable to access ${source.name}. ` +
              `Regulatory data from this source may be outdated. ` +
              `Last successful scan time is unknown.`,
            recommendedAction:
              'Manual check of source required. Do not assume no changes have occurred.',
            data: { sourceUrl: source.url, error: String(err) },
          })
        );
      }
    }

    // Compute next scan time — more frequent if changes detected
    const nextScanHours = changesDetected.length > 0 ? 4 : 24;
    const nextScan = new Date();
    nextScan.setHours(nextScan.getHours() + nextScanHours);

    const output: RegWatchOutput = {
      changesDetected: changesDetected.length,
      changes: changesDetected,
      scanCompletedAt: new Date().toISOString(),
      nextScheduledScan: nextScan.toISOString(),
      staleSources,
    };

    return {
      output,
      reasoning: `Scanned ${sourcesToScan.length} regulatory sources. Found ${changesDetected.length} changes. ${staleSources.length} sources stale.`,
      confidence: staleSources.length === 0 ? 0.95 : 0.7,
      alerts,
      requiresHumanGate: changesDetected.some(c => c.severity === 'HIGH'),
      humanGateAction: changesDetected.some(c => c.severity === 'HIGH')
        ? 'Review and approve high-impact Law Engine updates within 24 hours'
        : undefined,
    };
  }

  private async fetchRegulatorySource(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'IP-Centrum-RegWatch/1.0 (regulatory-monitoring@ip-centrum.com)',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }
}
