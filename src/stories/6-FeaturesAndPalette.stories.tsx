import type { Meta, StoryObj } from '@storybook/react-vite'
import { DocumentEditor } from '../editor'
import {
  BoldFeature,
  createColorFeature,
  HeadingFeature,
  HistoryFeature,
  ItalicFeature,
} from '../features'
import { BASIC_DOC, Shell } from './storyShell'

const meta = {
  title: 'Editor/6. Feature options',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Configurable features ship as FACTORIES with a zero-config default. Options are ' +
          'composition-time config: pick them when you build the `features` array.',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

const BRAND_PALETTE = ['#0a2540', '#635bff', '#00d4ff', '#e11d48', '#f59e0b']

export const CustomColorPalette: Story = {
  name: 'Custom color palette',
  render: () => (
    <Shell>
      <DocumentEditor
        features={[
          HistoryFeature,
          BoldFeature,
          ItalicFeature,
          HeadingFeature,
          createColorFeature({ palette: BRAND_PALETTE }),
        ]}
        content={BASIC_DOC}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`createColorFeature({ palette: [...] })` — your brand swatches in the picker (select text ' +
          '→ bubble → color swatch). The "Default" reset and the native "+" custom picker are always ' +
          'present alongside whatever palette you pass.',
      },
    },
  },
}
