import type { EditorState } from '@codemirror/state'
import type { Tooltip, TooltipView } from '@codemirror/view'
import type { TemplateLayout } from '../storage/wiki'
import type { WikiEntry, WikiFolder, WikiImage } from '../types'
import type { LinkMatch, Matcher } from './linker'
import { topFolderOf } from './mentions'
import { layoutProperties } from './propertyLayout'

/** Shown on the card: at most this many properties. */
const SHOWN = 3

/**
 * The linked name at a position, as CodeMirror's hover reports it: `side` -1 means the pointer
 * is just before `pos`, 1 just after. Null between names.
 */
export function linkAt(matcher: Matcher, state: EditorState, pos: number, side: -1 | 1): LinkMatch | null {
  const line = state.doc.lineAt(pos)
  for (const match of matcher.find(line.text, line.from)) {
    if (pos < match.from || pos > match.to) continue
    if ((pos === match.from && side < 0) || (pos === match.to && side > 0)) continue
    return match
  }
  return null
}

export interface PreviewData {
  name: string
  aliases: string[]
  properties: { key: string; value: string }[]
}

/** Name, "also known as" and the first three filled-in properties, in the order the entry shows them. */
export function previewData(entry: WikiEntry, folders: WikiFolder[]): PreviewData {
  const top = topFolderOf(entry.folderId, folders)
  const layout: TemplateLayout = top
    ? { template: top.template ?? [], blocks: top.templateBlocks ?? [], groups: top.templateGroups ?? {} }
    : { template: [], blocks: [], groups: {} }
  const properties: PreviewData['properties'] = []
  for (const section of layoutProperties(entry.properties, entry.blocks ?? [], layout)) {
    for (const row of section.rows) {
      const property = row.property
      const value = property?.value.replace(/\[\[|\]\]/g, '').trim()
      if (!property || !value) continue
      properties.push({ key: row.kind === 'template' ? row.key : property.key.trim(), value })
    }
  }
  return { name: entry.name, aliases: entry.aliases, properties: properties.slice(0, SHOWN) }
}

/** The card itself: portrait on the left, name, aliases and properties on the right. */
export function previewCard(data: PreviewData, portrait: Pick<WikiImage, 'data' | 'type'> | null): { dom: HTMLElement; destroy(): void } {
  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const dom = element('div', 'cm-mw-preview')
  let url: string | null = null
  if (portrait) {
    url = URL.createObjectURL(new Blob([portrait.data], { type: portrait.type }))
    const image = element('img', 'cm-mw-preview-portrait')
    image.src = url
    image.alt = ''
    dom.append(image)
  }
  const text = element('div', 'cm-mw-preview-text')
  text.append(element('div', 'cm-mw-preview-name', data.name))
  if (data.aliases.length > 0) text.append(element('div', 'cm-mw-preview-aliases', `auch: ${data.aliases.join(', ')}`))
  if (data.properties.length > 0) {
    const list = element('dl', 'cm-mw-preview-properties')
    for (const { key, value } of data.properties) list.append(element('dt', undefined, key), element('dd', undefined, value))
    text.append(list)
  }
  dom.append(text)
  return {
    dom,
    destroy() {
      if (url) URL.revokeObjectURL(url)
      url = null
    },
  }
}

/** Builds a card when asked; null when there is nothing to show (e.g. the entry is gone). */
export type PreviewSource = (entryId: string) => Promise<(() => TooltipView) | null>

/** The hover tooltip for the name at `pos`, above it; null between names or without a card. */
export async function previewTooltip(state: EditorState, pos: number, side: -1 | 1, matcher: Matcher, preview: PreviewSource): Promise<Tooltip | null> {
  const match = linkAt(matcher, state, pos, side)
  if (!match) return null
  const make = await preview(match.entryId)
  if (!make) return null
  return { pos: match.from, end: match.to, above: true, create: make }
}
