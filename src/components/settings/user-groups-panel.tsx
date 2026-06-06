"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, Trash2, Users } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer } from "@/services/transport"
import { userGroupService, type UserGroup, type UserGroupMember } from "@/services/data/userGroupService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type AppUser = { id: string; display_name: string; username: string }

export function UserGroupsPanel() {
  const [groups, setGroups] = useState<UserGroup[]>([])
  const [users, setUsers] = useState<AppUser[]>([])
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [members, setMembers] = useState<UserGroupMember[]>([])
  const [addUserId, setAddUserId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadGroups = useCallback(async () => {
    setGroups(await userGroupService.list())
  }, [])

  const loadMembers = useCallback(async (groupId: number) => {
    setMembers(await userGroupService.listMembers(groupId))
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [groupList, userList] = await Promise.all([
          userGroupService.list(),
          invokeRenderer(IPCChannels.Auth.ListUsers, undefined) as Promise<AppUser[]>,
        ])
        setGroups(groupList)
        if (Array.isArray(userList)) setUsers(userList)
      } catch (e) {
        setError(describeError(e))
      }
    })()
  }, [])

  const run = async (action: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    try {
      await action()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  const createGroup = () =>
    run(async () => {
      if (!name.trim()) {
        setError("Bitte einen Gruppennamen eingeben.")
        return
      }
      await userGroupService.create(name.trim(), description.trim() || undefined)
      setName("")
      setDescription("")
      await loadGroups()
    })

  const deleteGroup = (groupId: number) =>
    run(async () => {
      await userGroupService.remove(groupId)
      if (selectedGroupId === groupId) {
        setSelectedGroupId(null)
        setMembers([])
      }
      await loadGroups()
    })

  const openMembers = (groupId: number) =>
    run(async () => {
      setSelectedGroupId(groupId)
      setAddUserId("")
      await loadMembers(groupId)
    })

  const addMember = () =>
    run(async () => {
      if (selectedGroupId === null || !addUserId) return
      await userGroupService.addMember(selectedGroupId, addUserId)
      setAddUserId("")
      await Promise.all([loadMembers(selectedGroupId), loadGroups()])
    })

  const removeMember = (userId: string) =>
    run(async () => {
      if (selectedGroupId === null) return
      await userGroupService.removeMember(selectedGroupId, userId)
      await Promise.all([loadMembers(selectedGroupId), loadGroups()])
    })

  const memberIds = new Set(members.map((m) => m.userId))
  const selectableUsers = users.filter((u) => !memberIds.has(u.id))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Benutzergruppen</CardTitle>
        <CardDescription>
          Gruppen für die Zuweisung von Aufgaben (z. B. Support, Vertrieb).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="group-name">Name</Label>
            <Input id="group-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Support" />
          </div>
          <div>
            <Label htmlFor="group-desc">Beschreibung (optional)</Label>
            <Input id="group-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <Button type="button" disabled={busy || !name.trim()} onClick={() => void createGroup()}>
          Gruppe anlegen
        </Button>

        <ul className="space-y-1 text-sm">
          {groups.length === 0 ? (
            <li className="text-muted-foreground">Noch keine Gruppen angelegt.</li>
          ) : null}
          {groups.map((group) => (
            <li key={group.id} className="flex items-center justify-between gap-2 border-b py-2">
              <span>
                <span className="font-medium">{group.name}</span>
                {group.description ? <span className="text-muted-foreground"> — {group.description}</span> : null}
                <span className="text-muted-foreground"> ({group.memberCount} Mitglieder)</span>
              </span>
              <span className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void openMembers(group.id)}>
                  <Users className="mr-1 h-3.5 w-3.5" /> Mitglieder
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void deleteGroup(group.id)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </span>
            </li>
          ))}
        </ul>

        {selectedGroupId !== null ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">
              Mitglieder von {groups.find((g) => g.id === selectedGroupId)?.name ?? "Gruppe"}
            </p>
            <ul className="space-y-1 text-sm">
              {members.length === 0 ? <li className="text-muted-foreground">Keine Mitglieder.</li> : null}
              {members.map((member) => (
                <li key={member.userId} className="flex items-center justify-between gap-2">
                  <span>{member.displayName} ({member.email})</span>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void removeMember(member.userId)}>
                    Entfernen
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="add-member">Mitglied hinzufügen</Label>
                <Select value={addUserId} onValueChange={setAddUserId}>
                  <SelectTrigger id="add-member">
                    <SelectValue placeholder="Benutzer auswählen..." />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.display_name || u.username}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" disabled={busy || !addUserId} onClick={() => void addMember()}>
                Hinzufügen
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : "Aktion fehlgeschlagen."
}
