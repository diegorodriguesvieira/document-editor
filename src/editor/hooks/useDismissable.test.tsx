import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDismissable, useEscapeSurface } from './useDismissable'

function Surface({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismissable(ref, onClose)
  return <div ref={ref}>surface</div>
}

describe('useDismissable — the Escape stack', () => {
  it('Escape closes only the TOP surface (innermost-first), then the one below', () => {
    const bottom = vi.fn()
    const top = vi.fn()
    render(<Surface onClose={bottom} />)
    const topSurface = render(<Surface onClose={top} />) // enabled later → top of the stack

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(top).toHaveBeenCalledTimes(1)
    expect(bottom).not.toHaveBeenCalled() // the press was consumed by the top

    // The closed surface unmounts (pops off the stack) — the next press
    // reaches the surface underneath.
    topSurface.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(bottom).toHaveBeenCalledTimes(1)
    expect(top).toHaveBeenCalledTimes(1)
  })
})

function TwoRefSurface({
  onClose,
  closeOnScroll = false,
}: {
  onClose: () => void
  closeOnScroll?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  useDismissable([panel, toggle], onClose, { closeOnScroll })
  return (
    <>
      <div ref={panel}>panel</div>
      <button ref={toggle}>toggle</button>
    </>
  )
}

describe('useDismissable — inside refs and anchored-surface options', () => {
  it('every ref in the array counts as INSIDE — the toggle button must not insta-close', () => {
    const onClose = vi.fn()
    const { getByText } = render(<TwoRefSurface onClose={onClose} />)

    fireEvent.mouseDown(getByText('panel'))
    fireEvent.mouseDown(getByText('toggle'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closeOnScroll closes on scroll AND resize — and only when opted in', () => {
    // Surfaces anchored to fixed page coordinates (color popover, context
    // menu) drift on scroll — they opt into closing instead.
    const anchored = vi.fn()
    render(<TwoRefSurface onClose={anchored} closeOnScroll />)
    fireEvent.scroll(document)
    expect(anchored).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('resize'))
    expect(anchored).toHaveBeenCalledTimes(2)

    const still = vi.fn()
    render(<TwoRefSurface onClose={still} />)
    fireEvent.scroll(document)
    window.dispatchEvent(new Event('resize'))
    expect(still).not.toHaveBeenCalled()
  })
})

function MuiLikeSurface({ open }: { open: boolean }) {
  useEscapeSurface(open)
  return null
}

describe('useEscapeSurface — MUI-owned surfaces join the stack', () => {
  it('while enabled, older useDismissable surfaces YIELD the Escape press', () => {
    const older = vi.fn()
    render(<Surface onClose={older} />)
    const mui = render(<MuiLikeSurface open />) // newer, Escape owned elsewhere

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(older).not.toHaveBeenCalled() // the marker topped the stack

    // The MUI surface closed (unmounts/disables) → the press reaches the owner.
    mui.rerender(<MuiLikeSurface open={false} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(older).toHaveBeenCalledTimes(1)
  })
})
