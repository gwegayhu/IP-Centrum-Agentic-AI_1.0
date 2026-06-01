import { createHash, randomUUID } from 'crypto';

// =============================================
// LOGGER — structured, audit-compliant
// =============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  agentId?: string;
  caseId?: string;
  correlationId?: string;
  message: string;
  data?: Record<string, unknown>;
  confidence?: number;
  reasoning?: string;
}

export function createLogger(agentId: string) {
  const log = (level: LogLevel, message: string, meta?: Partial<LogEntry>) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      agentId,
      message,
      ...meta,
    };
    // In production, this ships to your log aggregator (Datadog, CloudWatch, etc.)
    if (process.env.NODE_ENV === 'test') return;
    console.log(JSON.stringify(entry));
  };

  return {
    debug: (msg: string, meta?: Partial<LogEntry>) => log('debug', msg, meta),
    info: (msg: string, meta?: Partial<LogEntry>) => log('info', msg, meta),
    warn: (msg: string, meta?: Partial<LogEntry>) => log('warn', msg, meta),
    error: (msg: string, meta?: Partial<LogEntry>) => log('error', msg, meta),
    auditDecision: (msg: string, meta: {
      caseId?: string;
      confidence: number;
      reasoning: string;
      data?: Record<string, unknown>;
    }) => log('info', `[AUDIT] ${msg}`, meta),
  };
}

// =============================================
// RETRY WITH EXPONENTIAL BACKOFF
// =============================================

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    maxDelayMs = 10000,
    backoffFactor = 2,
    onRetry,
  } = options;

  let lastError: Error;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maxAttempts) break;
      const delay = Math.min(
        initialDelayMs * Math.pow(backoffFactor, attempt - 1),
        maxDelayMs
      );
      onRetry?.(attempt, lastError);
      await sleep(delay);
    }
  }
  throw lastError!;
}

// =============================================
// CIRCUIT BREAKER
// =============================================

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number; // ms before trying again
  onOpen?: () => void;
  onClose?: () => void;
}

export class CircuitBreaker {
  private failures = 0;
  private successes = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private lastFailureTime = 0;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions = {}
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const {
      failureThreshold = 5,
      successThreshold = 2,
      timeout = 60000,
    } = this.options;

    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > timeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.name} — failing fast`);
      }
    }

    try {
      const result = await fn();
      if (this.state === 'HALF_OPEN') {
        this.successes++;
        if (this.successes >= successThreshold) {
          this.state = 'CLOSED';
          this.failures = 0;
          this.successes = 0;
          this.options.onClose?.();
        }
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      if (this.failures >= failureThreshold) {
        this.state = 'OPEN';
        this.options.onOpen?.();
      }
      throw error;
    }
  }

  getState() {
    return this.state;
  }
}

// =============================================
// UTILITIES
// =============================================

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const generateId = () => randomUUID();

export const generateCorrelationId = (epNumber: string, clientId: string) =>
  createHash('sha256')
    .update(`${epNumber}:${clientId}:${Date.now()}`)
    .digest('hex')
    .slice(0, 16);

export const daysUntil = (date: Date): number => {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

export const isWithinDays = (date: Date, days: number): boolean =>
  daysUntil(date) <= days;

export function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

// Mask sensitive data for logging
export const maskSensitive = (str: string): string => {
  if (!str || str.length < 8) return '***';
  return `${str.slice(0, 4)}${'*'.repeat(str.length - 8)}${str.slice(-4)}`;
};
