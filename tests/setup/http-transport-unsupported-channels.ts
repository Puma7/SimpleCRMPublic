import { IPCChannels } from '../../shared/ipc/channels';

/**
 * IPC-Kanäle ohne HTTP-Zuordnung im Renderer-Transport (Server-Edition),
 * jeweils mit Grund. Genutzt vom Registry-Vollständigkeitstest und vom
 * Vertragstest gegen die Server-Routen.
 */
export const HTTP_TRANSPORT_UNSUPPORTED_CHANNELS: ReadonlySet<string> = new Set<string>([
  // Native window/update/setup affordances are handled outside server HTTP invoke transport.
  IPCChannels.Window.GetState,
  IPCChannels.Update.CheckForUpdates,
  IPCChannels.Update.InstallUpdate,
  IPCChannels.Update.GetStatus,
  IPCChannels.Update.OpenExternalUrl,
  IPCChannels.Setup.GetDeployConfig,
  IPCChannels.Setup.SaveDeployConfig,
  IPCChannels.Setup.ResetDeployConfig,

  // Server-client auth uses server-auth-client/AuthProvider instead of legacy invoke mapping.
  IPCChannels.Auth.Login,
  IPCChannels.Auth.Logout,
  IPCChannels.Auth.GetSession,
  IPCChannels.Auth.GetSetupState,
  IPCChannels.Auth.GetOneTimeSetupPassword,
  IPCChannels.Auth.SetInitialPassword,

  // Local automation listener settings remain standalone/Electron-only.
  IPCChannels.Automation.SetSettings,

  // Mail backup, file-picker, attachment save/open dialogs remain local desktop actions.
  IPCChannels.Email.ExportLocalMailBackup,
  IPCChannels.Email.VerifyLocalMailBackup,
  IPCChannels.Email.PickLocalMailBackupZip,
  IPCChannels.Email.PreviewRestoreLocalMailBackup,
  IPCChannels.Email.RestoreLocalMailBackup,
  IPCChannels.Email.PickComposeAttachments,
  IPCChannels.Email.RegisterDroppedComposeAttachments,
  IPCChannels.Email.OpenAttachmentPath,
  IPCChannels.Email.SaveAttachmentToDisk,

  // Desktop-only trust action for peer keys; the server has PATCH /pgp/peer-keys/:id but no UI mapping yet.
  IPCChannels.Pgp.SetPeerKeyTrust,

  // Native workflow/knowledge file-dialog variants remain local; browser mode uses upload/download helpers.
  IPCChannels.Email.ExportWorkflowBundleToFile,
  IPCChannels.Email.ImportWorkflowBundleFromFile,
  IPCChannels.Email.ExportKnowledgeBaseDocument,
  IPCChannels.Email.ImportKnowledgeFile,
]);
