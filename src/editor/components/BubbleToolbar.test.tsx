import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BubbleToolbar } from './BubbleToolbar'
import { defineFeature } from '../core/defineFeature'
import { renderEditor } from '../../test/editorHarness'

const bold = defineFeature({
  id: 'bold',
  extensions: () => [],
  commands: { 'bold.toggle': () => true },
  toolbar: [{ id: 'bold', group: 'marks', label: 'Bold', commandId: 'bold.toggle' }],
})

describe('<BubbleToolbar />', () => {
  it('renders nothing when there is no editor', () => {
    const { api, resolved } = renderEditor([bold])
    const { container } = render(<BubbleToolbar editor={null} api={api} resolved={resolved} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mounts against a real editor without throwing', () => {
    const { editor, api, resolved } = renderEditor([bold])
    expect(() =>
      render(<BubbleToolbar editor={editor} api={api} resolved={resolved} />),
    ).not.toThrow()
  })
})
