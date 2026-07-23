/**
 * src/hooks/useTheme.js
 *
 * The DOM bridge and mobile chrome synchronizer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS HOOK DOES (and what themeStore.js does NOT do)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * themeStore.js holds data. It is pure, framework-agnostic Zustand state.
 * It knows nothing about the DOM.
 *
 * useTheme.js produces side effects. It reads from themeStore and writes
 * to the actual browser environment:
 *
 *   1. CSS CLASS INJECTION:
 *      Adds/removes the 'dark' class on <html>. This is what activates
 *      Tailwind's dark: utility variants across the entire application.
 *
 *   2. THEME-COLOR META TAG SYNC:
 *      The <meta id="theme-meta"> tag controls the mobile browser's status
 *      bar color. Without this, a user in Titan mode sees a dark app with
 *      a bright white iOS status bar — the immersion breaks.
 *      This hook rewrites that tag's content attribute dynamically.
 *
 *   3. OS LISTENER:
 *      When mode === 'system', listens to the OS's prefers-color-scheme
 *      MediaQueryList. If the OS switches (sunset, schedule), the hook
 *      tells themeStore to update resolvedMode silently.
 *
 *   4. CANVAS NOTIFICATION:
 *      Signals PaletteBlend in LivingCanvas.jsx to begin its color transition.
 *      This is done via the sessionStore's 'themeChanged' flag, which
 *      LivingCanvas reads in its store subscription useEffect.
 *      (We do not import LivingCanvas here — that would be a circular dep.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MOUNT BEHAVIOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * On first mount, the hook syncs all side effects to the current resolvedMode.
 * This is important because the IIFE in index.html applied the 'dark' class
 * before React mounted — the hook's initial sync verifies and maintains that
 * state rather than re-deriving it (which could cause a flash if there's any
 * timing gap between the IIFE and the hook).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // Mount once in App.jsx or a persistent layout wrapper:
 *   function App() {
 *     useTheme()   // side effects only — returns nothing used by the component
 *     ...
 *   }
 *
 *   // For components that need to READ the theme:
 *   const resolvedMode = useThemeStore(s => s.resolvedMode)
 *
 *   // For theme toggle buttons:
 *   const toggleMode = useThemeStore(s => s.toggleMode)
 */

import { useEffect, useRef } from 'react'
import { useThemeStore }     from 'store/themeStore'


// ─────────────────────────────────────────────────────────────────────────────
// TOKEN VALUES FOR THE META TAG
//
// These must match the values in src/index.css's :root and .dark blocks.
// The meta tag controls the native browser chrome (status bar on iOS,
// address bar color on Android Chrome).
// ─────────────────────────────────────────────────────────────────────────────

const THEME_COLORS = Object.freeze({
  light: '#EDEAE3',   // --surface-base Olympian (weathered marble)
  dark:  '#1A1C1E',   // --surface-base Titan    (cold dark stone)
})


// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mounts once in App.jsx. Produces DOM side effects for theme management.
 * Returns nothing — callers read from themeStore directly.
 */
export function useTheme() {
  const mode              = useThemeStore(s => s.mode)
  const resolvedMode      = useThemeStore(s => s.resolvedMode)
  const onSystemChange    = useThemeStore(s => s.onSystemThemeChange)
  const mqlRef            = useRef(null)   // MediaQueryList — stored to remove listener on cleanup

  // ── Effect 1: Apply resolvedMode to the DOM ──────────────────────────────
  // Fires whenever resolvedMode changes.
  // resolvedMode only changes when:
  //   a) The user taps the theme toggle (immediate, deliberate)
  //   b) The OS switches while mode === 'system' (automatic, passive)
  useEffect(() => {
    const root       = document.documentElement
    const isDark     = resolvedMode === 'dark'

    // ── 1a. CSS class ───────────────────────────────────────────────────────
    // Adding/removing 'dark' on <html> activates all Tailwind dark: variants.
    // The transition between light and dark is handled by the CSS rule on
    // <html> in index.css: transition: background-color 500ms ease, color 500ms ease
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    // ── 1b. Theme-color meta tag ────────────────────────────────────────────
    // Uses id="theme-meta" — matching the fix applied to index.html.
    // This controls the iOS status bar color and Android address bar color.
    // Without this, the mobile chrome disagrees with the app's own palette.
    const metaTag = document.getElementById('theme-meta')
    if (metaTag) {
      metaTag.setAttribute('content', isDark ? THEME_COLORS.dark : THEME_COLORS.light)
    }

    // ── 1c. CSS custom properties ────────────────────────────────────────────
    // Inject the resolved theme name as a data attribute so CSS can also
    // branch on it if needed (e.g., for canvas-adjacent elements that need
    // to know the theme without reading a Tailwind class).
    root.setAttribute('data-theme', resolvedMode)

  }, [resolvedMode])


  // ── Effect 2: OS-level listener for system mode ──────────────────────────
  // Only active when mode === 'system'.
  // When the OS switches (at sunset, on a schedule, in system settings),
  // this listener fires and tells themeStore to update resolvedMode.
  useEffect(() => {
    // Clean up previous listener if mode was just changed from 'system'
    const prevMql = mqlRef.current
    if (prevMql) {
      prevMql.removeEventListener('change', prevMql._alindaHandler)
      mqlRef.current = null
    }

    if (mode !== 'system') return

    if (typeof window === 'undefined' || !window.matchMedia) return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')

    const handler = (e) => {
      onSystemChange(e.matches ? 'dark' : 'light')
    }

    // Store the handler on the mql object so we can remove it on cleanup
    mql._alindaHandler = handler
    mql.addEventListener('change', handler)
    mqlRef.current = mql

    // Fire immediately in case the OS changed while the app was backgrounded
    // (the store may not reflect the current OS state if it rehydrated from
    // localStorage with stale mode='system' during a theme toggle on the OS)
    const currentOsTheme = mql.matches ? 'dark' : 'light'
    onSystemChange(currentOsTheme)

    return () => {
      mql.removeEventListener('change', handler)
    }
  }, [mode, onSystemChange])


  // ── Effect 3: Reduced motion awareness ─────────────────────────────────
  // Inject --motion-ok CSS custom property so animations can check it
  // without JavaScript. Components can do:
  //   @media (prefers-reduced-motion: no-preference) { ... }
  // But for Framer Motion animations controlled by JS, this custom property
  // lets us derive the preference once at mount rather than calling matchMedia
  // in every animated component.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')

    const apply = (reduced) => {
      document.documentElement.style.setProperty(
        '--motion-ok',
        reduced ? '0' : '1'
      )
    }

    apply(mql.matches)
    mql.addEventListener('change', (e) => apply(e.matches))

    return () => {
      // Leaving the custom property in place on unmount is fine —
      // it doesn't cause visual artifacts, and the component may remount.
    }
  }, [])
}


// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE SELECTOR HOOKS
//
// For components that need theme values without subscribing to the full store.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the resolved theme mode and toggle function.
 * Components that use this re-render only when the theme actually changes.
 *
 * @returns {{ isDark: boolean, isLight: boolean, toggleMode: () => void, mode: string }}
 */
export function useThemeToggle() {
  const resolvedMode = useThemeStore(s => s.resolvedMode)
  const toggleMode   = useThemeStore(s => s.toggleMode)
  const mode         = useThemeStore(s => s.mode)

  return {
    isDark:     resolvedMode === 'dark',
    isLight:    resolvedMode === 'light',
    mode,
    toggleMode,
  }
}