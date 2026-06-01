# Mail — PGP Threat Model

## Architektur

- **OpenPGP.js** nur im **Main-Prozess**.
- Private Keys in **Keytar** (Handle in `pgp_identities`), nicht im Klartext in SQLite.
- **Entschlüsselter Body** standardmäßig nur im Speicher (keine `pgp_decrypted_body_text`-Spalte).

## Was PGP schützt

- Inhalt und Anhänge der verschlüsselten Mail gegen Dritte auf dem Transportweg (wenn korrekt genutzt).

## Was PGP nicht schützt

- **Betreff** bleibt im Klartext (RFC).
- **Metadaten** (Von, An, Datum) in SQLite und auf dem Server.
- **Lokaler Angreifer** mit DB-/Dateizugriff.
- **WKD/Keyserver** sind standardmäßig aus (Kontakt-Leaks).

## Workflows

- Kein automatischer Klartext für verschlüsselte Mails; optionaler Workflow-Knoten `pgp.decrypt_if_possible` (später).

## S/MIME

- Separates Epic; nicht Teil der PGP-Phase.
