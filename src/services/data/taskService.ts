import { Task } from './types';
import { IPCChannels } from '@shared/ipc/channels';
import { invokeRenderer } from '@/services/transport';

interface FilterOptions {
  completed?: boolean;
  priority?: string;
  query?: string;
}

const normalizeTask = (task: Task): Task => ({
  ...task,
  completed: Boolean(task.completed),
  calendar_event_id: task.calendar_event_id === null || task.calendar_event_id === undefined
    ? null
    : Number(task.calendar_event_id),
});

/**
 * Task Service - Handles communication with the SQLite database through Electron IPC
 */
export const taskService = {
  /**
   * Fetch all tasks with optional pagination and filtering
   */
  async getAllTasks(
    limit: number = 100,
    offset: number = 0,
    filter: FilterOptions = {}
  ): Promise<Task[]> {
    try {
      const tasks = await invokeRenderer(
        IPCChannels.Tasks.GetAll,
        { limit, offset, filter }
      ) as Task[];
      return tasks.map(normalizeTask);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      return [];
    }
  },

  /**
   * Get a single task by ID
   */
  async getTaskById(taskId: number | string): Promise<Task | null> {
    try {
      const task = await invokeRenderer(
        IPCChannels.Tasks.GetById,
        Number(taskId)
      ) as Task | null;
      if (!task) return null;

      return normalizeTask(task);
    } catch (error) {
      console.error(`Failed to fetch task with ID ${taskId}:`, error);
      return null;
    }
  },

  /**
   * Create a new task
   */
  async createTask(taskData: Omit<Task, 'id'>): Promise<{ success: boolean; id?: number; error?: string }> {
    try {
      return await invokeRenderer(
        IPCChannels.Tasks.Create,
        taskData
      ) as { success: boolean; id?: number; error?: string };
    } catch (error) {
      console.error('Failed to create task:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },

  /**
   * Update an existing task
   */
  async updateTask(
    taskId: number | string,
    taskData: Partial<Omit<Task, 'id'>>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      return await invokeRenderer(
        IPCChannels.Tasks.Update,
        {
          id: Number(taskId),
          taskData
        }
      ) as { success: boolean; error?: string };
    } catch (error) {
      console.error(`Failed to update task ${taskId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },

  /**
   * Toggle a task's completion status
   */
  async toggleTaskCompletion(
    taskId: number | string,
    completed: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      return await invokeRenderer(
        IPCChannels.Tasks.ToggleCompletion,
        {
          taskId: Number(taskId),
          completed
        }
      ) as { success: boolean; error?: string };
    } catch (error) {
      console.error(`Failed to toggle completion for task ${taskId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },

  /**
   * Delete a task
   */
  async deleteTask(taskId: number | string): Promise<{ success: boolean; error?: string }> {
    try {
      return await invokeRenderer(
        IPCChannels.Tasks.Delete,
        Number(taskId)
      ) as { success: boolean; error?: string };
    } catch (error) {
      console.error(`Failed to delete task ${taskId}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  },

  /**
   * Get tasks for a specific customer
   */
  async getTasksForCustomer(customerId: number | string): Promise<Task[]> {
    try {
      const tasks = await invokeRenderer(
        IPCChannels.Db.GetTasksForCustomer,
        Number(customerId)
      ) as Task[];
      return tasks.map(normalizeTask);
    } catch (error) {
      console.error(`Failed to fetch tasks for customer ${customerId}:`, error);
      return [];
    }
  }
}; 
