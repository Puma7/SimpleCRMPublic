export type DraftAttachmentEntry = {
  path: string;
  filename?: string;
};

export function parseDraftAttachmentPathsJson(json: string | null | undefined): string[] {
  if (!json?.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const paths: string[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim()) {
        paths.push(item.trim());
        continue;
      }
      if (item && typeof item === 'object' && 'path' in item) {
        const p = String((item as DraftAttachmentEntry).path ?? '').trim();
        if (p) paths.push(p);
      }
    }
    return paths;
  } catch {
    return [];
  }
}

export function draftAttachmentPathsToJson(paths: string[]): string | null {
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) return null;
  const entries: DraftAttachmentEntry[] = unique.map((p) => ({
    path: p,
    filename: p.split(/[/\\]/).pop() ?? p,
  }));
  return JSON.stringify(entries);
}
