import { expect, test } from 'vitest'
import { sanitizeSvg } from './sanitizeSvg'

test('keeps shapes, turns colours into the pen colour, keeps "none", gives the viewBox', () => {
  const result = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48"><g fill="#123456"><path d="M1 1L5 5" stroke="red" fill="none" stroke-width="2"/><circle cx="3" cy="3" r="2"/></g></svg>')!
  expect(result.viewBox).toBe('0 0 24 24')
  expect(result.svg).toContain('<path d="M1 1L5 5" stroke="currentColor" fill="none" stroke-width="2"')
  expect(result.svg).toContain('<g fill="currentColor">')
  expect(result.svg).toContain('<circle cx="3" cy="3" r="2"')
  expect(result.svg).not.toContain('width="48"')
})

test('nothing hostile survives', () => {
  const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
    <script>alert(1)</script>
    <style>path { fill: url(https://evil.test/x) }</style>
    <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>
    <image href="https://evil.test/a.png" width="10" height="10"/>
    <use xlink:href="https://evil.test/b.svg#x"/>
    <a href="javascript:alert(1)"><rect width="1" height="1"/></a>
    <path d="M0 0L1 1" onclick="alert(1)" fill="url(#g)" style="stroke: url(https://evil.test); stroke-width: 3; behavior: x"/>
  </svg>`
  const result = sanitizeSvg(hostile)!
  for (const bad of ['script', 'alert', 'style', 'foreignObject', 'image', 'use', 'href', 'evil', 'url(', 'onclick', 'onload', 'behavior', '<a']) expect(result.svg).not.toContain(bad)
  expect(result.svg).toContain('<path d="M0 0L1 1" stroke-width="3"')
})

test('a viewBox from width and height; nothing drawable, no size, broken or too big gives null', () => {
  expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="4" height="4"/></svg>')!.viewBox).toBe('0 0 32 16')
  expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>x</script></svg>')).toBeNull()
  expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')).toBeNull()
  expect(sanitizeSvg('<svg><path d=')).toBeNull()
  expect(sanitizeSvg('<html><body/></html>')).toBeNull()
  expect(sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="${'M0 0'.repeat(30000)}"/></svg>`)).toBeNull()
})

test('the pen colour reaches shapes that rely on the root: no fill at all, fill on the root, outline icons', () => {
  const plain = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L24 24"/></svg>')!
  expect(plain.inner).toBe('<g fill="currentColor"><path d="M0 0L24 24"/></g>')
  const filled = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="bi"><path d="M0 0L16 16"/></svg>')!
  expect(filled.inner).toBe('<g fill="currentColor"><path d="M0 0L16 16"/></g>')
  const outline = sanitizeSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" style="stroke-linejoin: round"><path d="M0 0L24 24"/></svg>',
  )!
  expect(outline.inner).toBe('<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M0 0L24 24"/></g>')
  // Cleaning what was cleaned gives the same text, so a synced stamp file never changes by itself.
  for (const result of [plain, filled, outline]) expect(sanitizeSvg(result.svg)!.svg).toBe(result.svg)
})
