import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  // The stories are the SDK's customization CATALOG — one story per seam.
  stories: ['../src/stories/**/*.mdx', '../src/stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
}
export default config
