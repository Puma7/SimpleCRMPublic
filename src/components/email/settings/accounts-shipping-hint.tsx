"use client"

/** Kurzer Hinweis zu Kontotypen (IMAP/POP3 vs. reiner Versand). */
export function AccountsShippingHint() {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">Kontotypen</p>
      <ul className="mt-1.5 list-inside list-disc space-y-1">
        <li>
          Jedes Postfach benötigt <strong>IMAP oder POP3</strong> für den Posteingang. SMTP und OAuth
          konfigurieren Sie pro Konto in den Tabs daneben.
        </li>
        <li>
          <strong>Reine SMTP-Konten</strong> (z. B. nur noreply@ zum Versand ohne Posteingang) werden
          derzeit nicht unterstützt — Versand läuft immer über ein vollständiges Postfach.
        </li>
        <li>
          <strong>OAuth</strong> (Gmail, Microsoft 365) ersetzt nicht den Posteingang: Sie verknüpfen
          Token pro Konto; die App-Registrierung liegt unter Einstellungen → OAuth-Apps.
        </li>
      </ul>
    </div>
  )
}
