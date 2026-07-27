"use client"

import { UsersPanel } from "@/components/settings/users-panel"
import { ChangePasswordCard } from "@/components/settings/change-password-card"
import { useAuth } from "@/components/auth/auth-context"

/**
 * Der Tab „App-Benutzer" ist bewusst auch ohne `settings.view` erreichbar
 * (`personalAccount: true`) — aber nur wegen der Passwortkarte, die reine
 * Selbstbedienung ist.
 *
 * Das UsersPanel darunter ruft schon beim Mounten `Auth.ListUsers` auf, und
 * dieser Endpunkt verlangt ausdruecklich `users.manage`
 * (`auth-routes.ts` handleListUsers). Ohne das Recht waere der Tab eine
 * garantierte 403-Fehlermeldung samt Knoepfen, die allesamt ebenfalls im 403
 * enden. Der `personalOnly`-Zweig in settings-panels macht es seit jeher so;
 * hier fehlte das Gate.
 *
 * Eigene Datei, damit die Regel ohne den gesamten Panel-Baum testbar bleibt.
 */
export function AppUsersTab() {
  const { canManageUsers } = useAuth()
  return (
    <div className="space-y-6">
      <ChangePasswordCard />
      {canManageUsers ? <UsersPanel /> : null}
    </div>
  )
}
