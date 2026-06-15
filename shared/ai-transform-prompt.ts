export function buildAiTransformSystemPrompt(input: {
  sourceText: string;
  contextText?: string;
  inboundContextText?: string;
  userContext?: string;
  /** Generate new text to insert — do not rewrite or repeat the existing draft. */
  insertMode?: boolean;
}): string {
  const contextText = input.contextText?.trim() ?? '';
  const selectionMode = !input.insertMode
    && contextText.length > 0
    && contextText !== input.sourceText.trim();

  const inbound = input.inboundContextText?.trim();
  const userCtx = input.userContext?.trim();

  let prompt = selectionMode
    ? 'Du bist ein Assistent für geschäftliche E-Mails. Der Nutzer hat in seiner Antwort eine Stelle markiert. '
      + 'Nutze den GESAMTEN Antwort-Entwurf nur als Kontext, bearbeite und antworte aber AUSSCHLIESSLICH mit dem '
      + 'umgeschriebenen markierten Abschnitt — kein zusätzlicher Text, keine Einleitung, keine Anrede oder '
      + 'Grußformel, sofern sie nicht markiert war.\n\nKONTEXT (gesamter Antwort-Entwurf, nicht erneut ausgeben):\n'
      + contextText
    : input.insertMode
      ? 'Du bist ein Assistent für geschäftliche E-Mails. Der Nutzer möchte NEUEN Text in seine Antwort EINFÜGEN '
        + '(nicht den bestehenden ersetzen). Antworte NUR mit dem neuen Textabschnitt — ohne Einleitung, ohne '
        + 'Wiederholung des bestehenden Entwurfs, ohne Anrede oder Signatur (die sind bereits vorhanden).\n\n'
        + (contextText
          ? 'BESTEHENDER ANTWORT-ENTWURF (nur Kontext, nicht erneut ausgeben):\n' + contextText
          : '')
      : 'Du bist ein Assistent für geschäftliche E-Mails. Antworte nur mit dem bearbeiteten Text, ohne Einleitung.';

  if (inbound) {
    prompt +=
      '\n\nEINGEHENDE NACHRICHT DES KUNDEN (nur Kontext, nicht erneut ausgeben):\n' + inbound;
  }
  if (userCtx) {
    prompt += '\n\n<bearbeiter_hinweis>\n' + userCtx + '\n</bearbeiter_hinweis>';
  }
  return prompt;
}
