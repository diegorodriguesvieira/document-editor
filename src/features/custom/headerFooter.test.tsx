import { describe, expect, it } from 'vitest'
import type { CreatedEditor } from '../../editor'
import { renderEditor } from '../../test/editorHarness'
import { HeaderFooterFeature } from './headerFooter'

const newEditor = () => renderEditor([HeaderFooterFeature])
const content = (created: CreatedEditor) => created.api.getJSON().doc.content ?? []

describe('header/footer feature', () => {
  it('adds a header as the first node', () => {
    const created = newEditor()
    expect(created.api.hasNode('documentHeader')).toBe(false)
    expect(created.api.exec('header.add')).toBe(true)
    expect(created.api.hasNode('documentHeader')).toBe(true)
    expect(content(created)[0]?.type).toBe('documentHeader')
  })

  it('never adds a second header', () => {
    const created = newEditor()
    expect(created.api.exec('header.add')).toBe(true)
    expect(created.api.exec('header.add')).toBe(false)
  })

  it('adds a footer as the last node (no trailing paragraph after it)', () => {
    const created = newEditor()
    expect(created.api.exec('footer.add')).toBe(true)
    const c = content(created)
    expect(c[c.length - 1]?.type).toBe('documentFooter')
  })

  it('removes a region', () => {
    const created = newEditor()
    created.api.exec('header.add')
    expect(created.api.exec('header.remove')).toBe(true)
    expect(created.api.hasNode('documentHeader')).toBe(false)
  })

  it('serializes regions to data-* for the backend', () => {
    const created = newEditor()
    created.api.exec('header.add')
    created.api.exec('footer.add')
    const html = created.api.getHTML()
    expect(html).toContain('data-document-header')
    expect(html).toContain('data-document-footer')
  })

  it('normalizes a malformed load to one header (first) and one footer (last)', () => {
    const created = newEditor()
    const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const region = (type: string, text: string) => ({ type, content: [para(text)] })
    created.api.setJSON({
      doc: {
        type: 'doc',
        content: [
          region('documentHeader', 'H1'),
          para('body'),
          region('documentHeader', 'H2'), // duplicate header
          region('documentFooter', 'F'),
          para('after footer'), // content after the footer
        ],
      },
    })
    const c = content(created)
    expect(c.filter((n) => n.type === 'documentHeader')).toHaveLength(1)
    expect(c.filter((n) => n.type === 'documentFooter')).toHaveLength(1)
    expect(c[0]?.type).toBe('documentHeader')
    expect(c[c.length - 1]?.type).toBe('documentFooter')
  })

  it('exposes top/bottom page regions for the hover affordance', () => {
    expect(HeaderFooterFeature.pageRegions?.map((region) => [region.position, region.nodeName])).toEqual([
      ['top', 'documentHeader'],
      ['bottom', 'documentFooter'],
    ])
  })
})
