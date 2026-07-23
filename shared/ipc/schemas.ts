import { z, ZodTypeAny } from 'zod';
import { AllowedInvokeChannels, DeprecatedInvokeChannels, IPCChannels, InvokeChannel } from './channels';
import { applyEmailIpcSchemas } from './email-schemas';

type SchemaEntry = {
  payload: ZodTypeAny;
  result: ZodTypeAny;
  deprecated?: boolean;
};

const baseSchemaMap = new Map<InvokeChannel, SchemaEntry>();

for (const channel of AllowedInvokeChannels) {
  baseSchemaMap.set(channel as InvokeChannel, {
    payload: z.any(),
    result: z.any(),
    deprecated: (DeprecatedInvokeChannels as readonly string[]).includes(channel),
  });
}

const successResponse = z.object({ success: z.literal(true) }).passthrough();
const failureResponse = z.object({ success: z.literal(false), error: z.string().optional() }).passthrough();
const standardResult = z.union([successResponse, failureResponse]);
const optionalListFilterSchema = z.object({
  completed: z.boolean().optional(),
  priority: z.string().optional(),
  query: z.string().optional(),
  stage: z.string().optional(),
  customerId: z.number().int().positive().optional(),
  customer_id: z.number().int().positive().optional(),
}).passthrough();
const optionalListParamsSchema = z.union([
  z.undefined(),
  z.object({
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
    filter: optionalListFilterSchema.optional(),
  }).passthrough(),
]);
const searchPayloadSchema = z.union([
  z.string(),
  z.object({
    query: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }).passthrough(),
  z.tuple([z.string(), z.number().int().positive().optional()]),
]);

const deployModeSchema = z.union([
  z.literal('standalone'),
  z.literal('server-client'),
  z.literal('server-install'),
]);
const deployServerConfigSchema = z.object({
  baseUrl: z.string().trim().url().refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'server.baseUrl must use http or https'),
  lastLoginUsername: z.string().optional(),
});
const deployServerInstallConfigSchema = z.object({
  composeProjectName: z.string().optional(),
  installDir: z.string().optional(),
});
const deployConfigSchema = z.object({
  version: z.literal(1),
  mode: deployModeSchema,
  selectedAt: z.string(),
  server: deployServerConfigSchema.optional(),
  serverInstall: deployServerInstallConfigSchema.optional(),
});

baseSchemaMap.set(IPCChannels.Setup.GetDeployConfig, {
  payload: z.undefined(),
  result: z.union([
    z.object({ status: z.literal('missing') }),
    z.object({ status: z.literal('invalid'), error: z.string() }),
    z.object({ status: z.literal('ok'), config: deployConfigSchema }),
  ]),
});

baseSchemaMap.set(IPCChannels.Setup.SaveDeployConfig, {
  payload: z.object({
    mode: deployModeSchema,
    server: deployServerConfigSchema.optional(),
    serverInstall: deployServerInstallConfigSchema.optional(),
  }),
  result: z.union([
    z.object({ success: z.literal(true), config: deployConfigSchema }),
    failureResponse,
  ]),
});

baseSchemaMap.set(IPCChannels.Setup.ResetDeployConfig, {
  payload: z.undefined(),
  result: z.union([
    z.object({ success: z.literal(true) }),
    failureResponse,
  ]),
});

// --- Deals ---
const dealProductIdentifier = z.object({
  dealProductId: z.number().int().positive().optional(),
  dealId: z.number().int().positive().optional(),
  productId: z.number().int().positive().optional(),
});

const addDealProductPayload = z.object({
  dealId: z.number().int().positive(),
  productId: z.number().int().positive(),
  quantity: z.number().positive(),
  price: z.number().nonnegative().optional(),
  priceAtTime: z.number().nonnegative().optional(),
});

const removeDealProductPayload = z.object({
  dealProductId: z.number().int().positive().optional(),
  dealId: z.number().int().positive().optional(),
  productId: z.number().int().positive().optional(),
}).refine((data) => !!data.dealProductId || (!!data.dealId && !!data.productId), {
  message: 'dealProductId or (dealId and productId) is required',
});

const updateDealProductPayload = dealProductIdentifier.extend({
  quantity: z.number().positive(),
  price: z.number().nonnegative().optional(),
  priceAtTime: z.number().nonnegative().optional(),
});

// --- Calendar ---
const calendarEventMutationSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  start_date: z.string().min(1).optional(),
  end_date: z.string().min(1).optional(),
  all_day: z.boolean().optional(),
  color_code: z.string().nullable().optional(),
  event_type: z.string().nullable().optional(),
  recurrence_rule: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
  task_id: z.number().int().positive().nullable().optional(),
}).strict();

