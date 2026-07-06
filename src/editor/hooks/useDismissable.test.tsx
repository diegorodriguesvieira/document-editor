import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useDismissable } from './useDismissable'

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
