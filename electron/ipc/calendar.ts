import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import {
  getAllCalendarEvents,
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntry,
  type SqliteCalendarEntryMutationInput,
} from '../sqlite-service';

interface CalendarHandlersOptions {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
}

type Disposer = () => void;

export function registerCalendarHandlers(options: CalendarHandlersOptions) {
  const { logger } = options;
  const disposers: Disposer[] = [];

  disposers.push(
    registerIpcHandler(IPCChannels.Calendar.GetCalendarEvents, async (_event, params: { startDate?: string; endDate?: string } = {}) => {
      try {
        const { startDate, endDate } = params ?? {};
        return getAllCalendarEvents(startDate, endDate);
      } catch (error) {
        logger.error('IPC Error getting calendar events:', error);
        return [];
      }
    }, { logger })
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Calendar.AddCalendarEvent, async (_event, eventData: SqliteCalendarEntryMutationInput | SqliteCalendarEntryMutationInput['event']) => {
      try {
        const input = 'event' in eventData ? eventData : { event: eventData };
        return createCalendarEntry(input);
      } catch (error) {
        logger.error('IPC Error adding calendar event:', error);
        return { success: false, error: (error as Error).message };
      }
    }, { logger })
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Calendar.UpdateCalendarEvent, async (_event, payload: {
      id: number;
      event?: SqliteCalendarEntryMutationInput['event'];
      eventData?: SqliteCalendarEntryMutationInput['event'];
      schedule?: SqliteCalendarEntryMutationInput['schedule'];
    }) => {
      try {
        if (!payload) {
          throw new Error('No payload provided for calendar update.');
        }

        if (!Number.isInteger(payload.id) || payload.id <= 0) {
          throw new Error('Missing calendar event ID for update.');
        }

        const normalizedEventData = payload.event ?? payload.eventData;
        if (!normalizedEventData || Object.keys(normalizedEventData).length === 0) {
          throw new Error('Missing calendar event data for update.');
        }

        return updateCalendarEntry(payload.id, {
          event: normalizedEventData,
          ...(payload.schedule ? { schedule: payload.schedule } : {}),
        });
      } catch (error) {
        logger.error('IPC Error updating calendar event:', error);
        return { success: false, error: (error as Error).message };
      }
    }, { logger })
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Calendar.DeleteCalendarEvent, async (_event, eventId: number) => {
      try {
        return deleteCalendarEntry(eventId);
      } catch (error) {
        logger.error('IPC Error deleting calendar event:', error);
        return { success: false, error: (error as Error).message };
      }
    }, { logger })
  );

  return () => {
    disposers.forEach((dispose) => dispose());
  };
}
