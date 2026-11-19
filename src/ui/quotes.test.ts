import { expect, test } from 'vitest'

// Every source file as text (Vite's glob import), tests left out: they quote what the app shows.
const sources = import.meta.glob(['../**/*.{ts,tsx,css}', '!../**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

test('German quotes in the interface close with “, never with a straight "', () => {
  expect(Object.keys(sources).length).toBeGreaterThan(50)
  const straight: string[] = []
  for (const [path, text] of Object.entries(sources)) {
    text.split('\n').forEach((line, index) => {
      if (/„[^"“\n]*"/.test(line)) straight.push(`${path.replace('../', 'src/')}:${index + 1}`)
    })
  }
  expect(straight).toEqual([])
})
