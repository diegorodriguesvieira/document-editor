import type { Meta, StoryObj } from '@storybook/react-vite'
import { DocumentEditor, InsertToolbar, useZoom } from '../editor'
import { ALL_FEATURES, Shell, STARTER_DOC } from './storyShell'


const meta = {
  title: 'Editor/7. Empty state & zoom',
  component: DocumentEditor,
  tags: ['autodocs'],
} satisfies Meta<typeof DocumentEditor>

export default meta
type Story = StoryObj

export const CustomEmptyState: Story = {
  name: 'Custom empty state (with a template CTA)',
  render: () => (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        renderEmptyState={(ctx) => (
          <div style={{ textAlign: 'center', color: '#80868b' }}>
            <div style={{ fontSize: 40 }}>📄</div>
            <div style={{ fontWeight: 600, color: '#444746' }}>Blank document</div>
            <div style={{ fontSize: 13 }}>Start typing, or load a starter:</div>
            <button
              type="button"
              style={{
                marginTop: 8,
                padding: '8px 16px',
                border: 'none',
                borderRadius: 8,
                background: '#1b1b1b',
                color: '#fff',
                cursor: 'pointer',
              }}
              onClick={() => ctx.api.setJSON(STARTER_DOC)}
            >
              Start from a template
            </button>
          </div>
        )}
      />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          '`renderEmptyState` shows screen-centered while the document is BLANK (one empty paragraph — ' +
          'structure without text, like a fresh table, already dismisses it) and never steals clicks. ' +
          'The CTA loads content through `ctx.api.setJSON`.',
      },
    },
  },
}

function ZoomStory() {
  const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = useZoom()
  return (
    <Shell>
      <DocumentEditor
        features={ALL_FEATURES}
        content={STARTER_DOC}
        zoom={zoom}
        renderFooter={(ctx) => (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
            }}
          >
            <div style={{ justifySelf: 'start', display: 'flex', alignItems: 'center', gap: 4 }}>
              <button type="button" onClick={zoomOut} disabled={!canZoomOut}>−</button>
              <span style={{ minWidth: 40, textAlign: 'center', fontSize: 12 }}>
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" onClick={zoomIn} disabled={!canZoomIn}>+</button>
            </div>
            <InsertToolbar {...ctx} className="sb-zoom-actions" />
            <style>{`.sb-zoom-actions { height: 100%; display: flex; align-items: center; gap: 4px; }`}</style>
            <span />
          </div>
        )}
      />
    </Shell>
  )
}

export const Zoom: Story = {
  name: 'Zoom (useZoom + the zoom prop)',
  render: () => <ZoomStory />,
  parameters: {
    docs: {
      description: {
        story:
          'The SDK owns the scaling mechanics; you own a number. `useZoom()` ships the state and ' +
          'policy (clamp 0.5–2, step 0.1, float-safe) — wire its handlers to any buttons and pass ' +
          '`zoom` to the editor. Past 100% the page scrolls inside its column; chrome stays put.',
      },
    },
  },
}
