import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
const EXPECTED_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
]
const EXPECTED_STATIC_HEADERS = `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: microphone=(self), camera=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: ${CONTENT_SECURITY_POLICY}
`
const originalStaticExport = process.env.DWA_STATIC_EXPORT
let configImport = 0

interface NextConfigContract {
  output?: string
  headers?: () => Promise<Array<{
    source: string
    headers: Array<{ key: string; value: string }>
  }>>
}

async function loadNextConfig(staticExport: boolean): Promise<NextConfigContract> {
  if (staticExport) process.env.DWA_STATIC_EXPORT = '1'
  else delete process.env.DWA_STATIC_EXPORT

  const configUrl = pathToFileURL(new URL('../next.config.mjs', import.meta.url).pathname)
  const importedConfig = await import(`${configUrl.href}?contract=${configImport++}`)
  return importedConfig.default as NextConfigContract
}

afterAll(() => {
  if (originalStaticExport === undefined) delete process.env.DWA_STATIC_EXPORT
  else process.env.DWA_STATIC_EXPORT = originalStaticExport
})

describe('security header hosting contract', () => {
  it('serves the exact local-only policy from non-static Next builds', async () => {
    const config = await loadNextConfig(false)

    await expect(config.headers?.()).resolves.toEqual([
      { source: '/(.*)', headers: EXPECTED_SECURITY_HEADERS },
    ])
  })

  it('ships the exact literal local-only policy for static hosting', async () => {
    const config = await loadNextConfig(true)
    const headersUrl = new URL('../public/_headers', import.meta.url)

    expect(config.output).toBe('export')
    expect(config.headers).toBeUndefined()
    expect(existsSync(headersUrl), 'public/_headers must be copied by static export').toBe(true)
    expect(readFileSync(headersUrl, 'utf8')).toBe(EXPECTED_STATIC_HEADERS)
  })

  it('uses the existing DMG local-server CSP verbatim', () => {
    const dmgSource = readFileSync(new URL('../scripts/build-dmg.mjs', import.meta.url), 'utf8')
    const dmgPolicy = dmgSource.match(/"Content-Security-Policy: ([^"]+)"/)?.[1]

    expect(dmgPolicy).toBe(CONTENT_SECURITY_POLICY)
  })
})
