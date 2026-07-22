/**
 * src/hooks/useViewportSize.js
 *
 * The true viewport size hook — fighting and winning against mobile browser UI.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Standard CSS `100vh` is broken on mobile. On iOS Safari, `100vh` equals the
 * viewport height WITHOUT the browser chrome — including the area behind the
 * URL bar and bottom navigation. The moment the user scrolls, the URL bar
 * slides away, and the actual visible area becomes taller. Components sized
 * to `100vh` are now too short; components fixed to the bottom are now
 * in the wrong position.
 *
 * CSS `100dvh` (dynamic viewport height) was introduced to solve this, and we
 * use it in tailwind.config.js for static layouts. But components that need
 * the NUMERIC value of the viewport height — for canvas sizing, for scroll
 * calculations, for keyboard inset math — still need a JS source of truth.
 *
 * The `visualViewport` API solves this. It reports the exact visible area,
 * accounting for the URL bar, keyboard, and any other browser-injected UI.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS HOOK DOES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. Reads the true visible dimensions from window.visualViewport
 * 2. Falls back to window.innerWidth/innerHeight for browsers without visualViewport
 * 3. Updates on resize via visualViewport's 'resize' event (not window resize)
 * 4. Also listens to window 'resize' for desktop browser window drag-resizing
 * 5. Debounces updates with requestAnimationFrame for performance
 * 6. Injects the true height as --true-viewport-height CSS custom property
 *    on document.documentElement so any element can use it without JS
 * 7. Returns { width, height, isSmallScreen, isTouchDevice } for React consumers
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CSS CUSTOM PROPERTY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * By injecting --true-viewport-height on <html>, any CSS can use:
 *   height: var(--true-viewport-height)
 *
 * And in Tailwind (with the arbitrary value syntax):
 *   className="h-[var(--true-viewport-height)]"
 *
 * This bypasses React's render cycle for layout — the CSS engine reads the
 * custom property directly, no React re-render needed. More responsive
 * and more performant than passing height as a prop.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESKTOP BEHAVIOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * On desktop:
 * - visualViewport exists but URL bars don't collapse (browser chrome is static)
 * - The custom property still updates correctly on browser window resize
 * - isSmallScreen will be false (width > 768px)
 * - isTouchDevice will typically be false (no touch points)
 * - The hook functions identically — just without the mobile-specific drama
 */

import { useState, useEffect, useCallback } from 'react'

// Breakpoints — consistent with tailwind.config.js
const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
}

/**
 * Returns the current true viewport dimensions, accounting for mobile
 * browser chrome (URL bar, navigation tabs) via the visualViewport API.
 *
 * @returns {{
 *   width: number,
 *   height: number,
 *   isSmallScreen: boolean,   — true if width < 768px (mobile portrait)
 *   isTouchDevice: boolean,   — true if device has coarse pointer (touch)
 * }}
 */
export function useViewportSize() {
  // Initialize with best available values synchronously (before first effect)
  const getSize = useCallback(() => {
    if (typeof window === 'undefined') {
      return { width: 375, height: 812 }   // reasonable mobile fallback for SSR
    }

    const vv = window.visualViewport
    return {
      width:  vv ? Math.round(vv.width)  : window.innerWidth,
      height: vv ? Math.round(vv.height) : window.innerHeight,
    }
  }, [])

  const [size, setSize] = useState(getSize)

  useEffect(() => {
    if (typeof window === 'undefined') return

    let rafId = null

    /**
     * The update function — reads from visualViewport and updates both
     * React state and the CSS custom property.
     *
     * Wrapped in RAF so that multiple synchronous resize events (mobile
     * browsers fire them aggressively during URL bar animation) collapse
     * into a single DOM read/write per animation frame.
     */
    const update = () => {
      if (rafId !== null) return   // already queued for this frame

      rafId = requestAnimationFrame(() => {
        rafId = null

        const vv = window.visualViewport
        const width  = vv ? Math.round(vv.width)  : window.innerWidth
        const height = vv ? Math.round(vv.height) : window.innerHeight

        // Inject as CSS custom property — bypasses React render for
        // layout consumers that only need it in CSS
        document.documentElement.style.setProperty(
          '--true-viewport-height',
          `${height}px`
        )
        document.documentElement.style.setProperty(
          '--true-viewport-width',
          `${width}px`
        )

        setSize(prev => {
          // Only trigger React re-render if values actually changed
          if (prev.width === width && prev.height === height) return prev
          return { width, height }
        })
      })
    }

    // Initial injection on mount
    const initial = getSize()
    document.documentElement.style.setProperty(
      '--true-viewport-height',
      `${initial.height}px`
    )
    document.documentElement.style.setProperty(
      '--true-viewport-width',
      `${initial.width}px`
    )

    // visualViewport events: cover mobile URL bar animation
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)   // iOS fires scroll on URL bar change
    }

    // window resize: covers desktop browser window drag-resizing and
    // orientation change on mobile (which fires on window, not visualViewport)
    window.addEventListener('resize', update)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      if (vv) {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
      }
      window.removeEventListener('resize', update)
    }
  }, [getSize])

  // Derived values — computed from size, memoized
  const isSmallScreen = size.width < BREAKPOINTS.md

  const isTouchDevice = typeof window !== 'undefined'
    ? window.matchMedia('(pointer: coarse)').matches
    : false

  return {
    width:        size.width,
    height:       size.height,
    isSmallScreen,
    isTouchDevice,
  }
}