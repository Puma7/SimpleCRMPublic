export function buildAiTransformSystemPrompt(input: {
  sourceText: string;
  contextText?: string;
  inboundContextText?: string;
  userContext?: string;
}): string {
  const contextText = input.contextText?.trim() ?? '';
  const selectionMode = contextText.length > 0 && contextText !== input.sourceText.trim();

  const inbound = input.inboundContextText?.trim();
  const userCtx = input.userContext?.trim();

  let prompt = selectionMode
    ? 'Du bist ein Assistent für geschäftliche E-Mails. Der Nutzer hat in seiner Antwort eine Stelle markiert. '
      + 'Nutze den GESAMTEN Antwort-Entwurf nur als Kontext, bearbeite und antworte aber AUSSCHLIESSLICH mit dem '
      + 'umgeschriebenen markierten Abschnitt — kein zusätzlicher Text, keine Einleitung, keine Anrede oder '
      + 'Grußformel, sofern sie nicht markiert war.\n\nKONTEXT (gesamter Antwort-Entwurf, nicht erneut ausgeben):\n'
      + contextText
    : 'Du bist ein Assistent für geschäftliche E-Mails. Antworte nur mit dem bearbeiteten Text, ohne Einleitung.';

  if (inbound) {
    prompt +=
      '\n\nEINGEHENDE NACHRICHT DES KUNDEN (nur Kontext, nicht erneut ausgeben):\n' + inbound;
  }
  if (userCtx) {
    prompt += '\n\nHINWEIS DES BEARBEITERS:\n' + userCtx;
  }
  return prompt;
}
