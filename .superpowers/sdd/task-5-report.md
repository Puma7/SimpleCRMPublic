# Task 5 Report: Enforce HTTP and query paths

## Status

Abgeschlossen. Alle als `permission` klassifizierten HTTP-Mailrouten werden vor
ihrem fachlichen Handler zentral autorisiert. Objekteltern werden aus PostgreSQL
aufgeloest; Listen, Suche, Counts, Threads, Reporting und Export erhalten einen
request-lokalen SQL-Scope vor Pagination beziehungsweise Aggregation.

`.superpowers/sdd/progress.md` wurde nicht geaendert.

## Dateien

- `packages/server/src/mail-access/types.ts`
- `packages/server/src/mail-access/http-policy-enforcer.ts`
- `packages/server/src/mail-access/postgres-mail-resource-lookup.ts`
- `packages/server/src/mail-access/sql-scope.ts`
- `packages/server/src/api/types.ts`
- `packages/server/src/api/server-api.ts`
- `packages/server/src/api/mail-metadata-routes.ts`
- `packages/server/src/db/postgres-mail-read-ports.ts`
- `packages/server/src/db/postgres-mail-metadata-read-ports.ts`
- `packages/server/src/db/postgres-email-reporting-port.ts`
- `packages/server/src/mail-gdpr-export.ts`
- `packages/server/src/server.ts`
- `tests/integration/server-mail-access-routes.test.ts`
- `tests/unit/server-edition-foundation.test.ts`
- `tests/integration/server-edition-foundation.test.ts`
- `.superpowers/sdd/task-5-report.md`

Die Foundation-Dateien enthalten nur den zentralen All-Scope-ACL-Testadapter und
die neue einheitliche Selector-Fehlerform. Das Task-4-Manifest, Progressdateien und
Task-6/7/8-Code wurden nicht geaendert.

## TDD-Evidenz

- Baseline vor Task-5-Tests:
  `pnpm exec jest tests/integration/server-mail-access-routes.test.ts --runInBand`:
  PASS, 1 Suite, 9/9 Tests.
- RED nach den zuerst hinzugefuegten negativen HTTP- und Embedded-PostgreSQL-Tests:
  FAIL, 8 fehlgeschlagen, 10 bestanden, 18 gesamt. Nach Korrektur reiner
  Testharness-Themen blieben ausschliesslich die erwarteten Produktluecken:
  direkte Message-/Attachment-/Bulk-/Settings-Aufrufe erreichten Handler,
  Listen-/Count-/Thread-/Reporting-Ports erhielten keinen Scope, Owner-
  Workspace-/Attachment-/Send-as-Trennung fehlte, SQL-Counts/Threads/Reporting
  waren ungescopt und der Export versuchte statt der Test-Factory den echten
  Archiver zu laden.
- Erster Implementierungslauf: 17/18 Tests bestanden. Der letzte Fehler belegte
  eine PostgreSQL-`bigint`-Serialisierung der oeffentlichen Export-Message-ID als
  String; die ID wird jetzt verlustfrei als Zahl exportiert.
- GREEN:
  `pnpm exec jest tests/integration/server-mail-access-routes.test.ts --runInBand`:
  PASS, 1 Suite, 18/18 Tests, 0 Snapshots.
- Das gemischte Bulk-Szenario besitzt einen `mail.triage`-Grant nur fuer die erste
  Message. Eine zweite verweigerte Message verhindert den Handler vollstaendig;
  doppelte IDs werden vor den Assertions dedupliziert.

## HTTP-Durchsetzung

- Der kanonische Mail-Dispatcher matched Methode plus Runtime-Pattern und ruft
  `assertMailRoutePolicy(req.method, req.path)` ueber den zentralen Enforcer auf.
  Methoden-Fallthrough und bestehende 404/405-Pfade bleiben erhalten.
- `exempt` kehrt ohne ACL-Eingriff zu den bestehenden Tracking-, Auth-/Setup- und
  Admin-/Capability-Pruefungen zurueck. Public Tracking bleibt vor dem
  authentifizierten Dispatcher.
- Path-, Query- und Body-Selectoren akzeptieren nur kanonische positive
  Safe-Integer; Account-Signatur-Source-IDs duerfen als bestehende Ausnahme
  negative, aber nicht null sein. Thread-IDs werden streng begrenzt.
- Account, Folder, Message, Attachment, Thread und abhaengige Metadata werden mit
  Workspace-Bindung aus PostgreSQL aufgeloest. Nur Account-IDs verwenden den
  bestehenden PG-/Source-SQLite-Kanonisierer. Thread-Aliase werden auf ihre
  kanonische Nachrichtenmenge aufgeloest; Legacy-Aliase ohne Account-Eltern fallen
  auf reale Thread-Messages zurueck.
- Owner/Admin werden erst nach erfolgreicher DB-Aufloesung durch den Task-3-Service
  privilegiert. Actor- und Lookup-Workspace stammen ausschliesslich aus dem
  authentifizierten Principal.
- Unbekannte Policy, ungueltige Selector-ID, fehlende Ressource und verweigerte
  Ressource liefern einheitlich Status 404, Code `mail_resource_not_found` und
  `Mail-Ressource nicht gefunden`, ohne IDs oder Ressourcentyp.
- `resolveScope()` wird pro Scope-Request/Permission memoisiert und maximal einmal
  ausgefuehrt. Restricted/none werden ueber request-lokal geklonte Ports an die
  SQL-Reader gegeben; `{kind:'all'}` laesst die bestehenden Portaufrufe unveraendert.
- `event_message_then_account_lookup` wird im HTTP-Enforcer immer verweigert.
  Bulk-Ziele werden komplett aufgeloest und autorisiert, bevor ein Handler laeuft.
