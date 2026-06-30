import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appSrc = dirname(fileURLToPath(import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

/**
 * The whole point of the SDK boundary: product code is insulated from the
 * engine. If this ever fails, a feature leaked `@tiptap/*` into the app —
 * route it through `../editor` instead.
 */
describe('engine import boundary', () => {
  it('no file under the app imports @tiptap/* directly', () => {
    const offenders = sourceFiles(appSrc)
      .filter((file) => !file.endsWith('import-boundary.test.ts'))
      .filter((file) => /\bfrom\s+['"]@tiptap\//.test(readFileSync(file, 'utf8')))

    expect(offenders).toEqual([])
  })
})
