export interface Shortcut {
  keys: string
  what: string
}

/** The shortcut overview (Strg+/). Keep in step with the keymaps when a shortcut is added. */
export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Schreiben',
    items: [
      { keys: 'Strg+B / Strg+I', what: 'fett / kursiv' },
      { keys: 'Strg+Umschalt+H', what: 'markieren' },
      { keys: 'Strg+Alt+M', what: 'Kommentar zum markierten Text' },
      { keys: 'Alt+↑ / ↓', what: 'Absatz verschieben (Leerzeilen zählen mit)' },
      { keys: 'Rücktaste', what: 'direkt nach einem automatischen Gedankenstrich oder Anführungszeichen: wieder rückgängig' },
    ],
  },
  {
    title: 'Nachschlagen und sammeln',
    items: [
      { keys: 'Strg+Umschalt+S', what: 'Synonyme für das Wort am Cursor (zuerst die Gruppen der Sammlung)' },
      { keys: 'Strg+Umschalt+K', what: 'markierten Text in die Sammlung' },
      { keys: 'Strg+Umschalt+L', what: 'markiertes Wort ins Vokabelheft (wenn das Modul an ist)' },
      { keys: '[[', what: 'Wiki-Vorschläge' },
      { keys: '//', what: 'Vorschläge aus der Sammlung (zuerst die Gruppen zum Wort, auch gebeugt)' },
    ],
  },
  {
    title: 'Leisten und Ansicht',
    items: [
      { keys: 'Strg+O', what: 'Schnellsprung zu Kapitel oder Wiki-Eintrag' },
      { keys: 'Strg+Umschalt+F', what: 'im ganzen Buch suchen und ersetzen' },
      { keys: 'Strg+Umschalt+N', what: 'Notizblock' },
      { keys: 'Strg+B', what: 'Seitenleiste (außerhalb des Textes)' },
      { keys: 'Strg+Umschalt+Enter', what: 'Fokusmodus (Esc beendet)' },
      { keys: 'Strg + / − / 0', what: 'Zoom größer / kleiner / zurück' },
      { keys: 'Strg+/', what: 'diese Übersicht' },
    ],
  },
]

/** Strg+/ (or Cmd+/). On a German keyboard the "/" comes with Shift, so Shift does not matter. */
export function isHelpKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key === '/'
}
