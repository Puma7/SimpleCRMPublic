import { IPCChannels } from '@shared/ipc/channels';
import { calendarService, TASK_EVENT_COMPLETED_COLOR, TASK_EVENT_DEFAULT_COLOR } from '@/services/data/calendarService';
import {
  configureRendererTransport,
  createHttpRendererTransport,
  resetRendererTransportForTests,
} from '@/services/transport';

const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
}) as Response;

describe('calendarService', () => {
  const invoke = jest.fn();

  beforeEach(() => {
    invoke.mockReset();
    resetRendererTransportForTests();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });
  });

  afterEach(() => {
    resetRendererTransportForTests();
  });

  test('adds task event with sqlite-compatible payload', async () => {
    invoke.mockResolvedValueOnce({ success: true, id: 42 });
    const result = await calendarService.addTaskEvent({
      title: 'Call customer',
      description: 'Follow-up',
      dueDate: '2026-03-12',
      customerName: 'Muster GmbH',
    });

    expect(result).toEqual({ success: true, id: 42 });
    expect(invoke).toHaveBeenCalledWith(
      IPCChannels.Calendar.AddCalendarEvent,
      expect.objectContaining({
        title: 'Call customer',
        start_date: '2026-03-12T00:00:00.000Z',
        end_date: '2026-03-13T00:00:00.000Z',
        all_day: true,
        color_code: TASK_EVENT_DEFAULT_COLOR,
        event_type: 'task',
      })
    );
  });

  test('adds task event through http transport without Electron API', async () => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: undefined,
    });
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        event: {
          id: 77,
          title: 'Server task',
          startDate: '2026-03-12T00:00:00.000Z',
          endDate: '2026-03-13T00:00:00.000Z',
          allDay: true,
        },
        task: null,
      },
    }, 201));
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    }));

    const result = await calendarService.addTaskEvent({
      title: 'Server task',
      dueDate: '2026-03-12',
    });

    expect(result).toEqual({ success: true, id: 77 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/calendar-entries',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }),
    );
    const requestInit = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          title: 'Server task',
          allDay: true,
          colorCode: TASK_EVENT_DEFAULT_COLOR,
          eventType: 'task',
        }),
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  test('creates a task and event through the atomic HTTP command', async () => {
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
    const fetchImpl = jest.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        event: {
          id: 78,
          title: 'Server task',
          startDate: '2026-03-12T00:00:00.000Z',
          endDate: '2026-03-13T00:00:00.000Z',
          allDay: true,
        },
        task: { id: 91, title: 'Server task', priority: 'Medium', completed: false },
      },
    }, 201));
    configureRendererTransport(createHttpRendererTransport({
      baseUrl: 'https://crm.example.com',
      fetchImpl,
    }));

    const result = await calendarService.addTaskEvent({
      title: 'Server task',
      dueDate: '2026-03-12',
      createTask: { customerId: 7, title: 'Server task' },
    });

    expect(result).toEqual({ success: true, id: 78, taskId: 91 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example.com/api/v1/calendar-entries',
      expect.objectContaining({ method: 'POST', body: expect.any(String) }),
    );
    const requestInit = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      event: { title: 'Server task' },
      schedule: { mode: 'create', task: { customerId: 7, title: 'Server task' } },
    });
  });

  test('throws for invalid due date', async () => {
    await expect(
      calendarService.addTaskEvent({
        title: 'Invalid',
        dueDate: 'invalid',
      })
    ).rejects.toThrow('Ungültiges Fälligkeitsdatum');
  });

  test('rejects calendar dates that JavaScript would otherwise normalize', async () => {
    await expect(calendarService.addTaskEvent({ title: 'Invalid', dueDate: '2026-02-31' }))
      .rejects.toThrow('Ungültiges Fälligkeitsdatum');
    expect(invoke).not.toHaveBeenCalled();
  });

  test('updates task event with completed color', async () => {
    invoke.mockResolvedValueOnce({ success: true });
    await calendarService.updateTaskEvent(5, {
      title: 'Done task',
      dueDate: '2026-03-13',
      completed: true,
    });

    expect(invoke).toHaveBeenCalledWith(
      IPCChannels.Calendar.UpdateCalendarEvent,
      expect.objectContaining({
        id: 5,
        eventData: expect.objectContaining({
          color_code: TASK_EVENT_COMPLETED_COLOR,
          all_day: true,
        }),
      })
    );
  });

  test('no-op when no fields are provided for update', async () => {
    await calendarService.updateTaskEvent(8, {});
    expect(invoke).not.toHaveBeenCalled();
  });

  test('deletes task event', async () => {
    invoke.mockResolvedValueOnce({ success: true });
    await calendarService.deleteTaskEvent(13);
    expect(invoke).toHaveBeenCalledWith(IPCChannels.Calendar.DeleteCalendarEvent, 13);
  });
});
