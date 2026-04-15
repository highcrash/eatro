import { useEffect } from 'react';

/**
 * Tiny keyboard-shortcut helper.
 *
 * Each binding key is a lowercase string that describes the chord:
 *   "alt+t"     → Alt is held, T is pressed
 *   "ctrl+s"    → Ctrl is held, S is pressed
 *   "shift+?"   → Shift is held, ? is pressed
 *   "?"         → just the question mark (Shift is assumed based on layout)
 *   "F1"        → function key
 *
 * Handlers run when the user is NOT currently typing into an input, textarea,
 * or contenteditable element (we don't want typing letters into Search to
 * trigger the "Tables" shortcut, for example). Alt/Ctrl chords are always
 * applied regardless of focus.
 */

export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

function isTypingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function eventChord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  // Prefer `key` so "F1" / "?" / Arrow keys stay readable.
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  parts.push(k);
  return parts.join('+');
}

function matchesChord(e: KeyboardEvent, binding: string): boolean {
  const want = binding.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const wantCtrl = want.includes('ctrl') || want.includes('cmd') || want.includes('meta');
  const wantAlt = want.includes('alt');
  const wantShift = want.includes('shift');
  const wantKey = want[want.length - 1];

  if (wantCtrl !== (e.ctrlKey || e.metaKey)) return false;
  if (wantAlt !== e.altKey) return false;
  // Only compare shift when the binding explicitly asks for it — Shift-?
  // types "?" and the caller may just bind "?" expecting it to fire on the
  // character regardless of how the user produced it.
  if (want.includes('shift') && !e.shiftKey) return false;
  if (!wantShift && e.shiftKey && wantKey !== '?') return false;

  const keyLower = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  return keyLower === wantKey.toLowerCase();
}

interface Options {
  /** Run even when an input/textarea is focused. Off by default. */
  allowInTyping?: boolean;
  /** Disable all bindings when false. */
  enabled?: boolean;
}

export function useShortcuts(bindings: ShortcutMap, opts: Options = {}): void {
  const { allowInTyping = false, enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Modifier chords always win — even if the user is typing, Alt+T should
      // still navigate. Plain character shortcuts (like "?") bow to typing.
      const hasMod = e.ctrlKey || e.metaKey || e.altKey;
      if (!hasMod && !allowInTyping && isTypingIn(e.target)) return;

      for (const [chord, handler] of Object.entries(bindings)) {
        if (matchesChord(e, chord)) {
          e.preventDefault();
          handler(e);
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bindings, allowInTyping, enabled]);
}

/** Returns true when a character key was pressed with no modifier chords. */
export function isPlainCharKey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.length !== 1) return false;
  return /[\w\s\-_/]/.test(e.key);
}

export { eventChord };
