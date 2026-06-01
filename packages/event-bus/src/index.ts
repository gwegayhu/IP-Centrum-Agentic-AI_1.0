import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { DomainEvent, EventPayload, EventName } from '@ip-centrum/shared';
import { createLogger } from '@ip-centrum/shared';

const logger = createLogger('event-bus');

// =============================================
// EVENT BUS — Redis Streams implementation
// Provides reliable, ordered, persistent event delivery
// =============================================

export class EventBus {
  private publisher: Redis;
  private subscriber: Redis;
  private handlers: Map<string, Array<(event: DomainEvent) => Promise<void>>> = new Map();
  private consumerGroupPrefix = 'ip-centrum';

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    this.subscriber = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.publisher.on('error', (err) => logger.error('Redis publisher error', { data: { error: err.message } }));
    this.subscriber.on('error', (err) => logger.error('Redis subscriber error', { data: { error: err.message } }));
  }

  async connect() {
    await this.publisher.connect();
    await this.subscriber.connect();
    logger.info('Event bus connected to Redis');
  }

  async disconnect() {
    await this.publisher.quit();
    await this.subscriber.quit();
  }

  // Publish an event to a Redis Stream
  async publish<T extends EventPayload>(
    eventType: EventName,
    payload: T,
    meta: {
      source: string;
      correlationId: string;
      caseId?: string;
    }
  ): Promise<string> {
    const event: DomainEvent<T> = {
      id: randomUUID(),
      type: eventType,
      version: 1,
      timestamp: new Date().toISOString(),
      source: meta.source,
      correlationId: meta.correlationId,
      payload,
    };

    const streamKey = `events:${eventType}`;
    const messageId = await this.publisher.xadd(
      streamKey,
      '*', // auto-ID
      'event', JSON.stringify(event),
      'type', eventType,
      'source', meta.source,
      'correlationId', meta.correlationId,
      ...(meta.caseId ? ['caseId', meta.caseId] : [])
    );

    logger.info(`Event published: ${eventType}`, {
      correlationId: meta.correlationId,
      caseId: meta.caseId,
      data: { eventId: event.id, messageId },
    });

    return messageId!;
  }

  // Subscribe an agent to a specific event type
  async subscribe(
    eventType: EventName,
    consumerName: string,
    handler: (event: DomainEvent) => Promise<void>
  ) {
    const streamKey = `events:${eventType}`;
    const groupName = `${this.consumerGroupPrefix}:${consumerName}`;

    // Ensure consumer group exists
    try {
      await this.subscriber.xgroup('CREATE', streamKey, groupName, '$', 'MKSTREAM');
    } catch (err: unknown) {
      const error = err as { message?: string };
      if (!error.message?.includes('BUSYGROUP')) throw err;
    }

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);

    // Start reading loop
    this.startReadLoop(streamKey, groupName, consumerName, handler);
  }

  private async startReadLoop(
    streamKey: string,
    groupName: string,
    consumerName: string,
    handler: (event: DomainEvent) => Promise<void>
  ) {
    while (true) {
      try {
        const messages = await this.subscriber.xreadgroup(
          'GROUP', groupName, consumerName,
          'COUNT', 10,
          'BLOCK', 5000, // 5 second block
          'STREAMS', streamKey,
          '>' // only undelivered messages
        );

        if (!messages) continue;

        for (const [, entries] of messages) {
          for (const [messageId, fields] of entries) {
            try {
              const eventJson = fields[fields.indexOf('event') + 1];
              const event: DomainEvent = JSON.parse(eventJson);

              await handler(event);

              // Acknowledge successful processing
              await this.subscriber.xack(streamKey, groupName, messageId);
            } catch (err) {
              logger.error(`Failed to process event from ${streamKey}`, {
                data: { messageId, error: String(err) },
              });
              // Message stays unacknowledged for retry
            }
          }
        }
      } catch (err) {
        logger.error('Read loop error', { data: { streamKey, error: String(err) } });
        await new Promise(r => setTimeout(r, 1000)); // backoff
      }
    }
  }

  // Get the Redis client for health checks
  getClient() {
    return this.publisher;
  }
}

// Singleton for use across the application
let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    eventBusInstance = new EventBus(redisUrl);
  }
  return eventBusInstance;
}

export { DomainEvent, EventPayload };
