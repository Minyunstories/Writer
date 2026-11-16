import { render, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import { MarkdownField } from './MarkdownField'

test('notes show ==highlights== like the chapter text', async () => {
  render(<MarkdownField value="Ein ==wichtiger== Satz." onChange={() => {}} ariaLabel="Notizen" />)
  await waitFor(() => expect(document.querySelector('.cm-mw-highlight')?.textContent).toBe('==wichtiger=='))
})
