import { redactPersonalData } from '../../packages/core/src/learnings/redact';

describe('redactPersonalData (TA-P5)', () => {
  it('ersetzt E-Mail-Adressen und Links', () => {
    const out = redactPersonalData(
      'Schreiben Sie an max.mustermann+shop@beispiel-firma.de oder nutzen Sie https://shop.example.com/track?id=4711&token=abc sowie www.example.org/faq.',
    );
    expect(out).toBe('Schreiben Sie an [E-Mail] oder nutzen Sie [Link] sowie [Link].');
  });

  it('urlMode "query" behält Host und Pfad, ersetzt Query und ID-Segmente', () => {
    const out = redactPersonalData('Details: https://shop.example.com/konto/bestellungen/1234567?session=xyz#top', {
      urlMode: 'query',
    });
    expect(out).toBe('Details: https://shop.example.com/konto/bestellungen/[Link]?[Link]');
    expect(redactPersonalData('Siehe https://example.com/rueckgabe', { urlMode: 'query' }))
      .toBe('Siehe https://example.com/rueckgabe');
  });

  it('ersetzt Telefonnummern in DE/AT/CH/internationalen Schreibweisen', () => {
    const cases: Array<[string, string]> = [
      ['Rufen Sie uns an: 0761 123456.', 'Rufen Sie uns an: [Telefon].'],
      ['Mobil: 0171-1234567', 'Mobil: [Telefon]'],
      ['Tel. +49 (0)761 12345-67', 'Tel. [Telefon]'],
      ['Erreichbar unter +43 1 234 56 78 oder 0049 30 12345678', 'Erreichbar unter [Telefon] oder [Telefon]'],
      ['Zentrale Zürich +41 44 668 18 00', 'Zentrale Zürich [Telefon]'],
      ['Fax 030/12345678', 'Fax [Telefon]'],
      ['Call +1 (555) 123-4567 today', 'Call [Telefon] today'],
      ['Telefon: 123 456 789', 'Telefon: [Telefon]'],
    ];
    for (const [input, expected] of cases) {
      expect(redactPersonalData(input)).toBe(expected);
    }
  });

  it('ersetzt IBAN und BIC', () => {
    expect(redactPersonalData('IBAN: DE89 3704 0044 0532 0130 00, BIC: COBADEFFXXX'))
      .toBe('IBAN: [IBAN], BIC: [BIC]');
    expect(redactPersonalData('Konto AT611904300234573201 bei GENODEF1S02'))
      .toBe('Konto [IBAN] bei [BIC]');
    expect(redactPersonalData('CH9300762011623852957')).toBe('[IBAN]');
  });

  it('ersetzt Bestell-, Kunden- und Rechnungsnummern, behält das Stichwort', () => {
    expect(redactPersonalData('Ihre Bestellung 12345 ist unterwegs.')).toBe('Ihre Bestellung [Nummer] ist unterwegs.');
    expect(redactPersonalData('Kd.-Nr. 998877, Rechnungsnummer: RE-2024-0042'))
      .toBe('Kd.-Nr. [Nummer], Rechnungsnummer: [Nummer]');
    expect(redactPersonalData('Bestellnummer #4711-2024 und Order number: A123456'))
      .toBe('Bestellnummer #[Nummer] und Order number: [Nummer]');
    expect(redactPersonalData('Betreff [SCR-8F3A21] Rückfrage')).toBe('Betreff [Nummer] Rückfrage');
    expect(redactPersonalData('Sendung 00340434161094042557 zugestellt')).toBe('Sendung [Nummer] zugestellt');
    expect(redactPersonalData('Ticket #48213 wurde geschlossen')).toBe('Ticket #[Nummer] wurde geschlossen');
  });

  it('ersetzt Straßen- und PLZ/Ort-Angaben', () => {
    expect(redactPersonalData('Lieferadresse: Hauptstraße 5a, 79098 Freiburg im Breisgau'))
      .toBe('Lieferadresse: [Adresse], [Adresse]');
    expect(redactPersonalData('Musterweg 12\nA-1010 Wien')).toBe('[Adresse]\n[Adresse]');
    expect(redactPersonalData('Bahnhofstr. 3\n8001 Zürich')).toBe('[Adresse]\n[Adresse]');
    expect(redactPersonalData('Ship to 221 Baker Street, London')).toBe('Ship to [Adresse], London');
  });

  it('ersetzt übergebene Namen inkl. Bestandteilen und Anrede-Namen', () => {
    const out = redactPersonalData(
      'Max Mustermann hat angerufen. Herr Mustermann möchte, dass MAX informiert wird. Frau Schmidt ebenfalls.',
      { names: ['Max Mustermann'] },
    );
    expect(out).toBe('[Name] hat angerufen. Herr [Name] möchte, dass [Name] informiert wird. Frau [Name] ebenfalls.');
    expect(redactPersonalData('Danke, Erika!', { names: ['erika.musterfrau@example.com'] })).toBe('Danke, [Name]!');
    expect(redactPersonalData('Mustermann, Max bestellt', { names: ['Mustermann, Max'] })).toBe('[Name] bestellt');
  });

  it('lässt Datum, Uhrzeit, Preise, Mengen und Fristen stehen (keine Fehlalarme)', () => {
    const text = [
      'Am 12.03.2024 um 08:30 Uhr wurde geliefert.',
      'Der Preis beträgt 1.299,00 € bzw. EUR 19,99; ab 50 € versandkostenfrei.',
      'Rechnung: 1.299,00 € wurde bezahlt.',
      'Bitte 3 Stück bzw. 10000 Stück, Lieferzeit 10-12 Werktage, Rückgabe innerhalb von 14 Tagen.',
      'Version 2.4.1 vom 01.02.2025, Order 100 pieces.',
      'Im Jahr 2024 Lieferung nach Absprache; max. 5 Artikel je Bestellung.',
      'Frau Schmidt Bescheid geben.',
    ].join('\n');
    const out = redactPersonalData(text, { names: ['Max Mustermann'] });
    expect(out).toContain('Am 12.03.2024 um 08:30 Uhr wurde geliefert.');
    expect(out).toContain('1.299,00 € bzw. EUR 19,99; ab 50 € versandkostenfrei.');
    expect(out).toContain('Rechnung: 1.299,00 € wurde bezahlt.');
    expect(out).toContain('Bitte 3 Stück bzw. 10000 Stück, Lieferzeit 10-12 Werktage, Rückgabe innerhalb von 14 Tagen.');
    expect(out).toContain('Version 2.4.1 vom 01.02.2025, Order 100 pieces.');
    expect(out).toContain('Im Jahr 2024 Lieferung nach Absprache; max. 5 Artikel je Bestellung.');
    expect(out).toContain('Frau [Name] Bescheid geben.');
  });

  it('ist idempotent und lässt Platzhalter unverändert', () => {
    const input = 'Herr Max Mustermann, max@example.com, 0761 123456, IBAN DE89370400440532013000, Bestellung 12345.';
    const once = redactPersonalData(input, { names: ['Max Mustermann'] });
    expect(redactPersonalData(once, { names: ['Max Mustermann'] })).toBe(once);
    expect(once).not.toMatch(/Mustermann|example\.com|123456|DE89/);
  });

  it('keepExisting behält Daten, die schon in der Wissensbasis stehen', () => {
    const base = '## Kontakt\n\nHotline 0800 1234567, service@firma.de';
    expect(redactPersonalData('Hotline 0800 1234567 oder service@firma.de, sonst kunde@web.de', { keepExisting: base }))
      .toBe('Hotline 0800 1234567 oder service@firma.de, sonst [E-Mail]');
  });

  it('englische Texte', () => {
    expect(redactPersonalData('Dear Mr. Smith, your invoice number: INV-20240042 is attached. Call +44 20 7946 0958.'))
      .toBe('Dear Mr. [Name], your invoice number: [Nummer] is attached. Call [Telefon].');
  });
});
