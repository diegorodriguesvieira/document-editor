import type { Editor, JSONContent } from '@tiptap/core'

/** Bump when the persisted document shape changes; drives migrations later. */
export const SCHEMA_VERSION = 1

/**
 * Canonical, persistable document. We commit to ProseMirror JSON (versioned)
 * as the contract — this is the real insurance against a future engine swap:
 * portability of *data*, not of the engine.
 */
export interface DocumentJSON {
  schemaVersion: number
  doc: JSONContent
}

export function createEmptyDocument(): DocumentJSON {
  return {
    schemaVersion: SCHEMA_VERSION,
    doc: { type: 'doc', content: [{ type: 'paragraph' }] },
  }
}

export function toDocumentJSON(editor: Editor): DocumentJSON {
  return { schemaVersion: SCHEMA_VERSION, doc: editor.getJSON() }
}

/** Rendered HTML, suitable to cache for read-only display. */
export function exportHTML(editor: Editor): string {
  return editor.getHTML()
}

/** Upgrades a raw doc from one schema version to the next. */
export type DocumentMigration = (doc: JSONContent) => JSONContent

/**
 * Bring a (possibly older) document up to {@link SCHEMA_VERSION} before loading.
 * - A doc from a NEWER version is refused (throws) — loading it would silently
 *   drop the fields this build doesn't understand, then a save would persist the
 *   loss. Better to fail loudly than to corrupt the user's document.
 * - An older doc is upgraded by running each registered step in order;
 *   `migrations[n]` upgrades a v`n` doc to v`n+1` (features contribute their own).
 */
export function migrateDocument(
  input: DocumentJSON,
  migrations: Record<number, DocumentMigration[]> = {},
): DocumentJSON {
  let version = input.schemaVersion ?? 1
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Document schemaVersion ${version} is newer than the supported ${SCHEMA_VERSION}; refusing to load.`,
    )
  }
  let doc = input.doc
  while (version < SCHEMA_VERSION) {
    const steps = migrations[version]
    if (!steps || steps.length === 0) {
      throw new Error(`No migration registered from schemaVersion ${version} to ${version + 1}.`)
    }
    for (const step of steps) doc = step(doc)
    version += 1
  }
  return { schemaVersion: SCHEMA_VERSION, doc }
}
