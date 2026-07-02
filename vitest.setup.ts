import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount React trees and clear the DOM between tests.
afterEach(() => {
  cleanup()
})

// jsdom has no layout: ProseMirror's scrollIntoView → coordsAtPos needs client
// rects on ranges. Stub them once here so no test file re-invents this.
Range.prototype.getBoundingClientRect = () =>
  ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect
Range.prototype.getClientRects = () => {
  const rects = [] as unknown as DOMRectList
  ;(rects as unknown as { item: (i: number) => null }).item = () => null
  return rects
}
