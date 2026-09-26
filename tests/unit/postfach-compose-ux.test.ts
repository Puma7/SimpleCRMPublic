import { applyCannedTemplate, needsFullMessageBody, stripHtmlToText } from '../../src/components/email/types';
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
import {
  buildReplyGreeting as buildServerReplyGreeting,
  replyGreetingPlainToHtml as serverReplyGreetingPlainToHtml,
} from '../../packages/server/src/email-reply-greeting';
import { buildAiTransformSystemPrompt } from '../../shared/ai-transform-prompt';
import {
  buildSignatureTemplateContext,
  interpolateSignatureTemplate,
} from '../../shared/signature-template';
import { interpolateSignatureTemplate as interpolateServerSignatureTemplate } from '../../packages/server/src/signature-template';

jest.mock('quill', () => ({ __esModule: true, default: class MockQuill {} }));
jest.mock('quill/dist/quill.snow.css', () => ({}));
jest.mock('@/styles/compose-quill.css', () => ({}));

import {
  composeTrackingChoice,
  handleSubjectTabToEditor,
  hydrateComposeFieldsFromDraftMessage,
} from '../../src/components/email/compose-dialog';
import type { EmailMessage } from '../../src/components/email/types';

// F-A3a-02: the tracking checkbox appeared (and sent trackingOverride) although the admin policy had tracking disabled.
describe('compose per-message tracking checkbox', () => {
  it('stays hidden while the workspace tracking policy is disabled', () => {
    expect(composeTrackingChoice({ enabled: false, trackOpens: false, trackLinks: false })).toEqual({
      available: false,
      defaultOn: false,
    });
    expect(composeTrackingChoice({
      enabled: false,
      trackOpens: true,
      trackLinks: true,
      defaultTrackNewMessages: true,
    })).toEqual({ available: false, defaultOn: false });
    expect(composeTrackingChoice({ enabled: true, trackOpens: false, trackLinks: false })).toEqual({
      available: false,
      defaultOn: false,
    });
  });

  it('is offered inside an enabled policy and seeds from the new-message default', () => {
    expect(composeTrackingChoice({ enabled: true, trackOpens: true, defaultTrackNewMessages: true })).toEqual({
      available: true,
      defaultOn: true,
    });
    expect(composeTrackingChoice({ enabled: true, trackLinks: true, defaultTrackNewMessages: false })).toEqual({
      available: true,
      defaultOn: false,
    });
  });
});

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

