import { IpcMainInvokeEvent, dialog } from 'electron';
import { IPCChannels } from '../../shared/ipc/channels';
import { registerIpcHandler } from './register';
import { getWorkflowById, createWorkflow, updateWorkflow } from '../email/email-workflow-store';
import { listWorkflowNodeCatalog, ensureBuiltinWorkflowNodes } from '../workflow/registry';
import { testWorkflowOnMessage } from '../workflow/workflow-executor';
import { listRecentWorkflowRuns, listWorkflowRunSteps } from '../workflow/run-steps';
import { WORKFLOW_TEMPLATES } from '../workflow/templates';
import { exportWorkflowBundle, parseWorkflowImport } from '../workflow/export-import';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
  addTextChunk,
  importFileToKnowledgeBase,
} from '../workflow/knowledge-base';
import { listPluginManifests, loadWorkflowPlugins } from '../workflow/plugins';
import { compileGraphToDefinition } from '../email/email-workflow-graph-compile';
import type { WorkflowGraphDocument } from '../../shared/email-workflow-graph';
import { restartEmailWorkflowCrons } from '../email/email-imap-services';
import {
  listWorkflowVersions,
  saveWorkflowVersion,
  getWorkflowVersion,
} from '../workflow/workflow-versions';

type Disposer = () => void;

export function registerWorkflowHandlers(options: {
  logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>;
}): Disposer {
  const { logger } = options;
  const disposers: Disposer[] = [];

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListWorkflowNodeCatalog, async () => {
      ensureBuiltinWorkflowNodes();
      return listWorkflowNodeCatalog();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.TestWorkflowOnMessage,
      async (
        _event: IpcMainInvokeEvent,
        payload: { workflowId: number; messageId: number; dryRun?: boolean },
      ) => testWorkflowOnMessage(payload.workflowId, payload.messageId, payload.dryRun !== false),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListWorkflowRuns,
      async (_event: IpcMainInvokeEvent, workflowId: number) => listRecentWorkflowRuns(workflowId),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListWorkflowRunSteps,
      async (_event: IpcMainInvokeEvent, runId: number) => listWorkflowRunSteps(runId),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListWorkflowTemplates, async () => WORKFLOW_TEMPLATES, {
      logger,
    }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ExportWorkflowBundle,
      async (_event: IpcMainInvokeEvent, workflowId: number) => {
        const row = getWorkflowById(workflowId);
        if (!row) return { success: false as const, error: 'Workflow nicht gefunden' };
        return { success: true as const, bundle: exportWorkflowBundle(row) };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ImportWorkflowBundle,
      async (_event: IpcMainInvokeEvent, payload: { json: string }) => {
        const bundle = parseWorkflowImport(payload.json);
        const w = bundle.workflow;
        const graphStr = w.graph_json ? JSON.stringify(w.graph_json) : null;
        let defJson = w.definition_json;
        if (w.graph_json) {
          defJson = JSON.stringify(compileGraphToDefinition(w.graph_json));
        }
        const id = createWorkflow({
          name: `${w.name} (Import)`,
          trigger: w.trigger,
          priority: w.priority,
          definitionJson: defJson,
          graphJson: graphStr,
          cronExpr: w.cron_expr,
          scheduleAccountId: w.schedule_account_id,
          enabled: w.enabled,
          executionMode: w.execution_mode ?? 'graph',
          engineVersion: w.engine_version ?? 1,
        });
        restartEmailWorkflowCrons(logger);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListKnowledgeBases, async () => listKnowledgeBases(), {
      logger,
    }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.CreateKnowledgeBase,
      async (_event: IpcMainInvokeEvent, payload: { name: string; description?: string }) => {
        const id = createKnowledgeBase(payload.name, payload.description ?? null);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.DeleteKnowledgeBase, async (_event: IpcMainInvokeEvent, id: number) => {
      deleteKnowledgeBase(id);
      return { success: true as const };
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.AddKnowledgeChunk,
      async (
        _event: IpcMainInvokeEvent,
        payload: { knowledgeBaseId: number; title: string; content: string },
      ) => {
        const id = addTextChunk(payload.knowledgeBaseId, payload.title, payload.content);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ImportKnowledgeFile,
      async (_event: IpcMainInvokeEvent, payload: { knowledgeBaseId: number }) => {
        const r = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Text', extensions: ['txt', 'md', 'json'] }],
        });
        if (r.canceled || !r.filePaths[0]) return { success: true as const, id: null };
        const id = importFileToKnowledgeBase(payload.knowledgeBaseId, r.filePaths[0]);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(IPCChannels.Email.ListWorkflowPlugins, async () => {
      loadWorkflowPlugins();
      return listPluginManifests();
    }, { logger }),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.ListWorkflowVersions,
      async (_event: IpcMainInvokeEvent, workflowId: number) => listWorkflowVersions(workflowId),
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.SaveWorkflowVersion,
      async (_event: IpcMainInvokeEvent, payload: { workflowId: number; label?: string }) => {
        const id = saveWorkflowVersion(payload.workflowId, payload.label);
        return { success: true as const, id };
      },
      { logger },
    ),
  );

  disposers.push(
    registerIpcHandler(
      IPCChannels.Email.RestoreWorkflowVersion,
      async (_event: IpcMainInvokeEvent, payload: { versionId: number }) => {
        const v = getWorkflowVersion(payload.versionId);
        if (!v) return { success: false as const, error: 'Version nicht gefunden' };
        const wf = getWorkflowById(v.workflow_id);
        if (!wf) return { success: false as const, error: 'Workflow nicht gefunden' };
        updateWorkflow(v.workflow_id, {
          graphJson: v.graph_json,
          definitionJson: v.definition_json,
        });
        restartEmailWorkflowCrons(logger);
        return { success: true as const, workflowId: v.workflow_id };
      },
      { logger },
    ),
  );

  return () => disposers.forEach((d) => d());
}
