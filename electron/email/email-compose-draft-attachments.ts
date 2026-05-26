import fs from 'fs';
import {
  draftAttachmentPathsToJson as draftPathsToJson,
  parseDraftAttachmentPathsJson as parseDraftPaths,
} from '../../shared/compose-draft-attachments';

export { draftAttachmentPathsToJson, parseDraftAttachmentPathsJson } from '../../shared/compose-draft-attachments';

/** Like {@link parseDraftAttachmentPathsJson} but drops paths that no longer exist on disk. */
export function filterExistingDraftAttachmentPaths(json: string | null | undefined): string[] {
  return parseDraftPaths(json).filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

export function draftAttachmentPathsToJsonStored(paths: string[]): string | null {
  return draftPathsToJson(paths);
}
