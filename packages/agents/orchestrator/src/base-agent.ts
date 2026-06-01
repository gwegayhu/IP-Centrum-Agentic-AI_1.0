import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import {
  AgentResult,
  Alert,
  createLogger,
  generateId,
  AGENT_IDS,
  MIN_CONFIDENCE_THRESHOLD,
} from '@ip-centrum/shared';
import { getDb, AuditLogRepository } from '@ip-centrum/database';

// =============================================
// BASE AGENT CLASS
// All 10 IP Centrum agents extend this
// =============================================

export interface AgentContext {
  caseId?: string;
  correlationId: string;
  requestedBy?: string;
  dryRun?: boolean;
}

export interface AgentRunOptions<TInput> {
  input: TInput;
  context: AgentContext;
}

export abstract class BaseAgent<TInput, TOutput> {
  protected readonly client: Anthropic;
  protected readonly logger;
  protected readonly auditLog: AuditLogRepository;

  abstract readonly agentId: string;
  abstract readonly agentVersion: string;
  abstract readonly modelTier: 'standard' | 'complex';

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.logger = createLogger(this.constructor.name);
    this.auditLog = new AuditLogRepository(getDb());
  }

  protected get model(): string {
    return this.modelTier === 'complex'
      ? (process.env.ANTHROPIC_MODEL_COMPLEX || 'claude-opus-4-20250514')
      : (process.env.ANTHROPIC_MODEL_STANDARD || 'claude-sonnet-4-20250514');
  }

  // Subclasses implement this
  protected abstract execute(
    input: TInput,
    context: AgentContext
  ): Promise<{
    output: TOutput;
    reasoning: string;
    confidence: number;
    alerts: Alert[];
    requiresHumanGate: boolean;
    humanGateAction?: string;
  }>;

  // Public entry point — wraps execute with audit, timing, error handling
  async run(options: AgentRunOptions<TInput>): Promise<AgentResult> {
    const { input, context } = options;
    const startMs = Date.now();

    this.logger.info(`Agent starting: ${this.agentId}`, {
      caseId: context.caseId,
      correlationId: context.correlationId,
    });

    let result: AgentResult;

    try {
      const { output, reasoning, confidence, alerts, requiresHumanGate, humanGateAction } =
        await this.execute(input, context);

      // Enforce minimum confidence gate
      if (confidence < MIN_CONFIDENCE_THRESHOLD && requiresHumanGate) {
        this.logger.warn('Confidence below threshold — escalating to human gate', {
          caseId: context.caseId,
          confidence,
          data: { threshold: MIN_CONFIDENCE_THRESHOLD },
        });
      }

      result = {
        agentId: this.agentId,
        agentVersion: this.agentVersion,
        caseId: context.caseId,
        success: true,
        confidence,
        reasoning,
        data: output as Record<string, unknown>,
        alerts,
        requiresHumanGate: requiresHumanGate || confidence < MIN_CONFIDENCE_THRESHOLD,
        humanGateAction,
        executionMs: Date.now() - startMs,
        modelUsed: this.model,
        createdAt: new Date(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Agent failed: ${this.agentId}`, {
        caseId: context.caseId,
        data: { error: errorMessage },
      });

      result = {
        agentId: this.agentId,
        agentVersion: this.agentVersion,
        caseId: context.caseId,
        success: false,
        confidence: 0,
        reasoning: `Agent execution failed: ${errorMessage}`,
        data: { error: errorMessage },
        alerts: [],
        requiresHumanGate: true, // Failed agents always escalate
        humanGateAction: `Manual review required — ${this.agentId} failed`,
        executionMs: Date.now() - startMs,
        modelUsed: this.model,
        createdAt: new Date(),
      };
    }

    // Mandatory audit log for every agent run
    if (!context.dryRun) {
      await this.auditLog.log({
        agentId: result.agentId,
        agentVersion: result.agentVersion,
        caseId: context.caseId,
        action: `${this.agentId}.run`,
        success: result.success,
        confidence: result.confidence,
        reasoning: result.reasoning,
        inputData: input as Record<string, unknown>,
        outputData: result.data,
        requiredHumanGate: result.requiresHumanGate,
        humanGateAction: result.humanGateAction,
        executionMs: result.executionMs,
        modelUsed: result.modelUsed,
        correlationId: context.correlationId,
      });
    }

    this.logger.auditDecision(`Agent completed: ${this.agentId}`, {
      caseId: context.caseId,
      confidence: result.confidence,
      reasoning: result.reasoning,
    });

    return result;
  }

  // Helper: call Claude with a structured prompt and parse JSON response
  protected async callClaude<T>(systemPrompt: string, userPrompt: string): Promise<{
    parsed: T;
    rawText: string;
    tokensUsed: number;
  }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '4096'),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const rawText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    // Extract JSON from response
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/) || 
                      rawText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error(`No valid JSON in Claude response: ${rawText.slice(0, 200)}`);
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed: T = JSON.parse(jsonStr);

    return {
      parsed,
      rawText,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }

  // Helper: create a structured alert
  protected createAlert(params: {
    type: Alert['type'];
    severity: Alert['severity'];
    title: string;
    description: string;
    recommendedAction: string;
    caseId?: string;
    data?: Record<string, unknown>;
  }): Alert {
    const { ALERT_SLA_HOURS, ALERT_ROUTING, DEFAULT_IF_UNACKNOWLEDGED } = 
      require('@ip-centrum/shared');

    return {
      id: generateId(),
      type: params.type,
      caseId: params.caseId,
      severity: params.severity,
      title: params.title,
      description: params.description,
      recommendedAction: params.recommendedAction,
      routeTo: ALERT_ROUTING[params.type] || 'CONTROL_CENTRE_MANAGER',
      acknowledgmentSlaHours: ALERT_SLA_HOURS[params.type] || 4,
      defaultIfUnacknowledged: DEFAULT_IF_UNACKNOWLEDGED[params.type] || 'ESCALATE',
      agentId: this.agentId,
      data: params.data,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    };
  }
}
