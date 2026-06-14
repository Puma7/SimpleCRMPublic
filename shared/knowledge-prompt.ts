/** Format knowledge chunks as context block for LLM prompts. */
export function formatKnowledgeChunksForPrompt(
  chunks: readonly { title?: string | null; content: string }[],
): string {
  if (chunks.length === 0) return '';
  const blocks = chunks.map((chunk) => {
    const title = chunk.title?.trim();
    const body = chunk.content.trim();
    return title ? `### ${title}\n${body}` : body;
  });
  return `\n\n---\nRelevante Wissensbasis:\n\n${blocks.join('\n\n')}\n---\n`;
}
