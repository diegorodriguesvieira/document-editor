import { addons } from 'storybook/manager-api'
import { create } from 'storybook/theming/create'

/** Injected by `managerHead` (see main.ts) — commit + build time. Absent only
 *  if that script failed to run, in which case say so rather than lie. */
const version = (window as { __EDITOR_BUILD__?: string }).__EDITOR_BUILD__ ?? 'unknown build'

addons.setConfig({
  theme: create({
    // Match Storybook's own default so the brand stamp is the ONLY change —
    // creating a theme replaces the whole thing, and the first cut of this
    // silently flipped the manager from dark to light.
    base: 'dark',
    // The sidebar header doubles as the build stamp: after a deploy you can
    // tell at a glance whether you are looking at what you just pushed.
    brandTitle:
      `<span style="display:flex;flex-direction:column;line-height:1.25">` +
      `<span style="font-weight:700">Document Editor</span>` +
      `<span style="font:400 10px/1.5 ui-monospace,monospace;opacity:.55">${version}</span>` +
      `</span>`,
    brandUrl: undefined,
    brandTarget: '_self',
  }),
})
