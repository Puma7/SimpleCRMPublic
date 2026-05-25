import { listAiPrompts } from '../../email/email-crm-store';
import { runChatCompletion } from '../../email/email-openai';
import { addMessageTag, createComposeDraft, setOutboundHold } from '../../email/email-store';
// createComposeDraft used by ai.agent
import { buildMetadataContextFromMessage, interpolateTemplate } from '../context';
import { formatMetadataForSpamPrompt, parseSpamScore } from '../ai-score';
import { searchKnowledgeChunks } from '../knowledge-base';
import type { RegisteredWorkflowNode, WorkflowContext } from '../types';

type Reg = (def: RegisteredWorkflowNode) => void;

export function registerAiNodes(register: Reg): void {
  register({
    type: 'ai.review',
    label: 'KI-Prüfung',
    category: 'ai',
    canvasType: 'action',
    defaultConfig: { promptId: 0, blockKeyword: 'BLOCK' },
    execute: async (ctx, config) => {
      const promptId = Number(config.promptId ?? 0);
      const prompts = listAiPrompts();
      const p = prompts.find((x) => x.id === promptId);
      if (!p) return { status: 'error', message: 'Prompt nicht gefunden' };
      const user = interpolateTemplate(p.user_template.replace(/\{\{text\}\}/g, ctx.strings.combined_text), ctx);
      const blockKw = String(config.blockKeyword ?? 'BLOCK').trim() || 'BLOCK';
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run ai.review' };
      try {
        const out = await runChatCompletion(
          'Antworte nur mit OK oder BLOCK. BLOCK wenn der Inhalt laut Prüfauftrag problematisch ist.',
          user,
        );
        ctx.ai.lastResponse = out;
        const blocked = out.toUpperCase().includes(blockKw.toUpperCase());
        if (blocked && ctx.direction === 'outbound') {
          const id = ctx.messageId ?? ctx.outbound?.messageId;
          if (id != null) setOutboundHold(id, true, 'KI-Prüfung: Versand blockiert');
          return { status: 'ok', blocked: true, blockReason: 'KI-Prüfung' };
        }
        if (blocked && ctx.messageId != null) addMessageTag(ctx.messageId, 'ki-review-block');
        return { status: 'ok' };
      } catch (e) {
        if (ctx.direction === 'outbound') {
          const id = ctx.messageId ?? ctx.outbound?.messageId;
          if (id != null) setOutboundHold(id, true, 'KI-Fehler');
          return { status: 'error', blocked: true, blockReason: 'KI-Fehler' };
        }
        return { status: 'error', message: e instanceof Error ? e.message : String(e) };
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
      const promptId = Number(config.promptId ?? 0);
      const p = listAiPrompts().find((x) => x.id === promptId);
      if (!p) return { status: 'error', message: 'Prompt nicht gefunden' };
      const user = interpolateTemplate(p.user_template, ctx);
      if (ctx.dryRun) return { status: 'ok' };
      const out = await runChatCompletion(
        'Du bist ein Assistent für geschäftliche E-Mails. Antworte nur mit dem bearbeiteten Text.',
        user,
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
      thresholdHint: 70,
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
      const prompt = `Klassifiziere die E-Mail in genau eine Kategorie: ${labels.join(', ')}. Antworte nur mit dem Kategorienamen.\n\n${text}`;
      if (ctx.dryRun) return { status: 'ok' };
      const out = await runChatCompletion('Du bist ein E-Mail-Klassifizierer.', prompt);
      ctx.ai.lastResponse = out;
      const label = out.trim().split(/\s+/)[0] ?? '';
      if (ctx.messageId != null && label) addMessageTag(ctx.messageId, `ki:${label}`);
      return { status: 'ok', variables: { 'ai.class': label } };
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
      createDraft: true,
    },
    execute: async (ctx, config) => {
      const system = String(config.systemPrompt ?? '');
      const kbId = config.knowledgeBaseId != null ? Number(config.knowledgeBaseId) : null;
      const chunks = kbId
        ? await searchKnowledgeChunks(kbId, ctx.strings.combined_text, 5)
        : [];
      const kbText = chunks.map((c) => c.content).join('\n---\n');
      const user = [
        'Nachricht:',
        ctx.strings.combined_text,
        kbText ? `\nWissensbasis:\n${kbText}` : '',
      ].join('\n');
      if (ctx.dryRun) return { status: 'ok', message: 'dry-run agent' };
      const out = await runChatCompletion(system, user);
      ctx.ai.lastResponse = out;
      const variables: Record<string, string | number | boolean | null> = {
        'ai.agent.response': out,
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
        const list = listCannedResponses().slice(0, 5);
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
}
