import type { XmtpMessage } from './client';

/**
 * The payload emitted by every decoded XMTP application message.
 *
 * `ownerInboxId` is optional so older producers remain compatible while newer
 * producers can identify the inbox that owned a history-sync operation.
 */
export interface XmtpMessageEventDetail {
  conversationId: string;
  message: XmtpMessage;
  isHistory?: boolean;
  ownerInboxId?: string;
  scanReason?: string;
}

export type XmtpMessageConsumer = (
  detail: XmtpMessageEventDetail
) => void | Promise<void>;

export interface XmtpSystemEventDetail {
  conversationId: string;
  ownerInboxId?: string;
  system: {
    id: string;
    senderInboxId?: string;
    body: string;
    sentAt?: number;
  };
}

export interface XmtpReactionEventDetail {
  conversationId: string;
  ownerInboxId?: string;
  referenceMessageId: string;
  emoji: string;
  action: string;
  senderInboxId?: string;
}

export interface XmtpGroupUpdatedEventDetail {
  conversationId: string;
  ownerInboxId?: string;
  content: unknown;
}

export type XmtpDurableSideEffect =
  | { type: 'system'; detail: XmtpSystemEventDetail }
  | { type: 'reaction'; detail: XmtpReactionEventDetail }
  | { type: 'group-updated'; detail: XmtpGroupUpdatedEventDetail };

export type XmtpDurableSideEffectConsumer = (
  effect: XmtpDurableSideEffect
) => void | Promise<void>;

export const XMTP_MESSAGE_CONSUMER_READY_EVENT =
  'xmtp:message-consumer-ready';

interface RegisteredConsumer {
  token: symbol;
  consume: XmtpMessageConsumer;
}

interface RegisteredSideEffectConsumer {
  token: symbol;
  consume: XmtpDurableSideEffectConsumer;
}

let registeredConsumer: RegisteredConsumer | null = null;
let registeredSideEffectConsumer: RegisteredSideEffectConsumer | null = null;
let consumerGeneration = 0;

// Map preserves insertion order, giving us an unbounded-by-policy FIFO while
// also suppressing history/live replays of the same XMTP message before the
// authenticated application shell is ready to persist them.
const bufferedMessages = new Map<string, XmtpMessageEventDetail>();
const bufferedSideEffects: XmtpDurableSideEffect[] = [];
let anonymousMessageSequence = 0;

// Every canonical consumer call is appended to this chain. Keeping failures
// contained ensures one malformed message cannot prevent later messages from
// being persisted.
let ingestionTail: Promise<void> = Promise.resolve();
let ingestionFailureCount = 0;

function messageBufferKey(detail: XmtpMessageEventDetail): string {
  const messageId = detail.message?.id?.trim();
  if (messageId) {
    return messageId;
  }

  anonymousMessageSequence += 1;
  return `anonymous:${anonymousMessageSequence}`;
}

function enqueueWork(work: () => void | Promise<void>): Promise<void> {
  const result = ingestionTail.then(work);
  ingestionTail = result.catch((error) => {
    ingestionFailureCount += 1;
    console.error('[XMTP] Failed to ingest message event:', error);
  });
  // Keep the shared tail recoverable so one malformed message cannot block
  // later work, while returning the individual result so an awaited history
  // replay can tell whether this specific message was durably consumed.
  return result;
}

function enqueueForConsumer(
  consume: XmtpMessageConsumer,
  detail: XmtpMessageEventDetail
): Promise<void> {
  return enqueueWork(() => consume(detail));
}

function announceDurableConsumersReady(): void {
  if (
    registeredConsumer &&
    registeredSideEffectConsumer &&
    typeof window !== 'undefined'
  ) {
    window.dispatchEvent(new Event(XMTP_MESSAGE_CONSUMER_READY_EVENT));
  }
}

/**
 * Dispatch a decoded XMTP message.
 *
 * The DOM event remains synchronous for diagnostics and existing integrations.
 * Application persistence is handled separately by the single canonical async
 * consumer so history batches cannot race one another. If that consumer has
 * not mounted yet, messages are retained in memory and drained in FIFO order
 * once it registers.
 */
export function dispatchXmtpMessage(
  detail: XmtpMessageEventDetail
): Promise<void> {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<XmtpMessageEventDetail>('xmtp:message', { detail })
    );
  }

  const consumer = registeredConsumer;
  if (consumer) {
    return enqueueForConsumer(consumer.consume, detail);
  }

  const key = messageBufferKey(detail);
  if (!bufferedMessages.has(key)) {
    bufferedMessages.set(key, detail);
  }
  return Promise.resolve();
}

/**
 * Install the application's canonical message consumer and drain any messages
 * produced before the authenticated layout mounted.
 *
 * Registration cleanup is token-scoped so a stale React effect cleanup cannot
 * accidentally unregister a newer consumer.
 */
export function registerXmtpMessageConsumer(
  consume: XmtpMessageConsumer
): () => void {
  const token = Symbol('xmtp-message-consumer');
  registeredConsumer = { token, consume };
  consumerGeneration += 1;

  const buffered = Array.from(bufferedMessages.values());
  bufferedMessages.clear();
  for (const detail of buffered) {
    void enqueueForConsumer(consume, detail);
  }
  announceDurableConsumersReady();

  return () => {
    if (registeredConsumer?.token === token) {
      registeredConsumer = null;
      consumerGeneration += 1;
    }
  };
}

/** Dispatch a durable non-message XMTP event through the same FIFO tail. */
export function dispatchXmtpDurableSideEffect(
  effect: XmtpDurableSideEffect
): Promise<void> {
  if (typeof window !== 'undefined') {
    const eventName =
      effect.type === 'system'
        ? 'xmtp:system'
        : effect.type === 'reaction'
          ? 'xmtp:reaction'
          : 'xmtp:group-updated';
    window.dispatchEvent(new CustomEvent(eventName, { detail: effect.detail }));
  }

  const consumer = registeredSideEffectConsumer;
  if (consumer) {
    return enqueueWork(() => consumer.consume(effect));
  }
  bufferedSideEffects.push(effect);
  return Promise.resolve();
}

/** Install the canonical persistence consumer for system/reaction/group events. */
export function registerXmtpDurableSideEffectConsumer(
  consume: XmtpDurableSideEffectConsumer
): () => void {
  const token = Symbol('xmtp-durable-side-effect-consumer');
  registeredSideEffectConsumer = { token, consume };
  consumerGeneration += 1;

  const buffered = bufferedSideEffects.splice(0, bufferedSideEffects.length);
  for (const effect of buffered) {
    void enqueueWork(() => consume(effect));
  }
  announceDurableConsumersReady();

  return () => {
    if (registeredSideEffectConsumer?.token === token) {
      registeredSideEffectConsumer = null;
      consumerGeneration += 1;
    }
  };
}

/** Wait until all messages currently assigned to a canonical consumer settle. */
export function awaitXmtpMessageIngestion(): Promise<void> {
  return ingestionTail;
}

/** Whether decoded messages can currently be durably consumed by the app. */
export function hasXmtpMessageConsumer(): boolean {
  return registeredConsumer !== null;
}

export function hasXmtpDurableConsumers(): boolean {
  return registeredConsumer !== null && registeredSideEffectConsumer !== null;
}

/** Monotonic count used to prevent repair checkpoints after a durable write failure. */
export function getXmtpMessageIngestionFailureCount(): number {
  return ingestionFailureCount;
}

/** Changes whenever the canonical consumer is installed, replaced, or removed. */
export function getXmtpMessageConsumerGeneration(): number {
  return consumerGeneration;
}
