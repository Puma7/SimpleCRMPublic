import { parseExternalMailLink } from '../../shared/email-external-url'

describe('parseExternalMailLink', () => {
  it('accepts https and http', () => {
    expect(parseExternalMailLink('https://example.com/path')).toEqual({
      ok: true,
      url: 'https://example.com/path',
      display: 'https://example.com/path',
    })
    expect(parseExternalMailLink('http://a.de')).toMatchObject({ ok: true, url: 'http://a.de/' })
  })

  it('accepts mailto', () => {
    expect(parseExternalMailLink('mailto:support@example.com')).toMatchObject({
      ok: true,
      url: 'mailto:support@example.com',
    })
  })

  it('normalizes protocol-relative URLs', () => {
    expect(parseExternalMailLink('//cdn.example.com/x')).toMatchObject({
      ok: true,
      url: 'https://cdn.example.com/x',
    })
  })

  it('rejects javascript and relative paths', () => {
    expect(parseExternalMailLink('javascript:alert(1)')).toMatchObject({ ok: false })
    expect(parseExternalMailLink('/local/path')).toMatchObject({ ok: false })
    expect(parseExternalMailLink('')).toMatchObject({ ok: false })
  })
})
