import { applyCannedTemplate, needsFullMessageBody } from '../../src/components/email/types';
import {
  COMPOSE_BODY_MARKER,
  COMPOSE_QUOTE_MARKER,
  COMPOSE_SIGNATURE_MARKER,
  buildReplyComposeHtml,
  composeAiContextText,
  mergeComposeZones,
  mergeEditorAndSignature,
  sanitizeComposeHtmlPreservingZones,
  splitAndSanitizeComposeHtml,
  splitComposeZones,
  splitEditorAndSignature,
} from '../../shared/compose-body';
import {
  aiDraftLikelyIncludesGreeting,
  buildReplyGreeting,
  replyGreetingPlainToHtml,
} from '../../shared/email-reply-greeting';
import { buildAiTransformSystemPrompt } from '../../shared/ai-transform-prompt';
import {
  buildSignatureTemplateContext,
  interpolateSignatureTemplate,
} from '../../shared/signature-template';

jest.mock('quill', () => ({ __esModule: true, default: class MockQuill {} }));
jest.mock('quill/dist/quill.snow.css', () => ({}));
jest.mock('@/styles/compose-quill.css', () => ({}));

import { handleSubjectTabToEditor } from '../../src/components/email/compose-dialog';

describe('compose subject tab routing', () => {
  it('moves plain Tab focus from subject to the message editor', () => {
    const preventDefault = jest.fn();
    const focus = jest.fn(() => true);

    handleSubjectTabToEditor(
      { key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault },
      { focus },
    );

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('keeps native Tab navigation when the message editor is unavailable', () => {
    const preventDefault = jest.fn();

    handleSubjectTabToEditor(
      { key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault },
      null,
    );

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('keeps native Tab navigation when the message editor cannot focus', () => {
    const preventDefault = jest.fn();
    const focus = jest.fn(() => false);

    handleSubjectTabToEditor(
      { key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault },
      { focus },
    );

    expect(focus).toHaveBeenCalledTimes(1);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    { key: 'Tab', shiftKey: true, ctrlKey: false, metaKey: false, altKey: false },
    { key: 'Tab', shiftKey: false, ctrlKey: true, metaKey: false, altKey: false },
    { key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: true, altKey: false },
    { key: 'Tab', shiftKey: false, ctrlKey: false, metaKey: false, altKey: true },
    { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false },
  ])('leaves modified Tab and other keys alone: $key', (event) => {
    const preventDefault = jest.fn();
    const focus = jest.fn();

    handleSubjectTabToEditor({ ...event, preventDefault }, { focus });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });
});

describe('compose-body zones', () => {
  it('splits and merges greeting, body, signature and quote', () => {
    const html = buildReplyComposeHtml({
      greetingHtml: '<p>Guten Tag,</p>',
      replyHtml: '<p>Haupttext</p>',
      signatureHtml: '<p>Grüße</p>',
      quotedPlain: 'Original',
    });
    const zones = splitComposeZones(html);
    expect(zones.greetingHtml).toContain('Guten Tag');
    expect(zones.bodyHtml).toContain('Haupttext');
    expect(zones.signatureHtml).toContain('Grüße');
    expect(zones.quotedHtml).toContain('Original');
    expect(composeAiContextText(zones)).toContain('Guten Tag');
    expect(composeAiContextText(zones)).toContain('Haupttext');
    expect(composeAiContextText(zones)).not.toContain('Grüße');
  });

  it('legacy html without zone markers treats editable as body', () => {
    const legacy = `<p>Alt</p>${COMPOSE_QUOTE_MARKER}<p>Zitat</p>`;
    const zones = splitComposeZones(legacy);
    expect(zones.bodyHtml).toContain('Alt');
    expect(zones.greetingHtml).toBe('');
  });

  it('mergeComposeZones preserves markers', () => {
    const merged = mergeComposeZones({
      greetingHtml: '<p>Hi</p>',
      bodyHtml: '<p>Body</p>',
      signatureHtml: '<p>Sig</p>',
      quotedHtml: '<p>Q</p>',
    });
    expect(merged).toContain(COMPOSE_BODY_MARKER);
    expect(merged).toContain(COMPOSE_SIGNATURE_MARKER);
    expect(merged).toContain(COMPOSE_QUOTE_MARKER);
  });

  it('splitEditorAndSignature isolates signature from Quill content', () => {
    const full = buildReplyComposeHtml({
      greetingHtml: '<p>Hi</p>',
      replyHtml: '<p>Body</p>',
      signatureHtml: '<p>Sig</p>',
      quotedPlain: 'Original',
    });
    const split = splitEditorAndSignature(full);
    expect(split.signatureHtml).toContain('Sig');
    expect(split.editorHtml).toContain('Body');
    expect(split.editorHtml).not.toContain('Sig');
    expect(split.editorHtml).not.toContain('Original');
    expect(split.quotedHtml).toContain('Original');
    const merged = mergeEditorAndSignature(split.editorHtml, split.signatureHtml, split.quotedHtml);
    expect(merged).toContain(COMPOSE_SIGNATURE_MARKER);
    expect(merged).toContain('Sig');
  });

  it('splits stored zones before a sanitizer removes marker comments', () => {
    const stored = buildReplyComposeHtml({
      greetingHtml: '<p>Guten Tag,</p>',
      replyHtml: '<p>Antwort</p>',
      signatureHtml: '<p>Einmalige Signatur</p>',
      quotedPlain: 'Vorherige Nachricht',
    });
    const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');

    const restored = splitAndSanitizeComposeHtml(stored, stripComments);

    expect(restored.editorHtml).toContain('Antwort');
    expect(restored.editorHtml).not.toContain('Einmalige Signatur');
    expect(restored.editorHtml).not.toContain('Vorherige Nachricht');
    expect(restored.signatureHtml).toContain('Einmalige Signatur');
    expect(restored.quotedHtml).toContain('Vorherige Nachricht');
  });

  it('preserves zone boundaries through the autosave sanitize and restore roundtrip', () => {
    const composed = buildReplyComposeHtml({
      greetingHtml: '<p>Guten Tag,</p>',
      replyHtml: '<p>Antwort<script>alert(1)</script></p>',
      signatureHtml: '<p>Einmalige Signatur</p>',
      quotedPlain: 'Vorherige Nachricht',
    });
    const sanitizer = (html: string) => html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '');

    const stored = sanitizeComposeHtmlPreservingZones(composed, sanitizer);
    const restored = splitAndSanitizeComposeHtml(stored, sanitizer);
    const restoredEditorZones = splitComposeZones(restored.editorHtml);

    expect(stored).toContain(COMPOSE_BODY_MARKER);
    expect(stored).toContain(COMPOSE_SIGNATURE_MARKER);
    expect(stored).toContain(COMPOSE_QUOTE_MARKER);
    expect(stored).not.toContain('<script>');
    expect(restored.editorHtml).toContain('Antwort');
    expect(restoredEditorZones.greetingHtml).toContain('Guten Tag');
    expect(restoredEditorZones.bodyHtml).toContain('Antwort');
    expect(restored.editorHtml).not.toContain('Einmalige Signatur');
    expect(restored.signatureHtml).toContain('Einmalige Signatur');
    expect(restored.quotedHtml).toContain('Vorherige Nachricht');
  });
});

describe('email-reply-greeting', () => {
  it('builds salutation from customer', () => {
    expect(
      buildReplyGreeting({
        customer: { salutation: 'Frau', name: 'Anna Müller' },
      }),
    ).toBe('Sehr geehrte Frau Müller,');
  });

  it('detects greeting in ai draft', () => {
    expect(aiDraftLikelyIncludesGreeting('Sehr geehrter Herr Test,')).toBe(true);
    expect(aiDraftLikelyIncludesGreeting('Wir bestätigen den Eingang.')).toBe(false);
  });

  it('replyGreetingPlainToHtml wraps paragraph', () => {
    expect(replyGreetingPlainToHtml('Guten Tag,')).toBe('<p>Guten Tag,</p>');
  });
});

describe('ai-transform-prompt', () => {
  it('selection mode includes context only', () => {
    const prompt = buildAiTransformSystemPrompt({
      sourceText: 'markiert',
      contextText: 'gesamter Text mit markiert',
    });
    expect(prompt).toContain('markierten Abschnitt');
    expect(prompt).toContain('gesamter Text');
  });

  it('includes inbound and user context', () => {
    const prompt = buildAiTransformSystemPrompt({
      sourceText: 'body',
      inboundContextText: 'Kundenmail',
      userContext: 'Storno möglich',
    });
    expect(prompt).toContain('Kundenmail');
    expect(prompt).toContain('<bearbeiter_hinweis>');
    expect(prompt).toContain('Storno möglich');
  });

  it('insert mode asks for new text only', () => {
    const prompt = buildAiTransformSystemPrompt({
      sourceText: '(neuer Absatz)',
      contextText: 'Guten Tag,\n\nBestehender Text',
      insertMode: true,
    });
    expect(prompt).toContain('EINFÜGEN');
    expect(prompt).toContain('BESTEHENDER ANTWORT-ENTWURF');
    expect(prompt).not.toContain('markierten Abschnitt');
  });
});

describe('signature-template', () => {
  it('interpolates placeholders', () => {
    const out = interpolateSignatureTemplate(
      'Grüße {{account.display_name}} / {{customer.name}}',
      { accountDisplayName: 'Shop', customerName: 'Müller GmbH' },
    );
    expect(out).toBe('Grüße Shop / Müller GmbH');
  });

  it('preserves customer placeholders until customer context is provided', () => {
    const out = interpolateSignatureTemplate(
      'Grüße {{account.display_name}} / {{customer.name}}',
      buildSignatureTemplateContext({
        accountDisplayName: 'Shop',
        accountEmail: 'shop@example.com',
      }),
    );
    expect(out).toBe('Grüße Shop / {{customer.name}}');
  });

  it('buildSignatureTemplateContext resolves user from team or account', () => {
    const ctx = buildSignatureTemplateContext({
      accountDisplayName: 'Shop Nord',
      accountEmail: 'nord@example.com',
      teamMemberDisplayName: 'Anna Agent',
    });
    expect(ctx.userName).toBe('Anna Agent');
    expect(ctx.userEmail).toBe('nord@example.com');
    expect(interpolateSignatureTemplate('{{user.name}} <{{user.email}}>', ctx)).toBe(
      'Anna Agent <nord@example.com>',
    );
  });

  it('prefers the explicit public name for {{user.publicName}}', () => {
    const ctx = buildSignatureTemplateContext({
      accountDisplayName: 'Shop Nord',
      accountEmail: 'nord@example.com',
      teamMemberDisplayName: 'Anna Agent',
      userDisplayName: 'Anna Schmidt',
      userPublicName: 'A. Schmidt (Kundenservice)',
    });
    expect(interpolateSignatureTemplate('{{user.publicName}}', ctx)).toBe('A. Schmidt (Kundenservice)');
    // {{user.name}} keeps the existing team/account behaviour.
    expect(interpolateSignatureTemplate('{{user.name}}', ctx)).toBe('Anna Agent');
  });

  it('falls back {{user.publicName}} to the display name when only the user context is given', () => {
    const viaDisplay = buildSignatureTemplateContext({
      accountDisplayName: 'Shop Nord',
      userDisplayName: 'Anna Schmidt',
    });
    expect(interpolateSignatureTemplate('{{user.publicName}}', viaDisplay)).toBe('Anna Schmidt');
  });

  it('leaves {{user.publicName}} untouched without a sender context, then a client pass fills it', () => {
    // Server pre-interpolation (account/team only) must NOT consume the token —
    // otherwise a shared account signature shows the account name, not the sender.
    const serverPass = interpolateSignatureTemplate(
      'Mit freundlichen Grüßen<br/>{{user.publicName}}',
      buildSignatureTemplateContext({ accountDisplayName: 'Shop Nord', teamMemberDisplayName: 'Anna Agent' }),
    );
    expect(serverPass).toBe('Mit freundlichen Grüßen<br/>{{user.publicName}}');

    // The client pass, which knows the sending user, resolves it.
    const clientPass = interpolateSignatureTemplate(
      serverPass,
      buildSignatureTemplateContext({ userPublicName: 'A. Schmidt (Kundenservice)' }),
    );
    expect(clientPass).toBe('Mit freundlichen Grüßen<br/>A. Schmidt (Kundenservice)');
  });
});

describe('applyCannedTemplate', () => {
  it('fills customer, account and user placeholders', () => {
    const out = applyCannedTemplate(
      'Hallo {{customer.firstName}}, hier ist {{user.publicName}} von {{account.display_name}}.',
      { id: 1, name: 'Anna Müller', firstName: 'Anna', email: 'a@example.com' },
      {
        accountDisplayName: 'Shop Nord',
        userName: 'Bea Berater',
        userEmail: 'bea@example.com',
        userPublicName: 'Bea (Kundenservice)',
      },
    );
    expect(out).toBe('Hallo Anna, hier ist Bea (Kundenservice) von Shop Nord.');
  });

  it('{{user.publicName}} falls back to the user name when no alias is set', () => {
    const out = applyCannedTemplate('{{user.publicName}}', null, { userName: 'Bea Berater' });
    expect(out).toBe('Bea Berater');
  });

  it('leaves account/user placeholders empty when no context is provided', () => {
    const out = applyCannedTemplate('[{{account.display_name}}|{{user.name}}|{{customer.name}}]');
    expect(out).toBe('[||]');
  });
});

describe('needsFullMessageBody', () => {
  it('detects summary rows without body fields', () => {
    expect(needsFullMessageBody({ body_text: null, body_html: null })).toBe(true);
    expect(needsFullMessageBody({ body_text: '  ', body_html: null })).toBe(true);
    expect(needsFullMessageBody({ body_text: null, body_html: '<p>x</p>' })).toBe(false);
    expect(needsFullMessageBody({ body_text: 'hello', body_html: null })).toBe(false);
  });
});
