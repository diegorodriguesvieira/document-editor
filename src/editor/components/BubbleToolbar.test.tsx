import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BubbleToolbar } from './BubbleToolbar'
import { createEditor, type CreatedEditor } from '../core/createEditor'
import { defineFeature } from '../core/defineFeature'

let created: CreatedEditor | undefined

afterEach(() => {
  created?.editor.destroy()
  created = undefined
})

function mountTarget() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

const bold = defineFeature({
  id: 'bold',
  extensions: () => [],
  commands: { 'bold.toggle': () => true },
  toolbar: [{ id: 'bold', group: 'marks', label: 'Bold', commandId: 'bold.toggle' }],
})

describe('<BubbleToolbar />', () => {
  it('renders nothing when there is no editor', () => {
    created = createEditor({ features: [bold], element: mountTarget() })
    const { container } = render(
      <BubbleToolbar editor={null} api={created.api} resolved={created.resolved} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('mounts against a real editor without throwing', () => {
    created = createEditor({ features: [bold], element: mountTarget() })
    expect(() =>
      render(<BubbleToolbar editor={created!.editor} api={created!.api} resolved={created!.resolved} />),
    ).not.toThrow()
  })
})
