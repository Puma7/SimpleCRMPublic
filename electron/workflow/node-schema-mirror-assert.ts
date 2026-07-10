/**
 * Compile-Time-Wache: `shared/workflow-node-schema.ts` (Renderer-Spiegel) und
 * `packages/core/src/workflow/node-schema.ts` (Kanon) müssen wechselseitig
 * zuweisbar bleiben. Driftet einer der beiden, schlägt `tsc -p
 * tsconfig.electron.json` fehl. (Nur Typen — erzeugt keinen Laufzeit-Code.)
 */

import type {
  WorkflowFieldType as CoreFieldType,
  WorkflowNodeFieldSchema as CoreField,
  WorkflowNodePortSchema as CorePort,
  WorkflowNodeOutputSchema as CoreOutput,
  WorkflowNodeSchemaExtension as CoreExtension,
} from '../../packages/core/src/workflow/node-schema';
import type {
  WorkflowFieldType as SharedFieldType,
  WorkflowNodeFieldSchema as SharedField,
  WorkflowNodePortSchema as SharedPort,
  WorkflowNodeOutputSchema as SharedOutput,
  WorkflowNodeSchemaExtension as SharedExtension,
} from '../../shared/workflow-node-schema';

type MutuallyAssignable<A, B> = A extends B ? (B extends A ? true : never) : never;

// Bei Drift wird der jeweilige Typ zu `never` und die Zuweisung ein Fehler.
const _fieldType: MutuallyAssignable<CoreFieldType, SharedFieldType> = true;
const _field: MutuallyAssignable<CoreField, SharedField> = true;
const _port: MutuallyAssignable<CorePort, SharedPort> = true;
const _output: MutuallyAssignable<CoreOutput, SharedOutput> = true;
const _extension: MutuallyAssignable<CoreExtension, SharedExtension> = true;

export const WORKFLOW_NODE_SCHEMA_MIRROR_OK =
  _fieldType && _field && _port && _output && _extension;