const calendarEventCreateSchema = calendarEventMutationSchema.extend({
  title: z.string().trim().min(1),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});

const taskRecordSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
  customer_id: z.union([z.number(), z.string()]).nullable().optional(),
  customer_name: z.string().nullable().optional(),
  customer_company: z.string().nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  priority: z.string(),
  completed: z.union([z.boolean(), z.number().int()]),
  snoozed_until: z.string().nullable().optional(),
  assignment_scope: z.enum(['global', 'user', 'group']).optional(),
  assigned_user_id: z.string().nullable().optional(),
  assigned_group_id: z.number().int().positive().nullable().optional(),
  calendar_event_id: z.number().int().positive().nullable().optional(),
}).passthrough();

const calendarEventRecordSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable().optional(),
  start_date: z.string(),
  end_date: z.string(),
  all_day: z.union([z.boolean(), z.number().int()]),
  color_code: z.string().nullable().optional(),
  event_type: z.string().nullable().optional(),
  recurrence_rule: z.union([z.string(), z.record(z.string(), z.unknown())]).nullable().optional(),
  task_id: z.number().int().positive().nullable().optional(),
}).passthrough();

const calendarEntrySuccessSchema = z.object({
  success: z.literal(true),
  id: z.number().int().positive(),
  event: calendarEventRecordSchema,
  task: taskRecordSchema.nullable().optional(),
}).passthrough();

const calendarTaskDueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
});

const taskScheduleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }).strict(),
  z.object({
    mode: z.literal('existing'),
    taskId: z.number().int().positive(),
    dueDate: calendarTaskDueDateSchema.optional(),
    task: z.object({
      priority: z.string().trim().min(1).optional(),
      completed: z.boolean().optional(),
    }).strict().optional(),
  }).strict(),
  z.object({
    mode: z.literal('create'),
    dueDate: calendarTaskDueDateSchema.optional(),
    task: z.object({
      customerId: z.number().int().positive().optional(),
      title: z.string().trim().min(1),
      description: z.string().nullable().optional(),
      priority: z.string().trim().min(1).optional(),
      completed: z.boolean().optional(),
      assignmentScope: z.enum(['global', 'user', 'group']).optional(),
      assignedUserId: z.string().trim().min(1).nullable().optional(),
      assignedGroupId: z.number().int().positive().nullable().optional(),
    }).strict(),
  }).strict(),
]);
baseSchemaMap.set(IPCChannels.Calendar.GetCalendarEvents, {
  payload: z.union([
    z.undefined(),
    z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).passthrough(),
  ]),
  result: z.array(calendarEventRecordSchema),
});

baseSchemaMap.set(IPCChannels.Calendar.AddCalendarEvent, {
  payload: z.union([
    calendarEventCreateSchema,
    z.object({
      event: calendarEventCreateSchema,
      schedule: taskScheduleSchema.optional(),
    }).strict(),
  ]),
  result: z.union([
    calendarEntrySuccessSchema,
    failureResponse,
  ]),
});

baseSchemaMap.set(IPCChannels.Calendar.UpdateCalendarEvent, {
  payload: z.union([
    z.object({
      id: z.number().int().positive(),
      eventData: calendarEventMutationSchema,
    }).strict(),
    z.object({
      id: z.number().int().positive(),
      event: calendarEventMutationSchema,
      schedule: taskScheduleSchema.optional(),
    }).strict(),
  ]),
  result: z.union([calendarEntrySuccessSchema, failureResponse]),
});

baseSchemaMap.set(IPCChannels.Calendar.DeleteCalendarEvent, {
  payload: z.number().int().positive(),
  result: z.union([successResponse, failureResponse]),
});

