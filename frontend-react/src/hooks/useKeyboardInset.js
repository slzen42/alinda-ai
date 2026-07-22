/**
 * src/hooks/useKeyboardInset.js
 *
 * Virtual keyboard detection and inset calculation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PROBLEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When a mobile virtual keyboard appears, it occupies the lower portion of
 * the screen. Two different things happen depending on the OS and browser:
 *
 * iOS Safari:
 *   The keyboard floats OVER the viewport. The layout viewport doesn't change.
 *   The visual viewport SHRINKS (the keyboard is literally on top of content).
 *   Fixed elements at the bottom of the screen are now hidden behind the keyboard.
 *
 * Android Chrome:
 *   The viewport resizes. The browser fires a resize event.
 *   Fixed elements move up automatically in some configurations.
 *   Behavior varies by Android version and "resize visual viewport" flag.
 *
 * The common ground: window.visualViewport.height SHRINKS when the keyboard
 * appears on both platforms. The keyboard height is approximately:
 *   keyboardHeight = window.innerHeight - window.visualViewport.height
 *
 * This approximation is accurate on iOS and generally accurate on Android.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS HOOK PROVIDES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   keyboardHeight:    number  — pixel height of the keyboard (0 if hidden)
 *   keyboardVisible:   boolean — whether the keyboard is currently shown
 *   inputFocused:      boolean — whether any input/textarea is focused
 *
 * The hook does NOT apply any layout changes itself. It provides data.
 * ChatScreen.jsx uses keyboardHeight to:
 *   1. Adjust the message input bar's bottom padding
 *   2. Scroll the message list to keep the latest message visible
 *   3. Pass as a Framer Motion layout animation target (not a CSS transition)
 *      so the input bar glides up with the same timing as the native keyboard
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESKTOP BEHAVIOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * On desktop, physical keyboards don't change the viewport. This hook
 * returns keyboardHeight=0 and keyboardVisible=false on desktop.
 * The focus tracking still works — inputFocused is true when a text
 * field has focus, which ChatScreen uses for independent styling decisions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCROLL ANCHORING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ChatScreen.jsx uses keyboardHeight to calculate the exact scroll offset
 * needed to keep the latest message visible. When the keyboard appears:
 *   scrollTo = messageListScrollTop + keyboardHeight
 * This value is passed to the message list's scroll container, ensuring
 * the user's last-read message stays visible above the keyboard.
 *
 * The scroll happens after a short delay (one frame) to ensure the
 * layout has settled after the keyboard animation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SPRING-LOADED INSET IN CHATSCREEN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The smooth keyboard-matching animation is NOT implemented in this hook.
 * It is implemented in MessageInput.jsx using:
 *
 *   import { motion, useSpring } from 'framer-motion'
 *   const { keyboardHeight } = useKeyboardInset()
 *   const springBottom = useSpring(keyboardHeight, { stiffness: 300, damping: 30 })
 *   <motion.div style={{ bottom: springBottom }}>
 *
 * We deliberately violate the "no springs" law here because keyboard
 * animation is the one context where matching the native OS spring feels
 * more correct than the stone easing. A keyboard that appears with stone
 * easing feels like a UI component; a keyboard that appears with the OS's
 * own spring physics feels like the device itself is moving.
 * This is the single exception to the anti-spring law.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Detects virtual keyboard presence and height.
 *
 * @returns {{
 *   keyboardHeight:  number,   — pixel height of keyboard (0 on desktop, 0 when hidden)
 *   keyboardVisible: boolean,  — true when keyboard is shown
 *   inputFocused:    boolean,  — true when any text input is focused
 * }}
 */
