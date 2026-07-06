import type { CSSProperties } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { DocumentEditor } from '../editor'
import { ALL_FEATURES, Shell, STARTER_DOC } from './storyShell'


const meta = {
  title: 'Editor/8. Theming',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The whole skin reads `--editor-*` custom properties, declared by the SDK at ZERO ' +
          'specificity (`:where(:root)`) — any consumer override wins, from `:root` or from a ' +
          'wrapper element. See THEMING.md for the full token contract.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

const BRAND_TOKENS = {
  '--editor-accent': '#7c3aed',
  '--editor-accent-ink': '#6d28d9',
  '--editor-accent-bg': '#ede9fe',
  '--editor-menu-active-bg': '#f5f3ff',
  '--editor-inverse-accent': '#c4b5fd',
  '--editor-mergefield-bg': '#f3e8ff',
  '--editor-mergefield-border': '#ddd6fe',
  '--editor-mergefield-fg': '#6d28d9',
  '--editor-header-height': '56px',
  '--editor-page-width': '680px',
  '--editor-dock-height': '56px',
} as CSSProperties

export const BrandTokens: Story = {
  name: 'Brand tokens (purple, narrower page, slimmer bars)',
  render: () => (
    <Shell style={BRAND_TOKENS}>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        renderHeader={() => <strong>Purple brand — same SDK, only tokens changed</strong>}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Nine token overrides on a wrapper element: accent set, a 56px header, a 680px text ' +
          'measure and a slimmer footer. No SDK CSS was touched — custom properties inherit down, ' +
          'and the shells/clearances derive from the same tokens.',
      },
    },
  },
}
