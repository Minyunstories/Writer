import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// jsdom has no layout; CodeMirror only needs these to exist.
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
Range.prototype.getClientRects = emptyRects
Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
