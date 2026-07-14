import fs from 'fs'
import path from 'path'
import { normalizeSettingsTab } from '../../src/components/email/workspace-context'

describe('email settings navigation', () => {
  it('does not expose the deprecated account details placeholder', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/components/email/settings-panels.tsx'),
      'utf8',
    )
    expect(source).not.toContain('id: "accountMail"')
    expect(source).not.toMatch(/tabIds:\s*\[[^\]]*"accountMail"/s)
  })

  it('keeps every visible settings tab restorable and migrates the legacy tab', () => {
    const visibleTabs = [
      'accounts', 'oauthApps', 'ai', 'knowledge', 'mailSecurity', 'automation',
      'team', 'appUsers', 'authSecurity', 'userGroups', 'canned', 'prompts',
      'export', 'diagnostics', 'pgp', 'auditLog', 'threadTools', 'snooze', 'misc',
    ] as const
    for (const tab of visibleTabs) {
      expect(normalizeSettingsTab(tab)).toBe(tab)
    }
    expect(normalizeSettingsTab('accountMail')).toBe('accounts')
  })
})
