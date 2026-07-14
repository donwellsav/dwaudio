import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('UI radius contract', () => {
  it('uses one 5px radius for rectangular surfaces', () => {
    const css = read('app/globals.css')
    const globalError = read('app/global-error.tsx')
    const faderTrack = read('components/analyzer/FaderTrack.tsx')

    expect(css).toContain('--radius: 5px;')
    for (const token of ['xs', 'sm', 'md', 'lg', 'xl']) {
      expect(css).toContain(`--radius-${token}: var(--radius);`)
    }
    expect(css).toMatch(/\.rounded\s*\{\s*border-radius: var\(--radius\);\s*\}/)
    expect(css).toMatch(/\.rounded-t\s*\{[\s\S]*?var\(--radius\)/)
    expect(css).not.toMatch(/border-radius: (?:4|6|8|10)px;/)
    expect(globalError).toContain('border-radius: 5px;')
    expect(faderTrack).not.toContain('rounded-[6px]')
    expect(faderTrack).not.toContain('rounded-t-[4px]')
  })
})
