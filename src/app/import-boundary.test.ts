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
// Static `import ... from`, dynamic `import(...)`, and `require(...)` of @tiptap.
const IMPORTS_TIPTAP =
  /(\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]@tiptap\//

describe('engine import boundary', () => {
  it('no file under the app OR the story catalog imports @tiptap/* directly (static or dynamic)', () => {
    // The stories are consumer-contract documentation — an engine leak there
    // teaches every reader the wrong import.
    const roots = [appSrc, join(appSrc, '..', 'stories')]
    const offenders = roots
      .flatMap((root) => sourceFiles(root))
      .filter((file) => !file.endsWith('import-boundary.test.ts'))
      .filter((file) => IMPORTS_TIPTAP.test(readFileSync(file, 'utf8')))

    expect(offenders).toEqual([])
  })

  it('no source file contains raw control bytes — a literalized escape turns the file BINARY for git/grep', () => {
    // A raw NUL inside a '\0' join separator shipped once: git diffed the
    // SDK's main hook as "Binary files differ" and binary-skipping greps
    // returned zero matches for THREE review rounds. Editors render the byte
    // invisibly, so only a scan catches the regression.
    const srcRoot = join(appSrc, '..')
    const CONTROL_BYTES = /[\x00-\x08\x0b\x0c\x0e-\x1f]/
    const offenders = sourceFiles(srcRoot).filter((file) =>
      CONTROL_BYTES.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
