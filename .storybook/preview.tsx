import type { Preview } from '@storybook/react-vite'

const preview: Preview = {
  parameters: {
    // The editor is a full-page surface (sticky header, fixed footer) — give
    // every story the whole canvas instead of a padded card.
    layout: 'fullscreen',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: 'todo' },
  },
}

export default preview