describe('compose draft hydration', () => {
  // F-A11a-01: Klartext-Entwuerfe (body_html null) wurden ungeescaped als HTML in den Composer geladen.
  it('escapes a plain-text draft body instead of interpreting it as markup', () => {
    const existing = {
      id: 42,
      body_html: null,
      body_text:
        'Hallo <img src="https://attacker.example/p.png"> <a href="https://phish.example">Rechnung</a>\n'
        + '& <Kunde> <!-- simplecrm-quote --><img src="https://attacker.example/q.png">',
      draft_attachment_paths_json: null,
    } as unknown as EmailMessage;

    const hydrated = hydrateComposeFieldsFromDraftMessage(existing);

    expect(hydrated.editorHtml).not.toMatch(/<img/i);
    expect(hydrated.editorHtml).not.toMatch(/<a\s/i);
    expect(hydrated.editorHtml).toContain('&lt;img');
    expect(hydrated.editorHtml).toContain('&amp; &lt;Kunde&gt;');
    expect(hydrated.editorHtml).toContain('<br');
    // Ein Zonenmarker im Fremdtext darf keine Zitat- oder Signaturzone abspalten.
    expect(hydrated.quotedHtml).toBe('');
    expect(hydrated.signatureHtml).toBe('');
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

  // F-A6-01: Markup und Zonenmarker aus dem From-Anzeigenamen landeten roh im Antwort-HTML.
  it.each([
    ['desktop/renderer', buildReplyGreeting, replyGreetingPlainToHtml],
    ['server', buildServerReplyGreeting, serverReplyGreetingPlainToHtml],
  ] as const)('escapes the sender display name in the reply greeting html (%s)', (_edition, build, toHtml) => {
    const fromJson = JSON.stringify({
      value: [{
        address: 'x@evil.tld',
        name: 'Test <!-- simplecrm-quote --><img src="https://example.org/x.png"> & Co',
      }],
    });
    const greetingHtml = toHtml(build({ fromJson }));
    const composed = buildReplyComposeHtml({
      greetingHtml,
      replyHtml: '<p><br></p>',
      quotedPlain: 'Original',
      signatureHtml: '<p>Sig</p>',
    });
    const split = splitEditorAndSignature(composed);

    expect(greetingHtml).toBe(
      '<p>Guten Tag Test &lt;!-- simplecrm-quote --&gt;&lt;img src=&quot;https://example.org/x.png&quot;&gt; &amp; Co,</p>',
    );
    expect(split.quotedHtml).not.toContain('<img');
    expect(split.quotedHtml).toBe('<p>Original</p>');
    expect(split.signatureHtml).toBe('<p>Sig</p>');
    expect(split.editorHtml).not.toContain('<img');
  });

  // F-D1-09: 'herr'/'frau' irgendwo im From-Anzeigenamen (Sherry, Frauke, Herrmann) erzeugte eine falsche Anrede.
  it.each([
    ['desktop/renderer', buildReplyGreeting],
    ['server', buildServerReplyGreeting],
  ] as const)('derives the salutation from the sender name only for a leading Herr/Frau (%s)', (_edition, build) => {
    const fromName = (name: string) => build({
      fromJson: JSON.stringify({ value: [{ name, address: 'kontakt@example.com' }] }),
    });

    // Teilstring-Treffer sind keine Anrede.
    expect(fromName('Sherry Miller')).toBe('Guten Tag Sherry Miller,');
    expect(fromName('Frauke Schmidt')).toBe('Guten Tag Frauke Schmidt,');
    expect(fromName('Anna Herrmann')).toBe('Guten Tag Anna Herrmann,');
    expect(fromName('Herrera GmbH')).toBe('Guten Tag Herrera GmbH,');
    expect(fromName('Frauenhofer Institut')).toBe('Guten Tag Frauenhofer Institut,');
    // "Herr" als Nachname ist ebenfalls keine Anrede.
    expect(fromName('Anna Herr')).toBe('Guten Tag Anna Herr,');
    // Ohne Namen hinter der Anrede gibt es keinen Nachnamen.
    expect(fromName('Herr')).toBe('Guten Tag Herr,');

    // Eine vorangestellte Anrede bleibt erkannt.
    expect(fromName('Herr Max Müller')).toBe('Sehr geehrter Herr Müller,');
    expect(fromName('frau Anna Müller')).toBe('Sehr geehrte Frau Müller,');
    expect(fromName('Frau Dr. Anna Müller')).toBe('Sehr geehrte Frau Müller,');
    expect(fromName('Herr. Max Müller')).toBe('Sehr geehrter Herr Müller,');
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

  // F-A11a-07: Platzhalterwerte (Kunden-, Konto-, Nutzername) wurden ohne HTML-Escaping in die Signatur gesetzt.
  it.each([
    ['desktop/renderer', interpolateSignatureTemplate],
    ['server', interpolateServerSignatureTemplate],
  ] as const)('escapes placeholder values inserted into the signature html (%s)', (_edition, interpolate) => {
    expect(
      interpolate('<p>{{customer.name}}</p>', { customerName: 'Müller<img src="https://x.example/p.png">' }),
    ).toBe('<p>Müller&lt;img src=&quot;https://x.example/p.png&quot;&gt;</p>');
    expect(
      interpolate('<p>{{account.display_name}} / {{user.name}} / {{user.publicName}}</p>', {
        accountDisplayName: 'A & B <b>',
        userName: "O'Brien <i>",
        userPublicName: '<u>Pub</u>',
      }),
    ).toBe('<p>A &amp; B &lt;b&gt; / O&#39;Brien &lt;i&gt; / &lt;u&gt;Pub&lt;/u&gt;</p>');
    // Anfuehrungszeichen duerfen ein Attribut der Vorlage nicht verlassen.
    const attr = interpolate('<a href="mailto:{{customer.email}}">{{customer.firstName}}</a>', {
      customerName: 'Anna Müller',
      customerFirstName: 'Anna',
      customerEmail: 'x" style="position:fixed',
    });
    expect(attr).toBe('<a href="mailto:x&quot; style=&quot;position:fixed">Anna</a>');
    expect(interpolate('<p>{{user.email}}</p>', { userEmail: 'a<b>@example.com' }))
      .toBe('<p>a&lt;b&gt;@example.com</p>');
    expect(interpolate('<p>{{customer.name}}</p>', { customerName: "Preis $& $' Co" }))
      .toBe('<p>Preis $&amp; $&#39; Co</p>');
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

  // F-N-fe-01: Kunden-, Konto- und Nutzernamen landeten roh im Compose-HTML und wurden dort wirksames Markup; '$&' im Wert wirkte als Ersetzungsmuster.
  it('escapes placeholder values for the compose html', () => {
    const out = applyCannedTemplate(
      '{{customer.name}}|{{customer.firstName}}|{{customer.email}}|{{account.display_name}}|{{user.publicName}}|{{user.name}}|{{user.email}}',
      { id: 1, name: 'Müller<img src="https://x.example/p.png">', firstName: "O'Brien <b>", email: 'a<b>@example.com' },
      {
        accountDisplayName: 'A & B <i>',
        userName: 'Bea <u>',
        userEmail: 'bea"x@example.com',
        userPublicName: 'Preis $& $\' Co',
      },
    );
    expect(out).toBe(
      'Müller&lt;img src=&quot;https://x.example/p.png&quot;&gt;|O&#39;Brien &lt;b&gt;|a&lt;b&gt;@example.com'
        + '|A &amp; B &lt;i&gt;|Preis $&amp; $&#39; Co|Bea &lt;u&gt;|bea&quot;x@example.com',
    );
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

describe('stripHtmlToText', () => {
  // F-N-redos-01: Lazy-/Negativklassen-Regexe liefen bei unverschlossenen <script/<style/< quadratisch; eine praeparierte Mail fror Viewer und Compose ein.
  it('stays linear on unclosed tags', () => {
    for (const html of ['<'.repeat(60_000), '<script'.repeat(20_000), `<p>x</p>${'<style'.repeat(20_000)}`]) {
      const started = Date.now();
      const text = stripHtmlToText(html);
      expect(Date.now() - started).toBeLessThan(500);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  // F-N-redos-01: Der lineare Strip muss exakt das Ergebnis der bisherigen Regex-Kette liefern.
  it('matches the previous regex chain', () => {
    const legacy = (html: string): string => html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const samples = [
      '',
      'Nur Text',
      '<p>Hallo <b>Welt</b></p>',
      'a<script>x</script>b<style>y</style>c',
      '<script><style></script></style>rest',
      '<style><script></style></script>rest',
      '<SCRIPT type="x">1</sCrIpT>mehr<style>unterminated <p>bleibt</p>',
      'a <> b <<c>> d > e < f',
    ];
    const tokens = [
      '<', '>', '<>', 'a', ' ', '\n', '<p>', '</p>', '<style', '<STYLE>', '</style>', '</StYlE>',
      '<script', '<Script>', '</script>', '</SCRIPT>', 'ſ', 'İ',
    ];
    let seed = 0x5eed;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    for (let n = 0; n < 3000; n++) {
      const count = Math.floor(random() * 14);
      let html = '';
      for (let i = 0; i < count; i++) html += tokens[Math.floor(random() * tokens.length)];
      samples.push(html);
    }
    for (const html of samples) {
      expect(stripHtmlToText(html)).toBe(legacy(html));
    }
  });
});
