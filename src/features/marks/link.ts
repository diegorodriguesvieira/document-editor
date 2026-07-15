import { Link } from '@tiptap/extension-link'
import { defineFeature } from '../../editor'
import { icons } from '../icons'
import { renderLinkInsertControl } from '../promptForms'
import { LinkInsertBridgeExtension, linkInsertBridge } from './linkInsertBridge'

/** Link mark. Links are created through the insert-dock form (`link.insert`).
 *
 *  Contributes — insert: "Link" (URL form) · commands:
 *  `link.insert`/`link.openInsert` · keymap: Mod-k. */
export const LinkFeature = defineFeature({
  id: 'link',
  // `inclusive: () => false` so typing right after ANY link doesn't extend it
  // (TipTap couples inclusive to `autolink`, which defaults to on).
  // LinkInsertBridgeExtension is the keyboard→popover bridge for `link.openInsert`.
  extensions: () => [
    Link.extend({ inclusive: () => false }).configure({ openOnClick: false }),
    LinkInsertBridgeExtension,
  ],
  commands: {
    // Insert a new linked run at the cursor. The insert-dock form always
    // supplies both fields (that's the only way to reach this); bail if either
    // is missing rather than inventing a prompt fallback.
    'link.insert': (editor, payload) => {
      const { text, href } = (payload ?? {}) as { text?: string; href?: string }
      if (!text || !href) return false
      // insertContent applies mark attrs UNCHECKED — route the href through the
      // Link extension's isAllowedUri gate (via `can().setLink`), or a
      // `javascript:` URL would persist in the document JSON.
      if (!editor.can().setLink({ href })) return false
      return editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
        .run()
    },
    // Mod-k opens the SAME insert-link form as the dock's Link button. UI-only:
    // it drives the mounted LinkInsertControl through the bridge, so it no-ops
    // (returns false → key left unhandled) when no insert dock is rendered.
    'link.openInsert': (editor) => {
      const { open } = linkInsertBridge(editor)
      if (!open) return false
      open()
      return true
    },
  },
  // No bubble-bar contribution: linking lives in the insert dock (`link.insert`).
  // Mod-k opens that same insert form via `link.openInsert`.
  keymap: { 'Mod-k': 'link.openInsert' },
  insert: [
    {
      id: 'link',
      label: 'Link',
      icon: icons.link,
      commandId: 'link.insert',
      // Text + URL form → exec('link.insert', { text, href }).
      render: renderLinkInsertControl,
      // No isActive here: the dock button has no pressed SKIN — announcing
      // aria-pressed with zero visual state is the "stuck toggle" RegistryBar
      // warns about.
    },
  ],
})
