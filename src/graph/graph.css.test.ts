import { expect, test } from 'vitest'
import css from './graph.css?raw'

// jsdom does no layout, so the sizes that keep the page usable on a phone are checked here.
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('}', start))
}

test('the canvas row is never smaller than the canvas, so the list below cannot slide under it', () => {
  const rows = /grid-template-rows:\s*auto\s+minmax\((\d+px),\s*1fr\)\s+auto\s+auto/.exec(rule('.relation-graph'))
  const canvas = /min-height:\s*(\d+px)/.exec(rule('.relation-graph-canvas'))
  expect(rows?.[1]).toBeDefined()
  expect(rows?.[1]).toBe(canvas?.[1])
})

test('when the network does not fit (phone), the page scrolls instead of cutting it off', () => {
  const page = rule('.book-scroll.graph-mode')
  expect(page).not.toMatch(/overflow(-y)?:\s*hidden/)
  expect(page).toMatch(/overflow-y:\s*auto/)
})
