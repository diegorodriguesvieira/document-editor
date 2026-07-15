import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { createEditorTheme, DocumentEditor } from '../editor'
import { ALL_FEATURES, Shell, STARTER_DOC } from './storyShell'

const meta = {
  title: 'Editor/8. Theming',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Theming is a DUAL contract. The `--editor-*` tokens (declared at zero specificity — ' +
          'any consumer override wins) own the document CONTENT skin and layout metrics, and stay ' +
          'a live color channel into the MUI chrome. The MUI theme (`muiTheme` prop, built with ' +
          '`createEditorTheme(overrides)`) is the full-fidelity path for the chrome itself — ' +
          'menus, popovers, buttons, forms. Placement rule for tokens: `:root` covers the ' +
          'body-portaled popups too; a wrapper element only reaches the in-page surface.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

/** Layout metrics — in-page surfaces only, safe on a wrapper. */
const LAYOUT_TOKENS = {
  '--editor-header-height': '56px',
  '--editor-page-width': '680px',
  '--editor-dock-height': '56px',
} as CSSProperties

/** Brand colors — declared at :root so the PORTALED popups pick them up too. */
const ROOT_TOKENS = `
  :root {
    --editor-accent: #7c3aed;
    --editor-accent-ink: #6d28d9;
    --editor-accent-bg: #ede9fe;
    --editor-menu-active-bg: #f5f3ff;
    --editor-inverse-accent: #c4b5fd;
    --editor-variable-bg: #f3e8ff;
    --editor-variable-border: #ddd6fe;
    --editor-variable-fg: #6d28d9;
  }
`

export const BrandTokens: Story = {
  name: 'Brand tokens (purple, narrower page, slimmer bars)',
  render: () => (
    <Shell style={LAYOUT_TOKENS}>
      <style>{ROOT_TOKENS}</style>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        // The MUI theme literals mirror the token DEFAULTS — when a brand
        // recolors the tokens, pass matching palette overrides so
        // MUI-internal derivations (focus rings, selected states) follow.
        muiTheme={createEditorTheme({ palette: { primary: { main: '#7c3aed' } } })}
        renderHeader={() => <strong>Purple brand — same SDK, only tokens changed</strong>}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The dual contract in action: three layout metrics on the wrapper (56px bars, a 680px ' +
          'measure), eight brand colors at `:root` — the `/` and `@` menus, color picker and ' +
          'variables panel (all portaled to `<body>`) go purple too — plus a `muiTheme` with the ' +
          'matching `primary` so MUI-internal color math follows the brand. No SDK CSS was touched.',
      },
    },
  },
}
