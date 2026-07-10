import { listAiPrompts, type AiPromptRow } from '../../email/email-crm-store';
import { resolvePromptProfileId } from '../../email/email-ai-profiles';
import { runChatCompletion } from '../../email/email-openai';
import type { AccountOverrideScope } from '../../../shared/mail-account-overrides';

function profileIdFromConfig(config: Record<string, unknown>): number | null {
  const v = config.profileId;
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Workflow-Knoten: explizites Profil im Knoten, sonst Prompt-Zuweisung, sonst Standard. */
function effectiveProfileId(
  prompt: Pick<AiPromptRow, 'profile_id'>,
  config: Record<string, unknown>,
): number | null {
  const fromConfig = profileIdFromConfig(config);
  if (fromConfig != null) return fromConfig;
  return resolvePromptProfileId(prompt);
}

/** Match UI default: first library prompt when promptId is missing or 0. */
function resolvePromptForConfig(
  config: Record<string, unknown>,
  scope?: AccountOverrideScope,
): AiPromptRow | undefined {
  const prompts = listAiPrompts(scope);
  const id = Number(config.promptId ?? 0);
  if (id > 0) {
    const found = prompts.find((x) => x.id === id);
    if (found) return found;
  }
  return prompts[0];
}

import {
  addMessageTag,
  createComposeDraft,
  getEmailMessageById,
  setOutboundHold,
} from '../../email/email-store';
import { parseOutboundReviewResponse } from '../../email/email-outbound-review-parse';
// createComposeDraft used by ai.agent
import { buildMetadataContextFromMessage, interpolateTemplate } from '../context';
import { formatMetadataForSpamPrompt, parseSpamScore } from '../ai-score';
import {
  classificationPrompt,
  parseCannedPickNumber,
  parseClassificationOutput,
} from '../ai-classification-parse';
import { searchKnowledgeChunks, searchKnowledgeForWorkflow } from '../knowledge-base';
import type { NodeExecuteResult, RegisteredWorkflowNode, WorkflowContext } from '../types';

type Reg = (def: RegisteredWorkflowNode) => void;

function accountScopeFromContext(ctx: WorkflowContext): AccountOverrideScope {
  return ctx.message?.account_id ?? ctx.outbound?.accountId ?? null;
}

export function registerAiNodes(register: Reg): void {
  register({
    type: 'ai.review',
    label: 'KI-Prüfung',
    category: 'ai',
    canvasType: 'action',
    defaultConfig: { promptId: 0, blockKeyword: 'BLOCK' },
    execute: async (ctx, config) => {
      if (ctx.dryRun && !ctx.previewOutbound) {
        return { status: 'ok', message: 'dry-run ai review skipped' };
      }
      const p = resolvePromptForConfig(config, accountScopeFromContext(ctx));
      if (!p) return { status: 'error', message: 'Prompt nicht gefunden' };
      const user = interpolateTemplate(p.user_template.replace(/\{\{text\}\}/g, ctx.strings.combined_text), ctx);
      const blockKw = String(config.blockKeyword ?? 'BLOCK').trim() || 'BLOCK';
      try {
        const out = await runChatCompletion(
          'Antworte nur mit OK oder BLOCK. BLOCK wenn der Inhalt laut Prüfauftrag problematisch ist.',
          user,
          effectiveProfileId(p, config),
        );
        ctx.ai.lastResponse = out;
        const blocked = out.toUpperCase().includes(blockKw.toUpperCase());
        if (blocked && ctx.direction === 'outbound') {
          const id = ctx.messageId ?? ctx.outbound?.messageId;
          const parsed = parseOutboundReviewResponse(out);
          const reason = parsed.reason || 'KI-Prüfung: Versand blockiert';
          if (!ctx.dryRun && id != null) setOutboundHold(id, true, reason);
          return { status: 'ok', blocked: true, blockReason: reason };
        }
        if (blocked && ctx.messageId != null && !ctx.dryRun) addMessageTag(ctx.messageId, 'ki-review-block');
        return { status: 'ok' };
      } catch (e) {
        if (ctx.direction === 'outbound') {
          const id = ctx.messageId ?? ctx.outbound?.messageId;
          if (!ctx.dryRun && id != null) setOutboundHold(id, true, 'KI-Fehler');
          return { status: 'error', blocked: true, blockReason: 'KI-Fehler' };
        }
        if (ctx.direction === 'inbound' && ctx.messageId != null) {
          if (!ctx.dryRun) addMessageTag(ctx.messageId, 'ki-review-block');
          return {
            status: 'error',
            blocked: true,
            blockReason: 'KI-Fehler',
            message: e instanceof Error ? e.message : String(e),
          };
        }
        return { status: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  register({
    type: 'ai.outbound_review',
    label: 'KI-Ausgangsprüfung',
    category: 'ai',
    canvasType: 'registry',
    description:
      'Prüft ausgehende E-Mails (Ton, Rechtschreibung, Anhang, Betrugs-Antworten) vor dem Versand.',
    defaultConfig: { promptId: 0, checkReplyContext: true },
    execute: async (ctx, config) => {
      if (ctx.dryRun && !ctx.previewOutbound) {
        return { status: 'ok', message: 'dry-run outbound review skipped' };
      }
      if (ctx.direction !== 'outbound') {
        return { status: 'skipped', message: 'Nur für ausgehende E-Mails' };
      }
      const id = ctx.messageId ?? ctx.outbound?.messageId;
      if (id == null) return { status: 'error', message: 'Kein Entwurf' };

      const promptId = Number(config.promptId ?? 0);
      const prompts = listAiPrompts(accountScopeFromContext(ctx));
      const custom = promptId > 0 ? prompts.find((x) => x.id === promptId) : undefined;

      let parentBlock = '';
      if (config.checkReplyContext !== false && ctx.outbound?.inReplyToMessageId) {
        const parent = getEmailMessageById(ctx.outbound.inReplyToMessageId);
        if (parent) {
          let fromAddr = '';
          try {
            if (parent.from_json) {
              const parsed = JSON.parse(parent.from_json) as { value?: { address?: string }[] };
              fromAddr =
                parsed?.value?.map((v) => v.address ?? '').filter(Boolean).join(', ') ?? '';
            }
          } catch {
            fromAddr = '';
          }
          parentBlock = [
            '--- Ursprüngliche Nachricht (Antwort-Kontext) ---',
            `Von: ${fromAddr}`,
            `Betreff: ${parent.subject ?? ''}`,
            `Textauszug: ${(parent.body_text ?? parent.snippet ?? '').slice(0, 4000)}`,
            `Spam markiert: ${parent.is_spam ? 'ja' : 'nein'}`,
          ].join('\n');
        }
      }

      const attCount = ctx.outbound?.attachmentCount ?? 0;
      const userParts = [
        custom
          ? interpolateTemplate(
              custom.user_template.replace(/\{\{text\}\}/g, ctx.strings.combined_text),
              ctx,
            )
          : [
              'Prüfe die folgende ausgehende E-Mail vor dem Versand an Kunden.',
              '',
              'Kriterien: professioneller Ton, korrekte Anrede/Namen, Rechtschreibung, vollständige Inhalte,',
              'fehlende Anhänge wenn im Text versprochen, keine Antwort auf Phishing/Betrug (Bank, Login, Dringlichkeit).',
              '',
              `Anzahl Anhänge beim Versand: ${attCount}`,
              '',
              'Ausgehende E-Mail:',
              ctx.strings.combined_text,
              parentBlock,
            ].join('\n'),
      ];

      const system = [
        'Du bist Qualitätsprüfer für ausgehende Kunden-E-Mails.',
        'Antworte NUR in diesem Format:',
        'STATUS: OK',
        'oder',
        'STATUS: BLOCK',
        'REASON: Kurze deutsche Begründung für den Nutzer',
        'CODE: optionaler_code (z.B. MISSING_ATTACHMENT, PHISHING_REPLY, TONE, SPELLING, WRONG_NAME)',
      ].join('\n');

      try {
        const out = await runChatCompletion(
          system,
          userParts.join('\n'),
          custom ? effectiveProfileId(custom, config) : profileIdFromConfig(config),
        );
        ctx.ai.lastResponse = out;
        const parsed = parseOutboundReviewResponse(out);
        if (!parsed.ok) {
          const reason = parsed.reason || 'Ausgehende KI-Prüfung fehlgeschlagen';
          if (!ctx.dryRun) setOutboundHold(id, true, reason);
          return { status: 'ok', blocked: true, blockReason: reason };
        }
        return { status: 'ok' };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!ctx.dryRun) setOutboundHold(id, true, `KI-Fehler: ${msg}`);
        return { status: 'error', blocked: true, blockReason: `KI-Fehler: ${msg}` };
      }
    },
  });

  register({
    type: 'ai.transform_text',
    label: 'KI-Text transformieren',
    category: 'ai',
    canvasType: 'registry',
    defaultConfig: { promptId: 0, targetVariable: 'ai.text' },
    execute: async (ctx, config) => {
      const p = resolvePromptForConfig(config, accountScopeFromContext(ctx));
      if (!p) return { status: 'error', message: 'Prompt nicht gefunden' };
      const user = interpolateTemplate(p.user_template, ctx);
      if (ctx.dryRun) return { status: 'ok' };
      const out = await runChatCompletion(
        'Du bist ein Assistent für geschäftliche E-Mails. Antworte nur mit dem bearbeiteten Text.',
        user,
        effectiveProfileId(p, config),
      );
      ctx.ai.lastResponse = out;
      const key = String(config.targetVariable ?? 'ai.text');
      return { status: 'ok', variables: { [key]: out } };
    },
  });

  register({
    type: 'ai.spam_score',
    label: 'KI-Spam-Wahrscheinlichkeit',
    category: 'ai',
    canvasType: 'registry',
    description:
      'Bewertet Spam 1–100 (nur Metadaten, kein E-Mail-Volltext). Antwort der KI muss eine Zahl sein.',
    defaultConfig: {
      contextMode: 'metadata',
    },
    execute: async (ctx, config) => {
      if (!ctx.message) return { status: 'skipped', message: 'Keine Nachricht' };
      const mode = String(config.contextMode ?? 'metadata');
      const strings =
        mode === 'full'
          ? ctx.strings
          : buildMetadataContextFromMessage(ctx.message);
      const user = formatMetadataForSpamPrompt({
        subject: strings.subject,
        snippet: strings.snippet,
        from_address: strings.from_address,
        to_address: strings.to_address,
        cc_address: strings.cc_address,
        has_attachments: strings.has_attachments,
        attachment_names: strings.attachment_names,
        attachment_types: strings.attachment_types,
      });
      // Bewusst EIGENE Interpolation mit dem ggf. metadaten-reduzierten
      // Kontext: der zentrale Pre-Pass würde {{body_text}} auch im
      // "Nur Kopfdaten"-Modus füllen (Datenschutz). Schema-Flag daher aus.
      const custom = String(config.customPrompt ?? '').trim();
      const prompt = custom
        ? interpolateTemplate(custom, { ...ctx, strings })
        : user;
      if (ctx.dryRun) {
        return {
          status: 'ok',
          message: 'dry-run spam_score',
          variables: { 'ai.spam_score': 1, 'ai.spam_context': mode },
        };
      }
      try {
        const out = await runChatCompletion(
          'Du bewertest ob eine E-Mail Spam oder unerwünscht ist. Antworte NUR mit einer ganzen Zahl von 1 bis 100. 1 = sicher kein Spam, 100 = sehr wahrscheinlich Spam. Kein anderer Text, keine Erklärung.',
          prompt,
          profileIdFromConfig(config),
        );
        ctx.ai.lastResponse = out;
        const score = parseSpamScore(out);
        return {
          status: 'ok',
          variables: {
            'ai.spam_score': score,
            'ai.spam_context': mode,
          },
        };
      } catch (e) {
        return { status: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  register({
    type: 'ai.classify',
    label: 'KI-Klassifizierung',
    category: 'ai',
    canvasType: 'registry',
    defaultConfig: { labels: 'Rechnung,Support,Spam', contextMode: 'metadata' },
    execute: async (ctx, config) => {
      const labels = String(config.labels ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (labels.length === 0) return { status: 'skipped' };
      const mode = String(config.contextMode ?? 'metadata');
      const text =
        mode === 'full' || !ctx.message
          ? ctx.strings.combined_text
          : buildMetadataContextFromMessage(ctx.message).combined_text;
      const prompt = classificationPrompt(labels, text);
      if (ctx.dryRun) {
        return {
          status: 'ok',
          variables: { 'ai.class': labels[0] ?? '', 'ai.class_confidence': 85 },
        };
      }
      const out = await runChatCompletion(
        'Du bist ein E-Mail-Klassifizierer.',
        prompt,
        profileIdFromConfig(config),
      );
      ctx.ai.lastResponse = out;
      const parsed = parseClassificationOutput(out);
      const label = parsed.label;
      const confidence = parsed.confidence ?? 0;
      if (ctx.messageId != null && label) addMessageTag(ctx.messageId, `ki:${label}`);
      return {
        status: 'ok',
        variables: { 'ai.class': label, 'ai.class_confidence': confidence },
      };
    },
  });

  register({
    type: 'ai.agent',
    label: 'KI-Agent',
    category: 'ai',
    canvasType: 'registry',
    defaultConfig: {
      systemPrompt: 'Du bist ein CRM-Assistent. Nutze die Wissensbasis. Antworte kurz.',
      knowledgeBaseId: null,
      profileId: null,
      createDraft: true,
    },
    execute: async (ctx, config) => {
      const system = String(config.systemPrompt ?? '');
      const kbId = config.knowledgeBaseId != null ? Number(config.knowledgeBaseId) : null;
      const accountId = ctx.message?.account_id ?? ctx.outbound?.accountId ?? null;
      const chunks =
        kbId != null && kbId > 0
          ? await searchKnowledgeChunks(kbId, ctx.strings.combined_text, 5)
          : await searchKnowledgeForWorkflow(accountId, ctx.direction, ctx.strings.combined_text, 5);
      const kbText = chunks.map((c) => c.content).join('\n---\n');
      const user = [
        'Nachricht:',
        ctx.strings.combined_text,
        kbText ? `\nWissensbasis:\n${kbText}` : '',
      ].join('\n');
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run agent' };
      const out = await runChatCompletion(system, user, profileIdFromConfig(config));
      ctx.ai.lastResponse = out;
      const variables: Record<string, string | number | boolean | null> = {
        'ai.agent.response': out,
        'ai.agent.source_count': chunks.length,
        'ai.agent.sources': chunks
          .map((c) => (c.title ? `${c.title}` : `Chunk #${c.id}`))
          .join(', '),
      };
      if (config.createDraft !== false && ctx.message) {
        const id = createComposeDraft({
          accountId: ctx.message.account_id,
          subject: ctx.message.subject?.startsWith('Re:') ? ctx.message.subject : `Re: ${ctx.message.subject ?? ''}`,
          bodyText: out,
        });
        variables['draft.id'] = id;
      }
      return { status: 'ok', variables };
    },
  });

  register({
    type: 'ai.reply_suggestion',
    label: 'Antwortvorschlag erzeugen',
    category: 'ai',
    canvasType: 'registry',
    description:
      'Erzeugt einen KI-Antwortvorschlag für die aktuelle Nachricht. Unabhängig von den globalen Einstellungen unter KI → Antwortvorschläge (z. B. nach Kategorie-Sortierung im Workflow).',
    defaultConfig: { promptId: 0, skipIfReady: true },
    execute: async (ctx, config): Promise<NodeExecuteResult> => {
      if (ctx.direction !== 'inbound') {
        return { status: 'skipped', message: 'Nur für eingehende Nachrichten' };
      }
      const messageId = ctx.messageId;
      if (messageId == null) return { status: 'error', message: 'Keine Nachricht' };

      const row = ctx.message ?? getEmailMessageById(messageId);
      if (!row) return { status: 'error', message: 'Nachricht nicht gefunden' };

      const { canSuggestReplyForMessage, getReplySuggestion, generateAndStoreReplySuggestion } =
        await import('../../email/email-reply-ai');

      if (!canSuggestReplyForMessage(row)) {
        return { status: 'skipped', message: 'Für diese Nachricht nicht anwendbar' };
      }

      const skipIfReady = config.skipIfReady !== false;
      if (skipIfReady) {
        const current = getReplySuggestion(messageId);
        if (current.status === 'ready' && current.text?.trim()) {
          const variables: Record<string, string | number | boolean | null> = {
            'reply_suggestion.status': 'ready',
            'reply_suggestion.text': current.text,
          };
          return {
            status: 'ok',
            message: 'Vorschlag bereits vorhanden',
            variables,
          };
        }
      }

      if (ctx.dryRun) {
        const variables: Record<string, string | number | boolean | null> = {
          'reply_suggestion.status': 'ready',
          'reply_suggestion.text': '(Dry-Run)',
        };
        return {
          status: 'ok',
          message: 'dry-run reply_suggestion',
          variables,
        };
      }

      const promptId = Number(config.promptId ?? 0);
      const result = await generateAndStoreReplySuggestion(messageId, {
        promptId: promptId > 0 ? promptId : undefined,
        customerId: row.customer_id ?? undefined,
      });

      if (result.success) {
        const variables: Record<string, string | number | boolean | null> = {
          'reply_suggestion.status': 'ready',
          'reply_suggestion.text': result.text,
        };
        return { status: 'ok', variables };
      }
      const variables: Record<string, string | number | boolean | null> = {
        'reply_suggestion.status': 'failed',
        'reply_suggestion.error': result.error,
      };
      return {
        status: 'error',
        message: result.error,
        variables,
      };
    },
  });

  register({
    type: 'ai.agent_tool',
    label: 'KI-Agent-Tool',
    category: 'ai',
    canvasType: 'registry',
    defaultConfig: { tool: 'search_knowledge', knowledgeBaseId: null },
    execute: async (ctx, config) => {
      const tool = String(config.tool ?? 'echo');
      if (tool === 'search_knowledge') {
        const kbId = config.knowledgeBaseId != null ? Number(config.knowledgeBaseId) : null;
        if (!kbId) return { status: 'skipped', message: 'Keine Wissensbasis' };
        const chunks = await searchKnowledgeChunks(kbId, ctx.strings.combined_text, 3);
        const text = chunks.map((c) => c.content).join('\n---\n');
        return { status: 'ok', variables: { 'tool.result': text.slice(0, 4000) } };
      }
      if (tool === 'get_canned') {
        const { listCannedResponses } = await import('../../email/email-crm-store');
        const list = listCannedResponses(accountScopeFromContext(ctx)).slice(0, 5);
        return {
          status: 'ok',
          variables: { 'tool.result': list.map((c) => c.title).join(', ') },
        };
      }
      return {
        status: 'ok',
        variables: { 'tool.result': ctx.strings.combined_text.slice(0, 500) },
      };
    },
  });

  register({
    type: 'ai.pick_canned',
    label: 'KI: Textbaustein wählen',
    category: 'ai',
    canvasType: 'registry',
    description: 'Die KI wählt den passenden Textbaustein, füllt Platzhalter und legt einen Entwurf an.',
    defaultConfig: { createDraft: true },
    execute: async (ctx, config) => {
      const { listCannedResponses } = await import('../../email/email-crm-store');
      const canned = listCannedResponses(accountScopeFromContext(ctx));
      if (canned.length === 0) {
        return { status: 'error', message: 'Keine Textbausteine vorhanden' };
      }

      const createDraft = config.createDraft !== false;
      if (ctx.dryRun) {
        const variables: Record<string, string | number | boolean | null> = {
          'ai.canned.pick': 1,
          'ai.canned.status': 'ready',
        };
        if (createDraft) variables['draft.id'] = 0;
        return { status: 'ok', message: 'dry-run pick_canned', variables };
      }

      const list = canned.map((row, index) => `${index + 1}. ${row.title}`).join('\n');
      const out = await runChatCompletion(
        'Du wählst den am besten passenden Textbaustein für die Kundenmail. Antworte nur mit der Nummer des Bausteins, oder 0 wenn keiner passt.',
        `Textbausteine:\n${list}\n\nKundenmail:\n${ctx.strings.combined_text ?? ''}`,
        profileIdFromConfig(config),
      );
      ctx.ai.lastResponse = out;
      const pick = parseCannedPickNumber(out, canned.length);
      const variables: Record<string, string | number | boolean | null> = {
        'ai.canned.pick': pick,
        'ai.canned.status': 'ready',
      };

      if (pick > 0) {
        const chosen = canned[pick - 1]!;
        variables['ai.canned.id'] = chosen.id;
        variables['ai.canned.title'] = chosen.title;
        const draftBody = interpolateTemplate(chosen.body, ctx);
        variables['ai.canned.text'] = draftBody.slice(0, 8000);

        if (createDraft && ctx.message) {
          const { recipientJsonFromField } = await import('../../../shared/email-recipient-parse');
          const { updateComposeDraft } = await import('../../email/email-store');
          const replyTo = ctx.strings.from_address?.split(',')[0]?.trim() ?? '';
          const subjectRaw = ctx.message.subject?.trim() ?? '';
          const reSubject = !subjectRaw
            ? 'Re:'
            : /^re:/i.test(subjectRaw)
              ? subjectRaw
              : `Re: ${subjectRaw}`;
          const id = createComposeDraft({
            accountId: ctx.message.account_id,
            subject: reSubject,
            bodyText: draftBody,
            toJson: replyTo ? recipientJsonFromField(replyTo) : null,
          });
          if (ctx.messageId != null) {
            updateComposeDraft(id, { replyParentMessageId: ctx.messageId });
          }
          variables['draft.id'] = id;
        }
      } else if (createDraft) {
        variables['ai.canned.no_match'] = true;
      }

      return { status: 'ok', variables };
    },
  });
}
