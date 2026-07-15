import type { Meta, StoryObj } from '@storybook/react-vite'
import { BubbleToolbar, DocumentEditor } from '../editor'
import { ALL_FEATURES, Shell, STARTER_DOC } from './storyShell'

const meta = {
  title: 'Editor/5. Bubble toolbar',
  component: DocumentEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'The formatting toolbar is the selection BUBBLE — the product has no static bar. ' +
          '`renderBubble` swaps the surface: filter the bubble, or remove formatting UI entirely. ' +
          '**Select some text in each story to see it.**',
      },
    },
  },
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

export const FilteredBubble: Story = {
  name: 'Filtered bubble (no undo/redo)',
  render: () => (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        renderBubble={(ctx) => (
          <BubbleToolbar {...ctx} filter={(item) => item.group !== 'history'} />
        )}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Placement is a consumer decision via `filter` over the contributions — here the `history` ' +
          "group stays out of the bubble (undo/redo aren't selection-scoped; the keyboard covers them).",
      },
    },
  },
}

export const NoFormattingUI: Story = {
  name: 'No formatting UI at all',
  render: () => (
    <Shell>
      <DocumentEditor features={ALL_FEATURES} content={STARTER_DOC} renderBubble={() => null} />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`renderBubble={() => null}` — no bubble, no bar. Keyboard shortcuts still work ' +
          '(Mod-B, Mod-I, the `/` and `@` menus…).',
      },
    },
  },
}
