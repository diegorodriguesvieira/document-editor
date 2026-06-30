import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createMockEditor } from '../core/createMockEditor'
import { defineFeature } from '../core/defineFeature'
import { InsertToolbar } from './InsertToolbar'
import { resolveFeatures } from '../core/registry'

const tableish = defineFeature({
  id: 'table',
  extensions: () => [],
  commands: { 'table.insert': () => true },
  insert: [{ id: 'table', label: 'Table', icon: 'T', commandId: 'table.insert' }],
})

const quoteish = defineFeature({
  id: 'quote',
  extensions: () => [],
  commands: { 'quote.toggle': () => true },
  insert: [
    {
      id: 'quote',
      label: 'Quote',
      icon: 'Q',
      commandId: 'quote.toggle',
      isActive: (state) => state.isActive('blockquote'),
    },
  ],
})

describe('<InsertToolbar />', () => {
  it('renders the opted-in inserts as a vertical toolbar — no real editor', () => {
    const mock = createMockEditor()
    render(
      <InsertToolbar editor={null} api={mock.api} resolved={resolveFeatures([tableish, quoteish])} />,
    )

    const bar = screen.getByRole('toolbar', { name: 'Insert' })
    expect(bar).toHaveAttribute('aria-orientation', 'vertical')
    expect(screen.getByRole('button', { name: 'Table' })).toHaveTextContent('T')
    expect(screen.getByRole('button', { name: 'Quote' })).toBeInTheDocument()
  })

  it('dispatches the insert command via api.exec on click', async () => {
    const mock = createMockEditor()
    render(<InsertToolbar editor={null} api={mock.api} resolved={resolveFeatures([tableish])} />)

    await userEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(mock.execCalls).toEqual([{ commandId: 'table.insert', payload: undefined }])
  })

  it('reflects active state reactively (e.g. inside a blockquote)', () => {
    const mock = createMockEditor()
    render(<InsertToolbar editor={null} api={mock.api} resolved={resolveFeatures([quoteish])} />)

    expect(screen.getByRole('button', { name: 'Quote' })).toHaveAttribute('aria-pressed', 'false')
    act(() => {
      mock.setActive(['blockquote'])
    })
    expect(screen.getByRole('button', { name: 'Quote' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('filters which inserts are shown', () => {
    const mock = createMockEditor()
    render(
      <InsertToolbar
        editor={null}
        api={mock.api}
        resolved={resolveFeatures([tableish, quoteish])}
        filter={(item) => item.id !== 'quote'}
      />,
    )
    expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quote' })).toBeNull()
  })

  it('renders nothing when there are no inserts and no children', () => {
    const mock = createMockEditor()
    const { container } = render(
      <InsertToolbar editor={null} api={mock.api} resolved={resolveFeatures([])} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
