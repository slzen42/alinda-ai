/**
 * src/store/themeStore.js
 *
 * The aesthetic memory for Alinda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL FRAMING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A user's visual preference is a boundary they are setting about their own
 * sensory environment. Bright screens trigger migraines. Dark screens are
 * calming for some, clinical for others. Alinda must respect this preference
 * instantly, persistently, and without the blinding white "flash" that happens
 * when a JavaScript app loads before it knows which theme to use.
 *
 * The anti-flash problem is already solved at the HTML level: the IIFE in
 * index.html reads localStorage synchronously before any JS executes and
 * applies the 'dark' class to <html> before first paint. This store must
 * use the same localStorage key ('alinda-theme') so the IIFE and the store
 * are always reading from and writing to the same location.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DUAL STATE: mode vs. resolvedMode
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * mode:         The user's explicit choice: 'light' | 'dark' | 'system'
 *               'system' means "follow my OS preference"
 *
 * resolvedMode: The concrete color scheme to render right now: 'light' | 'dark'
 *               Always a definitive answer — never 'system'.
 *               The canvas engine and CSS both need a concrete directive.
 *
 * When mode === 'system':
 *   resolvedMode is derived from window.matchMedia('(prefers-color-scheme: dark)')
 *   If the OS switches (at sunset, on a schedule), resolvedMode updates automatically
 *   via the listener in useTheme.js.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERSISTENCE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Only `mode` is persisted — not `resolvedMode`. resolvedMode is always
 * derived at runtime from mode + the current OS setting. Persisting a
 * stale resolvedMode could cause a flash if the OS setting changed since
 * the last visit (e.g., the user had dark mode at noon, sun came up,
 * stored resolvedMode was 'dark', but OS is now 'light').
 *
 * The localStorage key MUST match the IIFE in index.html exactly.
 */

import { create }   from 'zustand'
import { persist }  from 'zustand/middleware'


// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// This key is read by the IIFE in index.html BEFORE React boots.
// Changing this value here without changing it in index.html breaks
// the anti-flash system. Treat as a synchronized constant.
export const THEME_STORAGE_KEY = 'alinda-theme'

export const THEME_MODES = Object.freeze({
  LIGHT:  'light',
  DARK:   'dark',
  SYSTEM: 'system',
})


// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the concrete theme mode from the stored preference.
 * Always returns 'light' or 'dark' — never 'system'.
 *
 * @param {'light' | 'dark' | 'system'} mode
 * @returns {'light' | 'dark'}
 */
function resolveMode(mode) {
  if (mode === THEME_MODES.LIGHT)  return 'light'
  if (mode === THEME_MODES.DARK)   return 'dark'

  // 'system' — interrogate the OS
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  }

  // SSR or matchMedia unavailable — safe default
  return 'light'
}


// ─────────────────────────────────────────────────────────────────────────────
// STORE
// ─────────────────────────────────────────────────────────────────────────────

export const useThemeStore = create(
  persist(
    (set, get) => ({
      // ── State ─────────────────────────────────────────────────────────────

      /** The user's explicit preference — persisted to localStorage. */
      mode: THEME_MODES.SYSTEM,

      /**
       * The concrete mode to render right now.
       * Derived from mode + OS setting. Initialized at store creation time.
       * Updated by setMode() and by useTheme's OS listener.
       * The canvas engine reads this directly without going through React.
       */
      resolvedMode: resolveMode(THEME_MODES.SYSTEM),

      // ── Actions ───────────────────────────────────────────────────────────

      /**
       * The primary setter. Updates both mode (persisted) and resolvedMode (derived).
       * Called by theme toggle buttons in the UI.
       *
       * @param {'light' | 'dark' | 'system'} newMode
       */
      setMode: (newMode) => {
        const valid = Object.values(THEME_MODES)
        if (!valid.includes(newMode)) {
          console.warn(`[themeStore] Invalid mode: '${newMode}'. Valid options: ${valid.join(', ')}`)
          return
        }
        set({
          mode:         newMode,
          resolvedMode: resolveMode(newMode),
        })
      },

      /**
       * Convenience toggle between Olympian and Titan.
       * Skips 'system' — the toggle is a direct user override, not a request
       * to follow the OS. If the current mode is 'system', resolves the current
       * OS setting and toggles from there.
       */
      toggleMode: () => {
        const { resolvedMode } = get()
        const newMode = resolvedMode === 'dark'
          ? THEME_MODES.LIGHT
          : THEME_MODES.DARK
        set({
          mode:         newMode,
          resolvedMode: newMode,
        })
      },

      /**
       * Called by useTheme's OS listener when the user has mode='system'
       * and their OS switches between light and dark.
       * Does NOT change the stored `mode` (it stays 'system').
       *
       * @param {'light' | 'dark'} newResolved
       */
      onSystemThemeChange: (newResolved) => {
        const { mode } = get()
        if (mode === THEME_MODES.SYSTEM) {
          set({ resolvedMode: newResolved })
        }
      },

      /** Returns true if the user has explicitly chosen a theme (not 'system'). */
      hasExplicitPreference: () => {
        const { mode } = get()
        return mode !== THEME_MODES.SYSTEM
      },
    }),
    {
      name:    THEME_STORAGE_KEY,
      // Only persist 'mode' — resolvedMode is always derived at runtime
      partialize: (state) => ({ mode: state.mode }),
      // Re-derive resolvedMode when the persisted 'mode' is rehydrated
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.resolvedMode = resolveMode(state.mode)
        }
      },
    }
  )
)