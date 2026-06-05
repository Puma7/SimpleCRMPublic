import type {
  ServerEvent,
  ServerEventSubscription,
} from './types';

export type ServerEventSubscriber = (event: ServerEvent) => void | Promise<void>;

export type InMemoryServerEventBus = Readonly<{
  publish(event: ServerEvent): Promise<void>;
  subscribe(subscriber: ServerEventSubscriber): ServerEventSubscription;
  replay(input: {
    workspaceId: string;
    afterSequence?: number;
    limit?: number;
  }): readonly ServerEvent[];
}>;

export function createInMemoryServerEventBus(
  options: { replayLimit?: number } = {},
): InMemoryServerEventBus {
  const subscribers = new Set<ServerEventSubscriber>();
  const history: ServerEvent[] = [];
  const replayLimit = normalizeReplayLimit(options.replayLimit);
  let nextSequence = 1;

  return {
    async publish(event) {
      const sequencedEvent = {
        ...event,
        sequence: nextSequence,
      } satisfies ServerEvent;
      nextSequence += 1;
      history.push(sequencedEvent);
      while (history.length > replayLimit) {
        history.shift();
      }
      for (const subscriber of [...subscribers]) {
        await subscriber(sequencedEvent);
      }
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return {
        unsubscribe() {
          subscribers.delete(subscriber);
        },
      };
    },
    replay(input) {
      const afterSequence = input.afterSequence ?? 0;
      const limit = normalizeReplayLimit(input.limit ?? replayLimit);
      return history
        .filter((event) => event.workspaceId === input.workspaceId && (event.sequence ?? 0) > afterSequence)
        .slice(0, limit);
    },
  };
}

function normalizeReplayLimit(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) return 1000;
  return Math.min(value, 10_000);
}
