import {
  isDynamicImportLoadError,
  shouldReloadForStaleAsset,
} from '../../src/stale-asset-reload'

describe('stale asset reload helpers', () => {
  it('detects dynamic import chunk load failures', () => {
    expect(isDynamicImportLoadError('Failed to fetch dynamically imported module: app://-/assets/index-old.js')).toBe(true)
    expect(isDynamicImportLoadError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isDynamicImportLoadError({ message: 'Importing a module script failed.' })).toBe(true)
    expect(isDynamicImportLoadError('ordinary application error')).toBe(false)
  })

  it('limits reload attempts to avoid loops', () => {
    expect(shouldReloadForStaleAsset(60_000, null)).toBe(true)
    expect(shouldReloadForStaleAsset(60_000, '59000')).toBe(false)
    expect(shouldReloadForStaleAsset(60_000, '10000')).toBe(true)
    expect(shouldReloadForStaleAsset(60_000, 'not-a-number')).toBe(true)
  })
})
