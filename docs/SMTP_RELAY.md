# SMTP-Relay: SimpleCRM als Ausgangs-SMTP-Server für Fremdsysteme

Die Server-Edition kann als **authentifiziertes SMTP-Relay** für Fremdsysteme
(z. B. JTL-Wawi, Shop, Fibu) dienen: das Fremdsystem trägt SimpleCRM als
Ausgangs-SMTP-Server ein; SimpleCRM nimmt die Mail an, prüft Absender und
Berechtigung, versendet sie über das **richtige echte E-Mail-Konto** weiter,
bildet sie als CRM-Nachricht ab und kann sie **regelbasiert** mit einem
Open-Tracking-Pixel versehen (z. B. nur Mahnungen). Über den Workflow-Trigger
**„SMTP-Relay (nach Versand)"** lässt sich z. B. nach 14 Tagen ohne Öffnung
automatisch eine Telefon-Nachfass-Aufgabe anlegen (Template
*„Relay: Mahnung ohne Reaktion nachfassen"*), bevor eine Forderung ins Inkasso
geht.

**Nur Server-Edition.** Die Desktop-App kann keinen öffentlichen SMTP-Listener
hosten.

## Aktivierung (Umgebungsvariablen)

| Variable | Default | Bedeutung |
|---|---|---|
| `SMTP_RELAY_ENABLED` | `false` | Relay-Listener starten |
| `SMTP_RELAY_HOSTNAME` | – | EHLO-/Banner-Name (z. B. `mail.firma.de`) |
| `SMTP_RELAY_PORT_SUBMISSION` | `587` | Submission-Port (STARTTLS) |
| `SMTP_RELAY_PORT_SMTPS` | `465` | SMTPS-Port (implizites TLS) |
| `SMTP_RELAY_BIND_HOST` | `0.0.0.0` | Bind-Adresse |
| `SMTP_RELAY_TLS_CERT_FILE` | – | PEM-Zertifikat (Pflicht) |
| `SMTP_RELAY_TLS_KEY_FILE` | – | PEM-Key (Pflicht) |
| `SMTP_RELAY_MAX_MESSAGE_BYTES` | `26214400` | Globale Größenobergrenze |
| `SMTP_RELAY_MAX_CONNECTIONS` | `50` | Gleichzeitige Verbindungen |
| `SMTP_RELAY_SOCKET_TIMEOUT_MS` | `120000` | Socket-Timeout |

Ohne lesbares Zertifikat/Key startet der Relay **nicht** (die API läuft normal
weiter; Fehlermeldung im Log unter `[smtp-relay]`). Caddy proxyt nur HTTP —
die Ports 587/465 müssen in Firewall/Compose zusätzlich zum Container
durchgereicht werden; das TLS des Relays kommt aus den beiden PEM-Dateien
(z. B. dieselben Let's-Encrypt-Dateien, die Caddy nutzt, als Volume mounten).

Tracking setzt zusätzlich die bestehende Tracking-Infrastruktur voraus
(`PUBLIC_BASE_URL` + `SIMPLECRM_MASTER_KEY` und eine aktivierte
Tracking-Richtlinie mit Rechtsgrundlage, siehe
`docs/EMAIL_EVIDENCE_TRACKING.md`). Ohne Tracking-Konfiguration arbeitet das
Relay normal weiter — nur ohne Pixel.

## Verwaltung (Einstellungen → E-Mail → SMTP-Relay, nur Admin)

1. **Relay anlegen** (z. B. „JTL Wawi"). Pro Fremdsystem ein Relay.
2. **Erlaubte Konten** zuordnen: Nur diese Konten darf das Fremdsystem als
   `From:` verwenden; über dieses Konto geht die Mail auch tatsächlich raus
   (kombiniertes Auth + Routing). Optional eine abweichende From-Adresse
   pro Konto festlegen.
3. **Zugangsdaten erzeugen**: Benutzername (`relay-…`) und Passwort werden
   serverseitig generiert; das **Passwort wird genau einmal angezeigt**
   (nur der Hash wird auf der Zeile gespeichert, der Klartext liegt
   verschlüsselt im Secret-Store). Bei Verlust: widerrufen + neu erzeugen.
4. **Tracking-Regel** konfigurieren:
   - Modus `Aus` / `Regelbasiert` / `Immer`.
   - Regelbasiert: Betreff-Muster (eins pro Zeile; Substring, oder
     `/regex/flags`). Default-Empfehlung: `mahnung`, `zahlungserinnerung`.
   - `X-SimpleCRM-Track: on|off`-Header des Fremdsystems kann die Regel
     übersteuern (abschaltbar); ein explizites `off` gewinnt immer.
5. **Follow-up-Workflow** wählen (z. B. aus dem Template
   *Relay: Mahnung ohne Reaktion nachfassen*): läuft nach jedem erfolgreichen
   Relay dieser Route mit der persistierten Nachricht.
6. **Einlieferungen** (letzte 50) pro Relay einsehen: Status, Empfängerzahl,
   Tracking-Entscheidung, Fehlertext.

## Konfiguration im Fremdsystem (z. B. JTL)

- SMTP-Server: `<SMTP_RELAY_HOSTNAME>`, Port `587` (STARTTLS) oder `465`
  (SSL/TLS), Authentifizierung: generierter Benutzer + Passwort.
- Absenderadresse muss einer der **erlaubten Konten-Adressen** entsprechen,
  sonst wird die Mail mit `550 5.7.1` abgelehnt.

## Sicherheit (kein Open-Relay)

- **AUTH ist Pflicht** auf beiden Ports; vor STARTTLS wird keine
  Authentifizierung angenommen (nur PLAIN/LOGIN über TLS).
- **Doppelte From-Prüfung**: Envelope (`MAIL FROM`) *und* Header-`From:`
  müssen zum erlaubten Konto der Zugangsdaten passen (Spoofing-Schutz).
- Limits pro Relay: max. Empfänger/Mail, Nachrichtengröße, Rate-Limit
  pro Zugangsdaten (Token-Bucket, `451` bei Überschreitung).
- Eingehende `X-SimpleCRM-*`-Header werden beim Durchleiten **entfernt**
  (keine Steuer-Header-Injektion von außen).
- Antworten: `535` (Login), `550 5.7.1` (From nicht erlaubt), `452` (zu viele
  Empfänger), `552` (zu groß), `451` (temporär, Fremdsystem versucht erneut),
  `250 OK: relayed as <id>` (Erfolg — erst **nach** erfolgreichem Weiterversand).
- Kein Klartext-Passwort in Logs oder Listenansichten; Audit-Events für
  Anlegen/Ändern/Löschen/Widerruf.

## Ablauf einer Einlieferung

`AUTH` (Zugangsdaten → Workspace/Relay) → `MAIL FROM` (∈ erlaubte Konten) →
`RCPT TO` (Limits) → `DATA` → Parsen → Header-From-Gegenprüfung →
Tracking-Regel → als `email_messages` (Ordner *Gesendet*, Kunde über
Empfängeradresse) + `smtp_relay_submissions` persistieren → ggf. Pixel
injizieren (RFC822 wird nur dann neu gebaut; sonst Byte-Pass-through) →
Versand über das echte Konto (`sendSmtpMessage`) → Kopie in den
IMAP-Gesendet-Ordner (best effort) → Follow-up-Workflow einreihen.

Wiederholte Einlieferungen derselben Message-ID nach einem bereits
erfolgreichen Relay werden idempotent mit `250` beantwortet (kein
Doppelversand im Pass-through-Modus).

## Grenzen / Hinweise

- Öffnungs-Tracking ist ein **Signal**, kein Beweis (Proxy/Scanner-Öffnungen
  werden klassifiziert; siehe `docs/EMAIL_EVIDENCE_TRACKING.md`).
- Pixel-Zuordnung ist pro Nachricht, nicht pro Empfänger — für Mahnungen
  (ein Empfänger) ausreichend.
- Wird die Mail getrackt, baut das Relay das RFC822 neu auf (eigene
  Message-ID); eine etwaige DKIM-Signatur des Fremdsystems geht dabei
  verloren — normalerweise unkritisch, weil der echte Versand-Provider
  ausgangsseitig signiert.
- Die 14-Tage-Wartezeit des Templates ist als 2×7-Tage-Verzögerung
  modelliert (systemweite Obergrenze pro Delay-Schritt: 7 Tage).
