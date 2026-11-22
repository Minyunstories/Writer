import { describe, expect, it } from 'vitest'
import html from '../index.html?raw'

describe('index.html', () => {
  it('asks search engines not to index or follow the app', () => {
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow" \/>/)
  })
})
