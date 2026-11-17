import type { TemplateLayout } from '../storage/wiki'
import type { WikiProperty } from '../types'

export type PropertyRow = { kind: 'template'; key: string; property?: WikiProperty } | { kind: 'own'; property: WikiProperty }

export interface PropertySection {
  /** null: the fields outside any block, shown first. */
  name: string | null
  /** A starred block belongs to the folder template and shows in every entry of the folder. */
  starred: boolean
  rows: PropertyRow[]
}

/**
 * Arranges an entry's properties: fields outside blocks, then the folder's starred blocks, then
 * the entry's own blocks. In each, template fields come before the entry's own fields. A template
 * field shows the first property with its name; a name still being typed keeps its own row.
 */
export function layoutProperties(
  properties: WikiProperty[],
  ownBlocks: string[],
  layout: TemplateLayout,
  editingId: string | null = null,
): PropertySection[] {
  const owner = new Map<string, WikiProperty>()
  for (const property of properties) {
    const key = property.key.trim()
    if (layout.template.includes(key) && !owner.has(key) && property.id !== editingId) owner.set(key, property)
  }
  const shown = new Set([...owner.values()].map((property) => property.id))
  const own = properties.filter((property) => !shown.has(property.id))
  const starred = layout.blocks
  const extra = own.map((property) => property.group).filter((group): group is string => Boolean(group) && !starred.includes(group!))
  const blocks = [...new Set([...ownBlocks.filter((block) => !starred.includes(block)), ...extra])]

  const section = (name: string | null, isStarred: boolean): PropertySection => ({
    name,
    starred: isStarred,
    rows: [
      ...layout.template
        .filter((key) => (layout.groups[key] ?? null) === name && (name === null || isStarred))
        .map((key): PropertyRow => ({ kind: 'template', key, property: owner.get(key) })),
      ...own.filter((property) => (property.group ?? null) === name || (name === null && property.group && !starred.includes(property.group) && !blocks.includes(property.group))).map((property): PropertyRow => ({ kind: 'own', property })),
    ],
  })
  return [section(null, false), ...starred.map((name) => section(name, true)), ...blocks.map((name) => section(name, false))]
}

/** Moves an own property into a block (null: outside blocks), before another property or to the block's end. */
export function moveOwnProperty(properties: WikiProperty[], id: string, group: string | null, beforeId: string | null): WikiProperty[] {
  const moving = properties.find((property) => property.id === id)
  if (!moving) return properties
  const moved: WikiProperty = { ...moving }
  if (group) moved.group = group
  else delete moved.group
  const rest = properties.filter((property) => property.id !== id)
  let at = beforeId ? rest.findIndex((property) => property.id === beforeId) : -1
  if (at < 0) {
    // After the last property of that block, or at the very end.
    const last = rest.map((property) => property.group ?? null).lastIndexOf(group)
    at = last < 0 ? rest.length : last + 1
  }
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/** Moves a template field into a starred block (null: outside blocks), before another field or to the end. */
export function moveTemplateKey(layout: TemplateLayout, key: string, block: string | null, beforeKey: string | null): TemplateLayout {
  const template = layout.template.filter((item) => item !== key)
  let at = beforeKey ? template.indexOf(beforeKey) : -1
  if (at < 0) {
    const last = template.map((item): string | null => layout.groups[item] ?? null).lastIndexOf(block)
    at = last < 0 ? template.length : last + 1
  }
  template.splice(at, 0, key)
  const groups = { ...layout.groups }
  if (block) groups[key] = block
  else delete groups[key]
  return { ...layout, template, groups }
}

/** Moves one name in a list before another, or to the end. */
export function moveName(list: string[], name: string, beforeName: string | null): string[] {
  const rest = list.filter((item) => item !== name)
  const at = beforeName ? rest.indexOf(beforeName) : -1
  rest.splice(at < 0 ? rest.length : at, 0, name)
  return rest
}

/** A name for a new block that is not taken yet: "Neuer Block", "Neuer Block 2", … */
export function newBlockName(taken: string[]): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'Neuer Block' : `Neuer Block ${n}`
    if (!taken.includes(name)) return name
  }
}