- Attachment- und Content-Rechte sowie Send und Send-as werden separat geprueft.
  Cross-Account-Send benoetigt `mail.send_as`; Reply-Quellen benoetigen zusaetzlich
  `mail.content.read`. Ein gesonderter bestehender suspicious-download-HTTP-Pfad
  existiert nicht und wurde deshalb nicht erfunden.

## SQL-Scope

- `mailScopePredicate()` gibt fuer `all` kein Praedikat zurueck, fuer `none`
  garantiert `false` und fuer `restricted` die additive OR-Menge aus Account-,
  Folder- und Message-IDs. Alle IDs bleiben Kysely-Parameter.
- Message-Liste: Scope nach Workspace und vor Limit/Offset; gilt fuer Regex,
  FTS/ILIKE, Cursor, Account/Folder/View und Retry-Query. Der korrelierte
  `thread_message_count` zaehlt nur sichtbare Messages.
- Folder-/Category-Counts: Scope steht in der Message-Query vor `sum`, `count` und
  `group by`. Folder-Metadata wird vor Cursor/Limit auf Account-/Folder-Grants
  beschraenkt; ein Message-only-Grant exponiert keinen Parent-Folder.
- Conversation und Thread-Message-Liste filtern vor Limit/Offset. Thread-Listen
  verlangen mindestens eine sichtbare Message und berechnen Count, Unread und
  Attachment-Aggregate nur aus sichtbaren Messages.
- Reporting scoped Accounts, Totals, Per-Account und Workflow-Runs vor Aggregation
  beziehungsweise Limit. Accounts werden bei Folder-/Message-Ausnahmen nur ueber
  eine tatsaechlich sichtbare Message aufgenommen.
- GDPR-Export scoped Attachment-Groessenpruefung, Accounts, Message-Batches,
  Notizen, Workflows/-Runs und Tracking-Messages/-Links/-Events in den SQL-Queries
  vor Cursor/Batch-Limit. Workspace-globale Tracking-Policy wird bei partiellem
  Scope ausgelassen. Injected Archive-/Stream-Factories machen den echten DB-Pfad
  ohne ESM-Mock testbar.
- Konkrete Metadata-Listen fuer Tags, Message-Categories, Notizen, Read-Receipts,
  Thread-Kanten/-Aliase/-Warnungen, Canned Responses und Account-Signaturen werden
  vor Cursor/Limit gescopt. Kanten verlangen sichtbaren Parent und Child. Globale
  Kategorien, Team-Mitglieder, Remote-Allowlist sowie andere nicht belastbar an
  Mailboxeltern bindbare partielle GET-Sichten werden fuer restricted Actors
  fail-closed verweigert.

## Tests

- Reale negative HTTP-Vertraege: direkte fremde Message, Attachment-Content,
  gemischtes Bulk, Account-Settings, Scope-Weitergabe, Owner/Admin-Workspace,
  Attachment-/Send-as-Unabhaengigkeit sowie exempt/Nicht-Mail-Regression.
- Reale Embedded-PostgreSQL-Semantik: none/folder/message/account fuer Message-
  Suche und Pagination, Folder-/Category-Counts, Folder-Metadata, partielle Threads,
  Reporting und GDPR-Export.
- Positive Vererbung: Account-Grant auf Messages; Folder-only nur eigener Folder;
  Message-only ohne Geschwister/Parent-Folder; eigener Owner/Admin erlaubt,
  fremder Workspace verweigert.

## Verifikation

- Fokussierter Task-5-Test: PASS, 1 Suite, 18/18 Tests.
- Vollstaendiges `server-edition-foundation`: PASS, 2 Suites, 427/427 Tests.
- ESLint: `pnpm run lint`: PASS, Exit 0, keine Warnungen.
- Server-Build: `pnpm --filter @simplecrm/server build`: PASS, Exit 0.
- Root-Typecheck: `pnpm run typecheck`: PASS, Exit 0.
- Diff-Check: `git diff --check`: PASS, Exit 0, keine Ausgabe.

## Self-Review

- Existenzleaks: Autorisierung findet vor dem Handler statt; Ressource fehlt und
  Recht fehlt sind oeffentlich identisch. Lookup-Fehler enthalten keine IDs.
- Query-Reihenfolge: In allen genannten Pfaden wird der Scope am Select-Builder vor
  Cursor/Offset/Limit beziehungsweise vor Aggregat-Ausfuehrung komponiert. Es gibt
  keine nachtraegliche In-Memory-Filterung von Mailboxdaten.
- Side Effects: Kein fachlicher Port wird vor Abschluss aller Objekt-/Bulk-
  Assertions aufgerufen. Empty-Bulk erreicht weiterhin nur die vorhandene
  Payloadvalidierung; es gibt keine Mutation ohne Ziele.
- Scope-Herkunft: `mailScope` kann nicht aus Query oder Body kommen, globale Ports
  und Requestobjekte werden nicht mutiert, und All-Scope fuegt keine SQL-Klausel
  hinzu.
- Permission-Trennung: Content, Attachment, suspicious Attachment, Triage, Export,
  Send und Send-as werden nicht gegenseitig impliziert. Account-Settings verwenden
  den aufgeloesten Account mit `mail.account.manage`.
- Grenzen: Keine Job-/Event-Revalidierung, Delegations-CRUD/UI oder Shadow-/Rollout-
  Logik wurde implementiert.

## Restbedenken

Keine bekannten funktionalen oder Security-Bedenken im Task-5-Scope. Job- und
Event-Revalidierung bleibt gemaess Plan ausdruecklich Aufgabe von Task 6.
