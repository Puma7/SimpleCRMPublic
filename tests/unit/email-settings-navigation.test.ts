import { normalizeSettingsTab } from '../../src/components/email/workspace-context'

describe('email settings navigation', () => {
  it('does not restore the server-only tracking tab in standalone mode', () => {
    expect(normalizeSettingsTab('tracking', false)).toBeNull()
    expect(normalizeSettingsTab('tracking', true)).toBe('tracking')
  })
})