// --- Deals ---
baseSchemaMap.set(IPCChannels.Deals.AddProduct, {
  payload: addDealProductPayload,
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Deals.RemoveProduct, {
  payload: removeDealProductPayload,
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Deals.UpdateProduct, {
  payload: updateDealProductPayload,
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Deals.UpdateProductQuantityLegacy, {
  payload: updateDealProductPayload,
  result: standardResult,
  deprecated: true,
});

baseSchemaMap.set(IPCChannels.Deals.GetProducts, {
  payload: z.number().int().positive(),
  result: z.array(z.any()),
});

// --- JTL ---
baseSchemaMap.set(IPCChannels.Jtl.GetFirmen, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Jtl.GetWarenlager, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Jtl.GetZahlungsarten, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Jtl.GetVersandarten, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

// --- Products ---
baseSchemaMap.set(IPCChannels.Products.GetAll, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Products.Search, {
  payload: searchPayloadSchema,
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Products.GetById, {
  payload: z.number().int().positive(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Products.Create, {
  payload: z.any(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Products.Update, {
  payload: z.any(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Products.Delete, {
  payload: z.number().int().positive(),
  result: standardResult,
});

// --- MSSQL ---
const mssqlSettingsBase = z.object({
  server: z.string().min(1),
  port: z.union([z.string(), z.number()]).optional(),
  database: z.string().min(1),
  user: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  encrypt: z.boolean().optional(),
  trustServerCertificate: z.boolean().optional(),
  forcePort: z.boolean().optional(),
});

baseSchemaMap.set(IPCChannels.Mssql.SaveSettings, {
  payload: mssqlSettingsBase,
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Mssql.GetSettings, {
  payload: z.undefined(),
  result: z.union([
    z.object({}).passthrough(),
    z.null(),
    failureResponse,
  ]),
});

baseSchemaMap.set(IPCChannels.Mssql.TestConnection, {
  payload: mssqlSettingsBase,
  result: z.union([
    successResponse,
    failureResponse.extend({ errorDetails: z.any().optional() }),
  ]),
});

baseSchemaMap.set(IPCChannels.Mssql.ClearPassword, {
  payload: z.undefined(),
  result: standardResult,
});

// --- Dashboard ---
baseSchemaMap.set(IPCChannels.Dashboard.GetStats, {
  payload: z.undefined(),
  result: z.any(),
});

const dashboardLimitPayload = z.number().int().positive().optional();

baseSchemaMap.set(IPCChannels.Dashboard.GetRecentCustomers, {
  payload: dashboardLimitPayload,
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Dashboard.GetUpcomingTasks, {
  payload: dashboardLimitPayload,
  result: z.array(z.any()),
});

// --- Tasks ---
const taskMutationSchema = z.object({
  customer_id: z.number().int().positive().nullable().optional(),
  customerId: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.string().trim().min(1).optional(),
  completed: z.boolean().optional(),
  assignment_scope: z.enum(['global', 'user', 'group']).optional(),
  assignmentScope: z.enum(['global', 'user', 'group']).optional(),
  assigned_user_id: z.string().trim().min(1).nullable().optional(),
  assignedUserId: z.string().trim().min(1).nullable().optional(),
  assigned_group_id: z.number().int().positive().nullable().optional(),
  assignedGroupId: z.number().int().positive().nullable().optional(),
  snoozed_until: z.string().nullable().optional(),
  snoozedUntil: z.string().nullable().optional(),
  calendar_event_id: z.number().int().positive().nullable().optional(),
}).strict();

baseSchemaMap.set(IPCChannels.Tasks.GetAll, {
  payload: optionalListParamsSchema,
  result: z.array(taskRecordSchema),
});

baseSchemaMap.set(IPCChannels.Tasks.GetById, {
  payload: z.number().int().positive(),
  result: taskRecordSchema.nullable(),
});

baseSchemaMap.set(IPCChannels.Tasks.Create, {
  payload: taskMutationSchema.extend({ title: z.string().trim().min(1) }),
  result: z.union([
    z.object({ success: z.literal(true), id: z.number().int().positive().optional() }).passthrough(),
    failureResponse,
  ]),
});

baseSchemaMap.set(IPCChannels.Tasks.Update, {
  payload: z.object({
    id: z.number().int().positive(),
    taskData: taskMutationSchema,
  }).strict(),
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Tasks.ToggleCompletion, {
  payload: z.object({
    taskId: z.number().int().positive(),
    completed: z.boolean(),
  }).strict(),
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Tasks.Delete, {
  payload: z.number().int().positive(),
  result: standardResult,
});

// --- Custom Fields ---
baseSchemaMap.set(IPCChannels.CustomFields.GetAll, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.CustomFields.GetActive, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.CustomFields.GetById, {
  payload: z.number().int().positive(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.CustomFields.Create, {
  payload: z.any(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.CustomFields.Update, {
  payload: z.any(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.CustomFields.Delete, {
  payload: z.number().int().positive(),
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.CustomFields.GetValuesForCustomer, {
  payload: z.number().int().positive(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.CustomFields.SetValue, {
  payload: z.object({
    fieldId: z.number().int().positive(),
    customerId: z.number().int().positive(),
    value: z.string(),
  }),
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.CustomFields.DeleteValue, {
  payload: z.object({
    fieldId: z.number().int().positive(),
    customerId: z.number().int().positive(),
  }),
  result: standardResult,
});

// --- Remaining DB channels ---
baseSchemaMap.set(IPCChannels.Db.GetCustomers, {
  payload: z.union([
    z.undefined(),
    z.boolean(),
    z.object({
      includeCustomFields: z.boolean().optional(),
      paginated: z.boolean().optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
      query: z.string().optional(),
      status: z.string().nullable().optional(),
      sortBy: z.string().optional(),
      sortDirection: z.union([z.literal('asc'), z.literal('desc')]).optional(),
    }).passthrough(),
  ]),
  result: z.union([
    z.array(z.any()),
    z.object({
      items: z.array(z.any()),
      total: z.number().int().nonnegative(),
    }).passthrough(),
  ]),
});

baseSchemaMap.set(IPCChannels.Db.GetCustomersDropdown, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Db.SearchCustomers, {
  payload: searchPayloadSchema,
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Db.GetCustomer, {
  payload: z.number().int().positive(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Db.CreateCustomer, {
  payload: z.any(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Db.UpdateCustomer, {
  payload: z.any(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Db.DeleteCustomer, {
  payload: z.number().int().positive(),
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Db.GetDealsForCustomer, {
  payload: z.number().int().positive(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Db.GetTasksForCustomer, {
  payload: z.number().int().positive(),
  result: z.array(z.any()),
});

// --- Deals (remaining channels) ---
baseSchemaMap.set(IPCChannels.Deals.GetAll, {
  payload: optionalListParamsSchema,
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Deals.GetById, {
  payload: z.number().int().positive(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Deals.Create, {
  payload: z.any(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Deals.Update, {
  payload: z.any(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Deals.UpdateStage, {
  payload: z.object({
    dealId: z.number().int().positive(),
    stageId: z.number().int().positive().optional(),
    newStage: z.string().min(1).optional(),
    stage: z.string().min(1).optional(),
  }).passthrough().refine((payload) => payload.stageId !== undefined || payload.newStage || payload.stage, {
    message: 'stageId, newStage or stage is required',
  }),
  result: z.any(),
});

// --- JTL (remaining channel) ---
baseSchemaMap.set(IPCChannels.Jtl.CreateOrder, {
  payload: z.any(),
  result: z.any(),
});

// --- Sync ---
baseSchemaMap.set(IPCChannels.Sync.Run, {
  payload: z.undefined(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Sync.GetStatus, {
  payload: z.undefined(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Sync.GetInfo, {
  payload: z.string().min(1),
  result: z.string().nullable(),
});

baseSchemaMap.set(IPCChannels.Sync.SetInfo, {
  payload: z.object({
    key: z.string().min(1),
    value: z.any().optional(),
  }).passthrough(),
  result: z.any(),
});

// --- PGP ---
const pgpMessageAttachmentPayload = z.object({
  filename: z.string().trim().min(1).max(260),
  contentType: z.string().trim().max(200).optional(),
  contentBase64: z.string().trim().min(1).max(70_000_000)
    .refine((value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value), 'contentBase64 must be valid Base64'),
});

const pgpPreparedAttachmentResult = z.object({
  filename: z.string(),
  contentType: z.string().optional(),
  contentBase64: z.string(),
}).passthrough();

const pgpArmoredMessageResult = z.object({
  armored: z.string(),
  attachments: z.array(pgpPreparedAttachmentResult).optional(),
}).passthrough();
const pgpSourceIdPayload = z.object({
  id: z.number().int().optional(),
  sourceId: z.number().int().optional(),
}).passthrough().refine((value) => value.id !== undefined || value.sourceId !== undefined, {
  message: 'id or sourceId is required',
});

baseSchemaMap.set(IPCChannels.Pgp.ListIdentities, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Pgp.GenerateIdentity, {
  payload: z.object({
    userId: z.string().optional(),
    name: z.string().optional(),
    email: z.string().email().optional(),
    passphrase: z.string(),
  }).passthrough(),
  result: z.object({ fingerprint: z.string() }).passthrough(),
});

baseSchemaMap.set(IPCChannels.Pgp.DeleteIdentity, {
  payload: z.union([
    z.number().int(),
    pgpSourceIdPayload,
  ]),
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Pgp.RotateIdentityPassphrase, {
  payload: pgpSourceIdPayload.and(z.object({
    currentPassphrase: z.string(),
    nextPassphrase: z.string(),
  }).passthrough()),
  result: z.record(z.string(), z.unknown()),
});

baseSchemaMap.set(IPCChannels.Pgp.ListPeerKeys, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Pgp.ImportPeerKey, {
  payload: z.object({
    armored: z.string().min(1),
  }).passthrough(),
  result: z.object({ fingerprint: z.string() }).passthrough(),
});

baseSchemaMap.set(IPCChannels.Pgp.DeletePeerKey, {
  payload: z.union([
    z.number().int(),
    pgpSourceIdPayload,
  ]),
  result: standardResult,
});

baseSchemaMap.set(IPCChannels.Pgp.CheckRecipientKeys, {
  payload: z.object({
    emails: z.array(z.string()).max(200),
  }).passthrough(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.Pgp.EncryptMessage, {
  payload: z.object({
    plaintext: z.string(),
    recipientEmails: z.array(z.string()).min(1).max(200),
    attachments: z.array(pgpMessageAttachmentPayload).max(20).optional(),
  }).passthrough(),
  result: pgpArmoredMessageResult,
});

baseSchemaMap.set(IPCChannels.Pgp.SignMessage, {
  payload: z.object({
    plaintext: z.string(),
    passphrase: z.string(),
    attachments: z.array(pgpMessageAttachmentPayload).max(20).optional(),
  }).passthrough(),
  result: pgpArmoredMessageResult,
});

baseSchemaMap.set(IPCChannels.Pgp.DecryptMessage, {
  payload: z.object({
    messageId: z.number().int(),
    passphrase: z.string(),
  }).passthrough(),
  result: z.object({
    text: z.string().optional(),
    status: z.string().optional(),
  }).passthrough(),
});

baseSchemaMap.set(IPCChannels.Pgp.DetectInbound, {
  payload: z.object({
    messageId: z.number().int(),
  }).passthrough(),
  result: z.object({ success: z.boolean() }).passthrough(),
});

baseSchemaMap.set(IPCChannels.Pgp.VerifyMessage, {
  payload: z.object({
    messageId: z.number().int(),
  }).passthrough(),
  result: z.object({
    valid: z.boolean().optional(),
    status: z.string().optional(),
    fingerprint: z.string().optional(),
  }).passthrough(),
});

// --- Window ---
baseSchemaMap.set(IPCChannels.Window.GetState, {
  payload: z.undefined(),
  result: z.object({ isMaximized: z.boolean(), isFullScreen: z.boolean() }),
});

// --- Update ---
baseSchemaMap.set(IPCChannels.Update.CheckForUpdates, {
  payload: z.undefined(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Update.InstallUpdate, {
  payload: z.undefined(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Update.GetStatus, {
  payload: z.undefined(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.Update.OpenExternalUrl, {
  payload: z.object({ url: z.string().min(1) }),
  result: z.object({ success: z.boolean() }),
});

// --- Follow-Up ---
baseSchemaMap.set(IPCChannels.FollowUp.GetItems, {
  payload: z.any(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.FollowUp.GetQueueCounts, {
  payload: z.undefined(),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.FollowUp.SnoozeTask, {
  payload: z.object({
    taskId: z.number().int().positive(),
    snoozedUntil: z.string(),
  }),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.FollowUp.LogActivity, {
  payload: z.object({
    customer_id: z.number().int().positive().optional(),
    deal_id: z.number().int().positive().optional(),
    task_id: z.number().int().positive().optional(),
    activity_type: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  }),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.FollowUp.GetTimeline, {
  payload: z.any(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.FollowUp.GetSavedViews, {
  payload: z.undefined(),
  result: z.array(z.any()),
});

baseSchemaMap.set(IPCChannels.FollowUp.CreateSavedView, {
  payload: z.object({
    name: z.string().min(1),
    filters: z.string(),
  }),
  result: z.any(),
});

baseSchemaMap.set(IPCChannels.FollowUp.DeleteSavedView, {
  payload: z.number().int().positive(),
  result: z.any(),
});

applyEmailIpcSchemas(baseSchemaMap);

export const IpcSchemas: Record<InvokeChannel, SchemaEntry> = Object.fromEntries(
  Array.from(baseSchemaMap.entries())
) as Record<InvokeChannel, SchemaEntry>;

export const getPayloadSchema = (channel: InvokeChannel) => IpcSchemas[channel].payload;
export const getResultSchema = (channel: InvokeChannel) => IpcSchemas[channel].result;
export const isDeprecatedChannel = (channel: InvokeChannel) => Boolean(IpcSchemas[channel].deprecated);
