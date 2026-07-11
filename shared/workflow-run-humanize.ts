/**
 * Übersetzt maschinenlesbare Workflow-Codes aus der Lauf-Historie
 * (Schritt-Meldungen, Ports) in verständliche deutsche Sätze.
 *
 * Die Executoren (electron/workflow/nodes/*.ts) und die Runtime
 * (electron/workflow/runtime.ts) schreiben kompakte Codes wie
 * `auto_reply:blocked:disabled` oder `send_draft_queued_auto` in die
 * Schritt-Tabelle. Für Laien erklärt diese Schicht, WAS passiert ist und
 * WAS zu tun ist. Unbekannte oder bereits deutsche Meldungen werden
 * unverändert durchgereicht; der Roh-Code bleibt in der UI als
 * Tooltip/Mono-Zeile sichtbar.
 */

const EXACT_MESSAGES: Record<string, string> = {
  // email.auto_reply (Gate) — block()-Gründe
  'auto_reply:blocked:disabled':
    'Auto-Antwort übersprungen: Der Schalter in Einstellungen → Automatisierung ist aus.',
  'auto_reply:blocked:noreply_sender':
    'Auto-Antwort übersprungen: Der Absender ist eine No-Reply-Adresse – eine Antwort würde niemanden erreichen.',
  'auto_reply:blocked:automated_sender':
    'Auto-Antwort übersprungen: Die Nachricht stammt von einem automatischen System (z. B. Newsletter oder Abwesenheitsnotiz). So werden Antwort-Schleifen vermieden.',
  'auto_reply:blocked:rate_limited':
    'Auto-Antwort übersprungen: Tageslimit für diesen Absender erreicht. Morgen wird wieder automatisch geantwortet.',
  'auto_reply:blocked:low_confidence':
    'Auto-Antwort übersprungen: Die KI war sich nicht sicher genug. Bitte manuell antworten oder die Mindest-Konfidenz im Knoten senken.',
  'auto_reply:blocked:no_message':
    'Auto-Antwort übersprungen: Es liegt keine E-Mail-Nachricht vor, auf die geantwortet werden könnte.',
  'auto_reply:approved': 'Auto-Antwort erlaubt: Alle Sicherheitsprüfungen bestanden.',

  // email.send_draft
  send_draft_queued_auto:
    'Entwurf zum automatischen Versand eingeplant (ohne zusätzliche Ausgangsprüfung).',
  send_draft_queued_with_review:
    'Entwurf zum Versand eingeplant – vor dem Senden läuft noch die Ausgangsprüfung.',
  auto_reply_disabled:
    'Versand übersprungen: Automatische Antworten sind ausgeschaltet (Einstellungen → Automatisierung).',
  noreply_sender_blocked:
    'Versand übersprungen: Der Absender ist eine No-Reply-Adresse – eine Antwort würde niemanden erreichen.',
  automated_sender_blocked:
    'Versand übersprungen: Die eingehende Mail stammt von einem automatischen System oder Newsletter – eine Antwort könnte eine Endlos-Schleife auslösen.',
  auto_reply_rate_limited:
    'Versand übersprungen: Diese Absenderadresse hat heute schon die maximale Zahl automatischer Antworten erhalten (Einstellungen → Automatisierung).',

  // email.forward_copy
  'forward_copy:attachments_skipped_desktop':
    'Weitergeleitet ohne Anhänge: Die Desktop-Edition unterstützt Anhang-Weiterleitung noch nicht — nur der Text wurde gesendet.',

  // email.release_outbound
  outbound_hold_cleared: 'Ausgangssperre entfernt – der Versand kann normal fortgesetzt werden.',
  outbound_hold_released: 'Ausgangssperre aufgehoben – der Entwurf kann jetzt gesendet werden.',
  outbound_hold_released_auto_send:
    'Ausgangssperre aufgehoben – der Entwurf wird automatisch versendet.',

  // email.tag
  'leerer Tag': 'Übersprungen: Im Knoten „Tag setzen“ ist kein Tag-Name eingetragen.',

  // Runtime (Inbound-Schutzregel, Lauf-Marker)
  'skip:no_prior_condition':
    'Übersprungen: Vorher hat keine Bedingung zugestimmt. Aktionen auf eingehende Mails laufen nur nach einer erfüllten Bedingung (Schutzregel).',
  graph_run_start: 'Workflow-Lauf gestartet.',
  graph_missing: 'Kein Workflow-Graph gespeichert – bitte den Workflow im Editor öffnen und speichern.',
  no_trigger: 'Der Workflow hat keinen Auslöser-Knoten (Trigger).',
  trigger_no_edges:
    'Der Auslöser ist mit keinem weiteren Knoten verbunden – es wurde nichts ausgeführt.',
  stop: 'Workflow wurde hier planmäßig gestoppt.',
  'loop:empty': 'Schleife übersprungen: Keine Elemente zum Durchlaufen gefunden.',
};

const SKIP_NO_PRIOR_CONDITION = EXACT_MESSAGES['skip:no_prior_condition']!;

function formatDelayedUntil(detail: string): string {
  const parsed = new Date(detail);
  const label = Number.isNaN(parsed.getTime()) ? detail : parsed.toLocaleString('de-DE');
  return `Workflow pausiert bis ${label} – danach laufen die restlichen Schritte automatisch weiter.`;
}

function formatLoopMarker(detail: string): string {
  // loop:<index>:<item> → menschliche Zählung ab 1.
  const m = /^(\d+):(.*)$/.exec(detail);
  if (m) return `Schleifendurchlauf ${Number(m[1]) + 1}: ${m[2]}`;
  return `Schleife: ${detail}`;
}

