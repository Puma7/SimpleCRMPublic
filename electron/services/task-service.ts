import {
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  updateTaskCompletion,
  deleteTask,
} from '../sqlite-service';

export const TaskService = {
  list(opts: {
    limit?: number;
    offset?: number;
    completed?: boolean;
    query?: string;
  } = {}) {
    const filter: Record<string, unknown> = {};
    if (opts.completed !== undefined) filter.completed = opts.completed;
    if (opts.query?.trim()) filter.query = opts.query.trim();
    return getAllTasks(opts.limit, opts.offset, Object.keys(filter).length ? filter : undefined);
  },

  getById(id: number) {
    return getTaskById(id);
  },

  create(data: Record<string, unknown>) {
    if (!data.title || typeof data.title !== 'string' || !data.title.trim()) {
      return { success: false as const, error: 'title ist erforderlich' };
    }
    return createTask(data);
  },

  update(id: number, data: Record<string, unknown>) {
    return updateTask(id, data);
  },

  toggleCompletion(id: number, completed: boolean) {
    return updateTaskCompletion(id, completed);
  },

  delete(id: number) {
    return deleteTask(id);
  },
};