export function useKeyboardInset() {
  const [keyboardHeight, setKeyboardHeight]   = useState(0)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [inputFocused, setInputFocused]       = useState(false)

  // Track the layout viewport height at focus time (the true document height,
  // before the keyboard shrinks the visual viewport)
  const layoutHeightRef    = useRef(null)
  const rafIdRef           = useRef(null)
  const isDesktopRef       = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Detect desktop: if the device has no coarse pointer and has a mouse,
    // it's almost certainly a desktop. Keyboards on desktop don't change
    // viewport height, so we skip all this logic.
    const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches
    const isMobile         = hasCoarsePointer || /iPhone|iPad|Android/i.test(navigator.userAgent)
    isDesktopRef.current   = !isMobile

    // On desktop: still track input focus, but never report keyboard height
    if (isDesktopRef.current) {
      const onFocus = (e) => {
        if (e.target.matches('input, textarea, [contenteditable]')) {
          setInputFocused(true)
        }
      }
      const onBlur = (e) => {
        if (e.target.matches('input, textarea, [contenteditable]')) {
          setInputFocused(false)
        }
      }
      document.addEventListener('focusin', onFocus)
      document.addEventListener('focusout', onBlur)
      return () => {
        document.removeEventListener('focusin', onFocus)
        document.removeEventListener('focusout', onBlur)
      }
    }

    // ── Mobile path ────────────────────────────────────────────────────────

    const calculateKeyboardHeight = () => {
      if (rafIdRef.current !== null) return

      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null

        const visualHeight = window.visualViewport?.height ?? window.innerHeight
        const layoutHeight = layoutHeightRef.current ?? window.innerHeight

        // The keyboard height is the gap between the layout viewport
        // (full screen, unchanged when keyboard appears) and the visual
        // viewport (shrinks to exclude the keyboard area)
        const inset = Math.max(0, Math.round(layoutHeight - visualHeight))

        // Threshold: changes under 50px are likely URL bar animation,
        // not keyboard. The keyboard is always at least 200px on any
        // real device.
        const isKeyboard = inset > 50

        setKeyboardHeight(isKeyboard ? inset : 0)
        setKeyboardVisible(isKeyboard)

        // Update the CSS custom property for any layout that needs it
        document.documentElement.style.setProperty(
          '--keyboard-inset',
          `${isKeyboard ? inset : 0}px`
        )
      })
    }

    // On focus: record the layout height before keyboard appears
    const onFocusIn = (e) => {
      if (!e.target.matches('input, textarea, [contenteditable]')) return

      setInputFocused(true)

      // Record layout height at focus time — this is the pre-keyboard measurement
      layoutHeightRef.current = window.innerHeight

      // Measure after a brief delay to let the keyboard animation begin
      // iOS: keyboard fully appears in ~250ms
      // Android: ~150ms
      // We wait 300ms to catch both and measure accurately
      setTimeout(calculateKeyboardHeight, 300)
    }

    const onFocusOut = (e) => {
      if (!e.target.matches('input, textarea, [contenteditable]')) return

      setInputFocused(false)

      // Wait for keyboard dismiss animation before measuring
      setTimeout(() => {
        setKeyboardHeight(0)
        setKeyboardVisible(false)
        document.documentElement.style.setProperty('--keyboard-inset', '0px')
        layoutHeightRef.current = null
      }, 150)
    }

    // visualViewport resize covers mid-session keyboard changes
    // (e.g., user switches input types, keyboard height changes)
    const onVisualViewportResize = () => {
      if (inputFocused) calculateKeyboardHeight()
    }

    document.addEventListener('focusin',  onFocusIn,  { capture: true })
    document.addEventListener('focusout', onFocusOut, { capture: true })

    const vv = window.visualViewport
    if (vv) vv.addEventListener('resize', onVisualViewportResize)

    // Initialize CSS custom property
    document.documentElement.style.setProperty('--keyboard-inset', '0px')

    return () => {
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
      document.removeEventListener('focusin',  onFocusIn,  { capture: true })
      document.removeEventListener('focusout', onFocusOut, { capture: true })
      if (vv) vv.removeEventListener('resize', onVisualViewportResize)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { keyboardHeight, keyboardVisible, inputFocused }
}