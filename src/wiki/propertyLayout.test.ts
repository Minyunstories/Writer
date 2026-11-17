import { expect, test } from 'vitest'
import { layoutProperties, moveName, moveOwnProperty, moveTemplateKey, newBlockName } from './propertyLayout'

const p = (id: string, key: string, group?: string) => ({ id, key, value: '', ...(group ? { group } : {}) })

test('sections: outside blocks first, then starred blocks, then own blocks; template before own', () => {
  const properties = [p('1', 'Augenfarbe'), p('2', 'Größe', 'Aussehen'), p('3', 'Angeln', 'Hobbys'), p('4', 'Beruf'), p('5', 'Narbe', 'Merkmale')]
  const layout = { template: ['Alter', 'Augenfarbe'], blocks: ['Aussehen'], groups: { Augenfarbe: 'Aussehen' } }
  const sections = layoutProperties(properties, ['Hobbys'], layout)
  expect(sections.map((s) => [s.name, s.starred])).toEqual([[null, false], ['Aussehen', true], ['Hobbys', false], ['Merkmale', false]])
  const keys = (i: number) => sections[i].rows.map((r) => (r.kind === 'template' ? `★${r.key}` : r.property.key))
  expect(keys(0)).toEqual(['★Alter', 'Beruf'])
  expect(keys(1)).toEqual(['★Augenfarbe', 'Größe'])
  expect(keys(2)).toEqual(['Angeln'])
  expect(keys(3)).toEqual(['Narbe'])
  const eye = sections[1].rows[0]
  expect(eye.kind === 'template' && eye.property?.id).toBe('1')
})

test('moving own properties and template fields between blocks', () => {
  const properties = [p('1', 'A'), p('2', 'B', 'X'), p('3', 'C', 'X'), p('4', 'D')]
  expect(moveOwnProperty(properties, '4', 'X', '3').map((x) => `${x.key}${x.group ?? ''}`)).toEqual(['A', 'BX', 'DX', 'CX'])
  expect(moveOwnProperty(properties, '1', 'X', null).map((x) => `${x.key}${x.group ?? ''}`)).toEqual(['BX', 'CX', 'AX', 'D'])
  expect(moveOwnProperty(properties, '2', null, '1').map((x) => `${x.key}${x.group ?? ''}`)).toEqual(['B', 'A', 'CX', 'D'])
  const layout = { template: ['A', 'B', 'C'], blocks: ['X'], groups: { B: 'X' } }
  expect(moveTemplateKey(layout, 'C', 'X', null)).toEqual({ template: ['A', 'B', 'C'], blocks: ['X'], groups: { B: 'X', C: 'X' } })
  expect(moveTemplateKey(layout, 'B', null, 'A')).toEqual({ template: ['B', 'A', 'C'], blocks: ['X'], groups: {} })
  expect(moveName(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  expect(newBlockName(['Neuer Block'])).toBe('Neuer Block 2')
})
