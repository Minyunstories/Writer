import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import type { TemplateLayout } from '../storage/wiki'
import type { WikiProperty } from '../types'
import type { buildMatcher } from './linker'
import { LinkedValue } from './LinkedValue'
import { layoutProperties, moveName, moveOwnProperty, moveTemplateKey, newBlockName, type PropertySection } from './propertyLayout'

/** A private drag type, so nothing else is dropped here and nothing from here lands elsewhere. */
const DRAG_TYPE = 'application/x-writer-property'

type Dragged = { kind: 'own'; id: string } | { kind: 'template'; key: string } | { kind: 'block'; name: string; starred: boolean }

interface Props {
  properties: WikiProperty[]
  blocks: string[]
  /** The folder template, or null when the entry is in no folder (no stars then). */
  layout: TemplateLayout | null
  folderName: string
  matcher: ReturnType<typeof buildMatcher>
  onOpen?: (entryId: string) => void
  /** This entry's own properties and blocks changed. */
  onEntry: (patch: { properties?: WikiProperty[]; blocks?: string[] }) => void
  /** The folder template changed (fields, starred blocks). */
  onLayout: (update: (layout: TemplateLayout) => TemplateLayout) => void
}

/** The properties of a wiki entry, in blocks; template fields and starred blocks are shared by the folder. */
export function PropertyBlocks({ properties, blocks, layout, folderName, matcher, onOpen, onEntry, onLayout }: Props) {
  const ids = useId()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [arranging, setArranging] = useState(false)
  const [over, setOver] = useState<string | null>(null)
  const [focusBlock, setFocusBlock] = useState<string | null>(null)
  const empty: TemplateLayout = { template: [], blocks: [], groups: {} }
  const sections = layoutProperties(properties, blocks, layout ?? empty, editingKey)
  const ownBlocks = sections.filter((section) => section.name && !section.starred).map((section) => section.name!)
  const pinLabel = `Feld für alle Einträge in „${folderName}“`
  const linkProps = { matcher, onOpen }

  const setProperty = (id: string, patch: Partial<WikiProperty>) =>
    onEntry({ properties: properties.map((property) => (property.id === id ? { ...property, ...patch } : property)) })

  const setTemplateValue = (row: { key: string; property?: WikiProperty }, value: string) => {
    if (row.property) setProperty(row.property.id, { value })
    else onEntry({ properties: [...properties, { id: crypto.randomUUID(), key: row.key, value }] })
  }

  const pin = (property: WikiProperty, section: PropertySection) => {
    const key = property.key.trim()
    if (!layout || !key) return
    onLayout((current) => ({
      ...current,
      template: current.template.includes(key) ? current.template : [...current.template, key],
      groups: section.starred && section.name ? { ...current.groups, [key]: section.name } : current.groups,
    }))
  }
  const unpin = (key: string, property?: WikiProperty) => {
    const block = layout?.groups[key]
    onLayout((current) => {
      const groups = { ...current.groups }
      delete groups[key]
      return { ...current, template: current.template.filter((item) => item !== key), groups }
    })
    // The value stays here, in the same block.
    if (property && block) setProperty(property.id, { group: block })
  }

  const addField = (group: string | null) =>
    onEntry({ properties: [...properties, { id: crypto.randomUUID(), key: '', value: '', ...(group ? { group } : {}) }] })

  const addBlock = () => {
    const name = newBlockName([...ownBlocks, ...(layout?.blocks ?? [])])
    onEntry({ blocks: [...ownBlocks, name] })
    setFocusBlock(name)
  }

  const renameBlock = (section: PropertySection, name: string) => {
    const old = section.name!
    const next = name.trim()
    if (!next || next === old || ownBlocks.includes(next) || layout?.blocks.includes(next)) return
    const regrouped = properties.map((property) => (property.group === old ? { ...property, group: next } : property))
    if (section.starred) {
      onLayout((current) => ({
        ...current,
        blocks: current.blocks.map((block) => (block === old ? next : block)),
        groups: Object.fromEntries(Object.entries(current.groups).map(([key, block]) => [key, block === old ? next : block])),
      }))
      onEntry({ properties: regrouped })
    } else onEntry({ properties: regrouped, blocks: ownBlocks.map((block) => (block === old ? next : block)) })
  }

  const removeBlock = (name: string) =>
    onEntry({
      blocks: ownBlocks.filter((block) => block !== name),
      properties: properties.map((property) => {
        if (property.group !== name) return property
        const rest = { ...property }
        delete rest.group
        return rest
      }),
    })

  /** Starred: the block and its fields go into the folder template, for every entry. */
  const starBlock = (section: PropertySection) => {
    const name = section.name!
    const keys = section.rows.flatMap((row) => (row.kind === 'own' && row.property.key.trim() ? [row.property.key.trim()] : []))
    onLayout((current) => ({
      template: [...current.template, ...keys.filter((key) => !current.template.includes(key))],
      blocks: [...current.blocks, name],
      groups: { ...current.groups, ...Object.fromEntries(keys.map((key) => [key, name])) },
    }))
    onEntry({ blocks: ownBlocks.filter((block) => block !== name) })
  }
  const unstarBlock = (section: PropertySection) => {
    const name = section.name!
    const keys = Object.entries(layout?.groups ?? {}).flatMap(([key, block]) => (block === name ? [key] : []))
    onLayout((current) => {
      const groups = Object.fromEntries(Object.entries(current.groups).filter(([, block]) => block !== name))
      return { template: current.template.filter((key) => !keys.includes(key)), blocks: current.blocks.filter((block) => block !== name), groups }
    })
    // Here the block stays, with its values.
    onEntry({
      blocks: [...ownBlocks, name],
      properties: properties.map((property) => (keys.includes(property.key.trim()) ? { ...property, group: name } : property)),
    })
  }

  /** Puts a dragged field or block at a place in a section. */
  const drop = (dragged: Dragged, section: PropertySection, before: { id?: string; key?: string } | null) => {
    if (dragged.kind === 'own') {
      onEntry({ properties: moveOwnProperty(properties, dragged.id, section.name, before?.id ?? null) })
    } else if (dragged.kind === 'template') {
      // Template fields live outside blocks or in starred blocks only.
      if (section.name !== null && !section.starred) return
      onLayout((current) => moveTemplateKey(current, dragged.key, section.name, before?.key ?? null))
    } else if (section.name && dragged.starred === section.starred && dragged.name !== section.name) {
      if (dragged.starred) onLayout((current) => ({ ...current, blocks: moveName(current.blocks, dragged.name, section.name) }))
      else onEntry({ blocks: moveName(ownBlocks, dragged.name, section.name) })
    }
  }

  const dragSource = (dragged: Dragged) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      event.stopPropagation()
      event.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(dragged))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      // Drag the whole row, not just the grip.
      const row = event.currentTarget.closest('li, .wiki-block')
      if (row && event.dataTransfer?.setDragImage) event.dataTransfer.setDragImage(row, 16, 16)
    },
    onDragEnd: () => setOver(null),
  })
  const dropTarget = (target: string, section: PropertySection, before: { id?: string; key?: string } | null) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      setOver(target)
    },
    onDragLeave: () => setOver((current) => (current === target ? null : current)),
    onDrop: (event: DragEvent) => {
      const raw = event.dataTransfer?.getData(DRAG_TYPE)
      if (!raw) return
      event.preventDefault()
      event.stopPropagation()
      setOver(null)
      drop(JSON.parse(raw) as Dragged, section, before)
    },
  })

  /** On touch screens: arrows within a block and a choice of block. */
  const step = (section: PropertySection, index: number, direction: 'up' | 'down') => {
    const row = section.rows[index]
    const kindRows = section.rows.filter((other) => other.kind === row.kind)
    const at = kindRows.indexOf(row)
    const target = direction === 'up' ? kindRows[at - 1] : kindRows[at + 2]
    if (direction === 'down' && at === kindRows.length - 1) return
    if (direction === 'up' && at === 0) return
    if (row.kind === 'own') {
      const beforeId = target && target.kind === 'own' ? target.property.id : null
      onEntry({ properties: moveOwnProperty(properties, row.property.id, section.name, beforeId) })
    } else {
      const beforeKey = target && target.kind === 'template' ? target.key : null
      onLayout((current) => moveTemplateKey(current, row.key, section.name, beforeKey))
    }
  }
  const arrows = (name: string, section: PropertySection, index: number) => {
    const row = section.rows[index]
    const kindRows = section.rows.filter((other) => other.kind === row.kind)
    const at = kindRows.indexOf(row)
    return (
      <span className="wiki-arrows">
        <button className="ghost icon" aria-label={`${name} nach oben`} title="Nach oben" disabled={at === 0} onClick={() => step(section, index, 'up')}>
          ↑
        </button>
        <button
          className="ghost icon"
          aria-label={`${name} nach unten`}
          title="Nach unten"
          disabled={at === kindRows.length - 1}
          onClick={() => step(section, index, 'down')}
        >
          ↓
        </button>
      </span>
    )
  }
  const blockChoice = (row: (typeof sections)[number]['rows'][number], section: PropertySection, name: string) => {
    const options = row.kind === 'template' ? [null, ...(layout?.blocks ?? [])] : [null, ...(layout?.blocks ?? []), ...ownBlocks]
    if (options.length < 2) return null
    return (
      <select
        className="wiki-block-choice"
        aria-label={`Block für ${name}`}
        value={section.name ?? ''}
        onChange={(event) => {
          const group = event.target.value || null
          if (row.kind === 'own') onEntry({ properties: moveOwnProperty(properties, row.property.id, group, null) })
          else onLayout((current) => moveTemplateKey(current, row.key, group, null))
        }}
      >
        {options.map((option) => (
          <option key={option ?? ''} value={option ?? ''}>
            {option ?? 'Ohne Block'}
          </option>
        ))}
      </select>
    )
  }

  const renderRows = (section: PropertySection, sectionIndex: number) =>
    section.rows.map((row, index) => {
      const target = row.kind === 'own' ? `own-${row.property.id}` : `template-${row.key}`
      const before = row.kind === 'own' ? { id: row.property.id } : { key: row.key }
      const name = row.kind === 'own' ? row.property.key.trim() || 'Eigenschaft' : row.key
      const grip = (
        <span
          className="wiki-grip"
          title="Ziehen zum Umsortieren"
          aria-hidden="true"
          {...dragSource(row.kind === 'own' ? { kind: 'own', id: row.property.id } : { kind: 'template', key: row.key })}
        >
          ⠿
        </span>
      )
      if (row.kind === 'template') {
        const fieldId = `${ids}-t-${sectionIndex}-${index}`
        return (
          <li key={target} className={`wiki-template-row${over === target ? ' drop-before' : ''}`} {...dropTarget(target, section, before)}>
            {grip}
            <label htmlFor={fieldId} className="wiki-template-key">
              {row.key}
            </label>
            <LinkedValue id={fieldId} value={row.property?.value ?? ''} placeholder="–" onChange={(value) => setTemplateValue(row, value)} {...linkProps} />
            {arranging ? (
              <span className="wiki-arrange-tools">
                {blockChoice(row, section, name)}
                {arrows(name, section, index)}
              </span>
            ) : (
              <button
                className="ghost icon wiki-pin"
                aria-pressed={true}
                aria-label={pinLabel}
                title={`${pinLabel} (an)`}
                onClick={() => unpin(row.key, row.property)}
              >
                ★
              </button>
            )}
          </li>
        )
      }
      const property = row.property
      return (
        <li key={target} className={`wiki-own-row${over === target ? ' drop-before' : ''}`} {...dropTarget(target, section, before)}>
          {grip}
          <input
            type="text"
            aria-label="Eigenschaft"
            placeholder="z. B. Augenfarbe"
            value={property.key}
            onFocus={() => setEditingKey(property.id)}
            onBlur={() => setEditingKey(null)}
            onChange={(event) => setProperty(property.id, { key: event.target.value })}
          />
          <LinkedValue value={property.value} ariaLabel="Wert" placeholder="Wert" onChange={(value) => setProperty(property.id, { value })} {...linkProps} />
          {arranging ? (
            <span className="wiki-arrange-tools">
              {blockChoice(row, section, name)}
              {arrows(name, section, index)}
            </span>
          ) : (
            <span className="wiki-row-tools">
              {layout ? (
                <button
                  className="ghost icon wiki-pin"
                  aria-pressed={false}
                  aria-label={pinLabel}
                  title={pinLabel}
                  disabled={!property.key.trim()}
                  onClick={() => pin(property, section)}
                >
                  ☆
                </button>
              ) : null}
              <button
                className="ghost icon"
                aria-label="Eigenschaft entfernen"
                title="Eigenschaft entfernen"
                onClick={() => onEntry({ properties: properties.filter((p) => p.id !== property.id) })}
              >
                ×
              </button>
            </span>
          )}
        </li>
      )
    })

  const total = sections.reduce((sum, section) => sum + section.rows.length, 0)

  return (
    <div className="wiki-field">
      <div className="wiki-field-head">
        <span className="wiki-label">Eigenschaften</span>
        {total > 1 && (
          <button
            className={`ghost wiki-arrange${arranging ? ' on' : ''}`}
            aria-label={arranging ? undefined : 'Eigenschaften anordnen'}
            onClick={() => setArranging((on) => !on)}
          >
            {arranging ? 'Fertig' : 'Anordnen'}
          </button>
        )}
      </div>

      {sections.map((section, sectionIndex) =>
        section.name === null ? (
          <div key="loose" className="wiki-block wiki-block-loose" {...dropTarget('loose', section, null)}>
            {section.rows.length > 0 && <ul className="wiki-properties">{renderRows(section, sectionIndex)}</ul>}
            <button className="wiki-add" onClick={() => addField(null)}>
              Eigenschaft hinzufügen
            </button>
          </div>
        ) : (
          <section
            key={`${section.starred ? 's' : 'o'}-${section.name}`}
            className={`wiki-block${section.starred ? ' starred' : ''}${over === `block-${section.name}` ? ' drop-into' : ''}`}
            aria-label={`Block ${section.name}`}
            {...dropTarget(`block-${section.name}`, section, null)}
          >
            <div className="wiki-block-head">
              <span
                className="wiki-grip"
                title="Block ziehen zum Umsortieren"
                aria-hidden="true"
                {...dragSource({ kind: 'block', name: section.name, starred: section.starred })}
              >
                ⠿
              </span>
              <BlockName
                name={section.name}
                autoFocus={focusBlock === section.name}
                onFocused={() => setFocusBlock(null)}
                onRename={(name) => renameBlock(section, name)}
              />
              {layout && (
                <button
                  className="ghost icon wiki-pin"
                  aria-pressed={section.starred}
                  aria-label={`Block „${section.name}“ für alle Einträge in „${folderName}“`}
                  title={section.starred ? 'Block mit allen Feldern für alle Einträge (an)' : 'Block mit allen Feldern für alle Einträge'}
                  onClick={() => (section.starred ? unstarBlock(section) : starBlock(section))}
                >
                  {section.starred ? '★' : '☆'}
                </button>
              )}
              <button className="ghost icon" aria-label={`Eigenschaft in „${section.name}“ hinzufügen`} title="Eigenschaft hinzufügen" onClick={() => addField(section.name)}>
                +
              </button>
              {!section.starred && (
                <button className="ghost icon" aria-label={`Block „${section.name}“ entfernen`} title="Block entfernen (Felder bleiben)" onClick={() => removeBlock(section.name!)}>
                  ×
                </button>
              )}
            </div>
            {section.rows.length > 0 ? (
              <ul className="wiki-properties">{renderRows(section, sectionIndex)}</ul>
            ) : (
              <p className="wiki-block-empty">Noch leer – Felder hierher ziehen oder mit + anlegen.</p>
            )}
          </section>
        ),
      )}
      <button className="wiki-add wiki-add-block" onClick={addBlock}>
        + Block
      </button>
    </div>
  )
}

/** The editable name of a block; renamed when the field is left or Enter is pressed. */
function BlockName({ name, autoFocus, onFocused, onRename }: { name: string; autoFocus: boolean; onFocused: () => void; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(name), [name])
  useEffect(() => {
    if (!autoFocus) return
    ref.current?.focus()
    ref.current?.select()
    onFocused()
  }, [autoFocus, onFocused])
  return (
    <input
      ref={ref}
      type="text"
      className="wiki-block-name"
      aria-label={`Name des Blocks „${name}“`}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => (draft.trim() ? onRename(draft) : setDraft(name))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(name)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
