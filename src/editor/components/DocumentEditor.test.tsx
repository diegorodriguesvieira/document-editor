import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { DocumentEditor } from './DocumentEditor'
import type { EditorApi } from '../core/EditorApi'
import { BoldFeature } from '../../features'
import { docWith } from '../../test/editorHarness'

describe('<DocumentEditor /> empty state', () => {
  it('shows while the document is empty and disappears once there is content', async () => {
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[BoldFeature]}
        renderEmptyState={() => <div>Blank — start typing</div>}
        onReady={(ready) => {
          api = ready
        }}
      />,
    )

    expect(await screen.findByText('Blank — start typing')).toBeInTheDocument()

    act(() => {
      api!.setJSON(docWith('hello'))
    })
    await waitFor(() => {
      expect(screen.queryByText('Blank — start typing')).toBeNull()
    })
  })

  it('never shows when the editor starts with content', async () => {
    render(
      <DocumentEditor
        features={[BoldFeature]}
        content={docWith('already has text')}
        renderEmptyState={() => <div>Blank — start typing</div>}
      />,
    )

    await screen.findByText('already has text')
    expect(screen.queryByText('Blank — start typing')).toBeNull()
  })
})