type PrefixRule = {
  prefix: string;
  humanize: (detail: string, raw: string) => string;
};

/** Reihenfolge zählt: speziellere Präfixe (loop:limit:) vor allgemeinen (loop:). */
const PREFIX_MESSAGES: PrefixRule[] = [
  {
    prefix: 'auto_reply:blocked:',
    humanize: (detail) => `Auto-Antwort übersprungen (Grund: ${detail}).`,
  },
  {
    prefix: 'imap_seen_sync_deferred:',
    humanize: (detail) =>
      `Als gelesen markiert – die Übertragung an den Mail-Server wird beim nächsten Abgleich nachgeholt.${detail ? ` (${detail})` : ''}`,
  },
  {
    prefix: 'review_error:',
    humanize: (detail) =>
      `KI-Gegenprüfung fehlgeschlagen – der Entwurf wartet sicherheitshalber auf manuelle Freigabe.${detail ? ` (${detail})` : ''}`,
  },
  { prefix: 'delayed_until:', humanize: formatDelayedUntil },
  {
    prefix: 'dry-run',
    humanize: () => 'Testlauf: Diese Aktion wurde nur simuliert und nicht wirklich ausgeführt.',
  },
  {
    prefix: 'delay ',
    humanize: (detail) => `Testlauf: Verzögerung (${detail}) wurde nur simuliert.`,
  },
  {
    prefix: 'condition:',
    humanize: (detail, raw) => {
      if (raw.endsWith(':no')) {
        return `Bedingung „${detail.slice(0, -':no'.length)}“ nicht erfüllt → Nein-Zweig.`;
      }
      if (raw.endsWith(':yes')) {
        return `Bedingung „${detail.slice(0, -':yes'.length)}“ erfüllt → Ja-Zweig.`;
      }
      return `Bedingung geprüft: ${detail}`;
    },
  },
  { prefix: 'branch:', humanize: (detail) => `Zweig gestartet (ab Knoten ${detail}).` },
  { prefix: 'graph_resume:', humanize: (detail) => `Workflow fortgesetzt ab Knoten ${detail}.` },
  {
    prefix: 'cycle:',
    humanize: (detail) =>
      `Durchlauf hier beendet: Knoten ${detail} wurde bereits ausgeführt (Kreis im Workflow).`,
  },
  {
    prefix: 'unknown_node:',
    humanize: (detail) =>
      `Unbekannter Knotentyp „${detail}“ – dieser Schritt kann nicht ausgeführt werden.`,
  },
  {
    prefix: 'loop:limit:',
    humanize: (detail) => `Schleife auf ${detail} Elemente begrenzt – weitere Einträge wurden ignoriert.`,
  },
  { prefix: 'loop:', humanize: formatLoopMarker },
  {
    prefix: 'skip:',
    humanize: (detail, raw) =>
      raw.endsWith(':no_prior_condition') ? SKIP_NO_PRIOR_CONDITION : raw,
  },
];

/**
 * Übersetzt eine Schritt-Meldung in einen deutschen Satz.
 * Unbekannte (oder bereits deutsche) Meldungen kommen unverändert zurück;
 * leere Eingaben ergeben null.
 */
export function humanizeWorkflowStepMessage(message: string | null | undefined): string | null {
  const raw = (message ?? '').trim();
  if (!raw) return null;
  const exact = EXACT_MESSAGES[raw];
  if (exact) return exact;
  for (const rule of PREFIX_MESSAGES) {
    if (!raw.startsWith(rule.prefix)) continue;
    const detail = raw.slice(rule.prefix.length).trim();
    return rule.humanize(detail, raw);
  }
  return raw;
}

const PORT_LABELS: Record<string, string> = {
  approved: 'Erlaubt',
  blocked: 'Blockiert',
  send: 'Senden',
  hold: 'Prüfen (wartet auf Freigabe)',
  yes: 'Ja',
  no: 'Nein',
  each: 'Je Element',
  done: 'Fertig',
  pass: 'Bestanden',
  fail: 'Nicht bestanden',
  none: 'Keine Daten',
  whitelist: 'Vertrauenswürdig',
  blacklist: 'Blockiert',
  default: 'Standard',
  error: 'Fehler',
};

/**
 * Übersetzt einen Port (Kanten-/Verzweigungsnamen) in ein deutsches Label.
 * Unbekannte Ports (z. B. logic.switch-Fälle) kommen unverändert zurück;
 * leere Eingaben ergeben null.
 */
export function humanizeWorkflowPort(port: string | null | undefined): string | null {
  const raw = (port ?? '').trim();
  if (!raw) return null;
  return PORT_LABELS[raw.toLowerCase()] ?? raw;
}

export type WorkflowStepTone = 'ok' | 'warn' | 'error';

/**
 * Ampel-Einstufung eines Schritts/Laufs für die Farbgebung der Historie:
 * error-Status → 'error'; blocked/hold-Ports, skipped- oder blocked-Status
 * → 'warn'; alles andere → 'ok'.
 */
export function stepTone(
  status: string | null | undefined,
  port: string | null | undefined,
): WorkflowStepTone {
  const s = (status ?? '').trim().toLowerCase();
  if (s === 'error') return 'error';
  const p = (port ?? '').trim().toLowerCase();
  if (s === 'skipped' || s === 'blocked' || p === 'blocked' || p === 'hold') return 'warn';
  return 'ok';
}
