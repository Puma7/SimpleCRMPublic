import { listAiPrompts } from '../../email/email-crm-store';
import { runChatCompletion } from '../../email/email-openai';
import { addMessageTag, createComposeDraft, setOutboundHold } from '../../email/email-store';
// createComposeDraft used by ai.agent
import { interpolateTemplate } from '../context';
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
    type: 'ai.classify',
    label: 'KI-Klassifizierung',
    category: 'ai',
    canvasType: 'registry',
    defaultConfig: { labels: 'Rechnung,Support,Spam' },
    execute: async (ctx, config) => {
      const labels = String(config.labels ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (labels.length === 0) return { status: 'skipped' };
      const prompt = `Klassifiziere die E-Mail in genau eine Kategorie: ${labels.join(', ')}. Antworte nur mit dem Kategorienamen.\n\n${ctx.strings.combined_text}`;
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
      const chunks = kbId ? searchKnowledgeChunks(kbId, ctx.strings.combined_text, 5) : [];
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
}
