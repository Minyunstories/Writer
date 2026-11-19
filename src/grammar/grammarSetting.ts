const KEY = 'mw:grammar'
/** Fired when the check was switched on or off, or what it knows changed. */
export const GRAMMAR_EVENT = 'mw:grammar'

/** The check is on unless switched off on this device. */
export function isGrammarOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setGrammarOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Not remembered; it still applies now.
  }
  recheckAll()
}

const REPEATS_KEY = 'mw:repeats'

/** Word repeats are marked only when switched on on this device. */
export function isRepeatsOn(): boolean {
  try {
    return localStorage.getItem(REPEATS_KEY) === 'on'
  } catch {
    return false
  }
}

export function setRepeatsOn(on: boolean): void {
  try {
    localStorage.setItem(REPEATS_KEY, on ? 'on' : 'off')
  } catch {
    // Not remembered; it still applies now.
  }
  recheckAll()
}

/** Every open text checks again, e.g. after a word was accepted. */
export function recheckAll(): void {
  window.dispatchEvent(new Event(GRAMMAR_EVENT))
}
