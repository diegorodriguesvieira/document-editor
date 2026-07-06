import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { DocumentEditor } from './DocumentEditor'
import { createEmptyDocument } from '../core/document'
import type { EditorApi } from '../core/EditorApi'
import { BoldFeature, TableFeature } from '../../features'
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

  it('disappears for content WITHOUT text too — inserting a table dismisses it', async () => {
    let api: EditorApi | null = null
    render(
      <DocumentEditor
        features={[TableFeature]}
        renderEmptyState={() => <div>Blank — start typing</div>}
        onReady={(ready) => {
          api = ready
        }}
      />,
    )
    expect(await screen.findByText('Blank — start typing')).toBeInTheDocument()

    act(() => {
      api!.exec('table.insert') // 3×3 of EMPTY cells — not a single character
    })

    // The doc has no text at all, but it is no longer blank: overlay gone.
    // (TipTap's editor.isEmpty would still say true here — the regression this
    // test pins.)
    await waitFor(() => {
      expect(screen.queryByText('Blank — start typing')).toBeNull()
    })

    // And wiping back to the blank slate brings it back.
    act(() => {
      api!.setJSON(createEmptyDocument())
    })
    expect(await screen.findByText('Blank — start typing')).toBeInTheDocument()
  })
})
