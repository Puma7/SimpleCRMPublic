# Mail Alpha — Checkliste

Stand: automatisierte Gates + kurzer manueller Smoke.

## Automatisiert (CI / lokal)

- [ ] `pnpm run lint` grün
- [ ] `pnpm test` grün (Haupt-Jest)
- [ ] `pnpm run test:mail` grün (Mail-Modul, in CI)
- [ ] `pnpm run test:mail:coverage` grün (Ratchet-Schwellen)
- [ ] `tests/mail/sqlite-fresh-install.integration.test.ts` grün
- [ ] `npm run build:electron:main` grün

## Manuell (~5 Min)

- [ ] Posteingang-Badge = nur **unerledigte** Mails (Filter „Unerledigt“ stimmt mit Sidebar überein)
- [ ] Spam/Archiv/Papierkorb: keine irreführenden „offen“-Punkte; nach Wiederherstellen wieder offen im Posteingang
- [ ] Gesendet: kein Sidebar-Badge nach normalem Versand; Badge nur bei fehlgeschlagener IMAP-Server-Kopie
- [ ] Shift+Klick Bereichsauswahl; Bulk **Erledigt** im Posteingang
- [ ] „Alle in dieser Ansicht“ mit Bestätigungsdialog (max. 500)

## Nach Alpha (kleine UX/Rest)

- Sidebar-Badges sofort nach Aktionen: ✅ [#84](https://github.com/Puma7/SimpleCRMPublic/pull/84)
- NF11/NF3/NF17b: ✅ [#86](https://github.com/Puma7/SimpleCRMPublic/pull/86)
- Rest-Backlog F/NF: [`MAIL_REMAINING_BACKLOG.md`](MAIL_REMAINING_BACKLOG.md)

## Bewusst nicht Alpha-Blocker

- Echtes Server-Threading (Aufklappen, Thread-Bulk)
- 100 % Coverage auf `electron/email/**`
- PGP / Open-Click-Tracking

## PR-Merge-Reihenfolge

1. [#80](https://github.com/Puma7/SimpleCRMPublic/pull/80) Posteingang UX — **merged**
2. [#81](https://github.com/Puma7/SimpleCRMPublic/pull/81) Phase 2 — **merged**
3. [#83](https://github.com/Puma7/SimpleCRMPublic/pull/83) Mail Alpha-Gate — **merged** (CI `test:mail`, Coverage-Ratchet, Fresh-DB-Integrationstest)

Lokale Merge-Simulation (vor #80/#81): keine Konflikte mit `main`.
