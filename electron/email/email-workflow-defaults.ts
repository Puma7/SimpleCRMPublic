import type { WorkflowDefinitionV1 } from './email-workflow-types';

export const DEFAULT_INBOUND_WORKFLOW: WorkflowDefinitionV1 = {
  version: 1,
  rules: [
    {
      when: {
        field: 'combined_text',
        op: 'contains',
        value: 'amazon',
        caseInsensitive: true,
      },
      then: [{ type: 'tag', tag: 'Amazon' }, { type: 'archive' }],
    },
    {
      when: {
        field: 'combined_text',
        op: 'contains',
        value: 'newsletter',
        caseInsensitive: true,
      },
      then: [{ type: 'tag', tag: 'Newsletter' }, { type: 'mark_seen' }],
    },
  ],
};

export const DEFAULT_OUTBOUND_WORKFLOW: WorkflowDefinitionV1 = {
  version: 1,
  rules: [
    {
      when: {
        field: 'combined_text',
        op: 'regex',
        value: '\\bIBAN\\b|\\bDE\\d{20}\\b|Kontostand|Passwort\\s*[:\\s]',
        caseInsensitive: true,
      },
      then: [
        {
          type: 'hold_outbound',
          reason:
            'Mögliche sensible Daten erkannt (z. B. IBAN, Kontostand, Passwort). Bitte prüfen und ggf. Formulierung anpassen.',
        },
        { type: 'stop' },
      ],
    },
  ],
};
