import type { Meta, StoryObj } from '@storybook/react-vite'
import { DocumentEditor } from '../editor'
import {
  BoldFeature,
  HeadingFeature,
  HistoryFeature,
  ItalicFeature,
} from '../features'
import { ALL_FEATURES, BASIC_DOC, Shell, STARTER_DOC } from './storyShell'

const meta = {
  title: 'Editor/1. Default',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'What you get with ZERO configuration: a sticky **header** bar (empty — fill it via `renderHeader`), ' +
          'the **footer** bar carrying the insert actions, the **bubble toolbar** on text selection, ' +
          'the `/` block menu and the `@` variables menu. Every surface below has its own customization story.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

export const ZeroConfig: Story = {
  name: 'Zero config (all features)',
  render: () => (
    <Shell>
      <DocumentEditor features={ALL_FEATURES} content={STARTER_DOC} />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`<DocumentEditor features={ALL_FEATURES} />` — header, footer with actions, bubble on selection. ' +
          'Type `/` for blocks, `@` for variables; select text for the bubble.',
      },
    },
  },
}

export const MinimalFeatureSet: Story = {
  name: 'Minimal feature set (opt-in)',
  render: () => (
    <Shell>
      {/* BASIC_DOC: no custom nodes — content whose feature is disabled
          would THROW (the SDK never silently wipes a document). */}
      <DocumentEditor
        features={[HistoryFeature, BoldFeature, ItalicFeature, HeadingFeature]}
        content={BASIC_DOC}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Features are opt-in: with only bold/italic/headings/history there are NO insert actions, so the ' +
          'footer does not render at all — surfaces exist only when a feature contributes to them.',
      },
    },
  },
}
