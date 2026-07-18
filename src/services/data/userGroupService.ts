import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer } from "@/services/transport"

export type UserGroup = {
  id: number
  name: string
  description: string | null
  memberCount: number
  updatedAt: string
}

export type UserGroupMember = {
  userId: string
  email: string
  displayName: string
  role: "owner" | "admin" | "user"
}

/** User groups for task assignment (server edition). */
export const userGroupService = {
  async list(): Promise<UserGroup[]> {
    const groups = (await invokeRenderer(IPCChannels.UserGroups.List, undefined)) as UserGroup[]
    return Array.isArray(groups) ? groups : []
  },
  async create(name: string, description?: string): Promise<UserGroup> {
    return (await invokeRenderer(IPCChannels.UserGroups.Create, { name, description })) as UserGroup
  },
  async update(id: number, patch: { name?: string; description?: string | null }): Promise<UserGroup> {
    return (await invokeRenderer(IPCChannels.UserGroups.Update, { id, ...patch })) as UserGroup
  },
  async remove(id: number): Promise<void> {
    await invokeRenderer(IPCChannels.UserGroups.Delete, id)
  },
  async listMembers(groupId: number): Promise<UserGroupMember[]> {
    const members = (await invokeRenderer(IPCChannels.UserGroups.ListMembers, groupId)) as UserGroupMember[]
    return Array.isArray(members) ? members : []
  },
  async addMember(groupId: number, userId: string): Promise<void> {
    await invokeRenderer(IPCChannels.UserGroups.AddMember, { groupId, userId })
  },
  async removeMember(groupId: number, userId: string): Promise<void> {
    await invokeRenderer(IPCChannels.UserGroups.RemoveMember, { groupId, userId })
  },
  async listPermissions(groupId: number): Promise<string[]> {
    const permissions = (await invokeRenderer(IPCChannels.UserGroups.ListPermissions, groupId)) as string[]
    return Array.isArray(permissions) ? permissions : []
  },
  async setPermissions(groupId: number, permissions: string[]): Promise<string[]> {
    const saved = (await invokeRenderer(IPCChannels.UserGroups.SetPermissions, { groupId, permissions })) as string[]
    return Array.isArray(saved) ? saved : []
  },
}
