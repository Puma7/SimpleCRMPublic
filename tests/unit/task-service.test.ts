import { IPCChannels } from '@shared/ipc/channels';
import { taskService } from '@/services/data/taskService';

describe('taskService', () => {
  const invoke = jest.fn();

  beforeEach(() => {
    invoke.mockReset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });
  });

  test('maps all tasks and boolean fields correctly', async () => {
    invoke.mockResolvedValueOnce([
      { id: 1, title: 'A', completed: 1, calendar_event_id: '10' },
      { id: 2, title: 'B', completed: 0, calendar_event_id: null },
    ]);

    const tasks = await taskService.getAllTasks();
    expect(tasks[0].completed).toBe(true);
    expect(tasks[0].calendar_event_id).toBe(10);
    expect(tasks[1].completed).toBe(false);
    expect(tasks[1].calendar_event_id).toBeNull();
  });

  test('updates a task through one backend command', async () => {
    invoke.mockResolvedValueOnce({ success: true });

    const result = await taskService.updateTask(9, { title: 'Updated title' });
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenNthCalledWith(1, IPCChannels.Tasks.Update, {
      id: 9,
      taskData: { title: 'Updated title' },
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('deletes a task through one backend command', async () => {
    invoke.mockResolvedValueOnce({ success: true });

    const result = await taskService.deleteTask(3);
    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(IPCChannels.Tasks.Delete, 3);
  });
});
