import { execSync } from 'node:child_process'
import type { StorybookConfig } from '@storybook/react-vite'

/**
 * WHICH BUILD AM I LOOKING AT? — computed here (this file runs in Node at
 * build time) and handed to the manager UI through `managerHead`, because the
 * manager bundle is not Vite's and never sees `import.meta.env`.
 *
 * Commit + build timestamp, plus a `+local` marker when the tree had
 * uncommitted changes: after a deploy the sidebar header answers "is this the
 * version I just pushed?" without digging through a CI log.
 */
function buildVersion(): string {
  // Short on purpose — the sidebar brand is ~180px wide: MM-DD HH:mm in UTC,
  // which is enough to tell two deploys of the same day apart.
  const stamp = new Date().toISOString().slice(5, 16).replace('T', ' ')
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim() ? '+local' : ''
    return `${sha}${dirty} · ${stamp}Z`
  } catch {
    return `${stamp}Z` // no git (a tarball, a CI checkout without history)
  }
}

const config: StorybookConfig = {
  // The stories are the SDK's customization CATALOG — one story per seam.
  stories: ['../src/stories/**/*.mdx', '../src/stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  managerHead: (head) =>
    `${head}\n<script>window.__EDITOR_BUILD__ = ${JSON.stringify(buildVersion())}</script>`,
}
export default config
