import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createMockEditor } from '../core/createMockEditor'
import { PageAffordances } from './PageAffordances'
import type { PageRegion } from '../core/types'

const REGIONS: PageRegion[] = [
  {
    id: 'header',
    position: 'top',
    label: 'Add header',
    addCommandId: 'header.add',
    nodeName: 'documentHeader',
  },
  {
    id: 'footer',
    position: 'bottom',
    label: 'Add footer',
    addCommandId: 'footer.add',
    nodeName: 'documentFooter',
  },
]

describe('<PageAffordances />', () => {
  it('shows the affordance for an absent region and runs its add command', async () => {
    const user = userEvent.setup()
    const mock = createMockEditor()
    render(<PageAffordances api={mock.api} regions={REGIONS} position="top" />)

    await user.click(screen.getByRole('button', { name: /Add header/ }))
    expect(mock.execCalls.map((call) => call.commandId)).toContain('header.add')
  })

  it('hides the affordance when the region already exists', () => {
    const mock = createMockEditor({
      doc: { schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'documentHeader' }] } },
    })
    render(<PageAffordances api={mock.api} regions={REGIONS} position="top" />)
    expect(screen.queryByRole('button', { name: /Add header/ })).toBeNull()
  })

  it('only renders regions for its own position', () => {
    const mock = createMockEditor()
    render(<PageAffordances api={mock.api} regions={REGIONS} position="bottom" />)
    expect(screen.getByRole('button', { name: /Add footer/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add header/ })).toBeNull()
  })
})
