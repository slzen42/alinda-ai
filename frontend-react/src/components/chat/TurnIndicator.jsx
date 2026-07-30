/**
 * src/components/chat/TurnIndicator.jsx
 *
 * The Side-Column Wash — a soft chromatic signal of whose voice is active.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DESIGN RATIONALE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The human turn indicator must answer one question from the user's
 * peripheral vision: "Is it my turn or theirs?" Without looking at any
 * text, the layout of the room should tell them.
 *
 * Two rejected approaches:
 *   Orbiting aura — too magical, too gamified. Tacky on stone.
 *   Pooled gradient under last bubble — too small to register peripherally.
 *
 * The chosen approach: a wide, soft wash that occupies one full column
 * of the room — left if partner, right if self. Not a spotlight. Not an
 * aura. More like the afternoon light coming through a tall window on
 * one side of the room.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COLOUR SOURCE: THE LIVING CANVAS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The wash colour is read directly from the `--canvas-glow-r/g/b`
 * CSS custom properties that `LivingCanvas.jsx`'s RAF loop writes to
 * `containerRef` in real time. This means the indicator colour is always
 * derived from the current session painting:
 *
 *   Gentle (Frankenthaler):  blue-green, coral, sage
 *   Balanced (Pollock):      silver, near-black, ochre
 *   Direct (Teh-Chun):       ice blue, warm white, gold
 *   Practical (Twombly):     warm ash grey, flesh, red-brown
 *
 * No hardcoded palette. The room lights up in its own colours.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN IT ACTIVATES
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Controlled entirely by `isVisible` and `side` props from TurnState.
 * The component is always mounted while a session is active — it fades
 * in and out as the turn changes. It never disappears abruptly.
 *
 * When `side` changes (self → partner), the wash cross-dissolves — the
 * old side fades out as the new side fades in. Never both active at once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BLEND MODE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 'screen' in dark (Titan) mode: brightens the canvas behind the wash.
 * 'multiply' in light (Olympian) mode: enriches the canvas without washing
 * the marble ground to white.
 *
 * Both modes ensure the wash is visible but never overpowers the chat
 * content sitting on top of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROPS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * isVisible:   boolean — whether a human turn is currently active
 * isMyTurn:    boolean — true = right-side wash, false = left-side wash
 * isDark:      boolean — toggles blend mode
 */

import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'


// ─────────────────────────────────────────────────────────────────────────────
// GLOW COLOUR READER
//
// Reads the three canvas glow custom properties from the document root.
// These are written by LivingCanvas.jsx's RAF loop every frame they change.
// Falls back to a neutral bronze if they haven't been set yet.
// ─────────────────────────────────────────────────────────────────────────────

function readGlowColor() {
  if (typeof window === 'undefined') return { r: 122, g: 140, b: 110 }

  const style = getComputedStyle(document.documentElement)
  const r = parseInt(style.getPropertyValue('--canvas-glow-r').trim() || '122', 10)
  const g = parseInt(style.getPropertyValue('--canvas-glow-g').trim() || '140', 10)
  const b = parseInt(style.getPropertyValue('--canvas-glow-b').trim() || '110', 10)

  // Validate — if any value is NaN (not yet set), use neutral bronze
  if (isNaN(r) || isNaN(g) || isNaN(b)) return { r: 122, g: 140, b: 110 }
  return { r, g, b }
}


// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function TurnIndicator({ isVisible, isMyTurn, isDark }) {
  const prefersReduced = useReducedMotion()
  const colorRef       = useRef({ r: 122, g: 140, b: 110 })
  const rafRef         = useRef(null)
  const [glowColor, setGlowColor] = useState({ r: 122, g: 140, b: 110 })

  // Poll the canvas glow colour every 500ms.
  // We don't need real-time sync — 500ms is fast enough that the colour
  // appears to follow the painting without burning CPU on a RAF for this.
  useEffect(() => {
    if (!isVisible) return

    const interval = setInterval(() => {
      const newColor = readGlowColor()
      if (
        newColor.r !== colorRef.current.r ||
        newColor.g !== colorRef.current.g ||
        newColor.b !== colorRef.current.b
      ) {
        colorRef.current = newColor
        setGlowColor(newColor)
      }
    }, 500)

    return () => clearInterval(interval)
  }, [isVisible])

  const { r, g, b } = glowColor

  // The wash sits on the active partner's side
  const isRight = isMyTurn

  // Gradient shape: the wash fans from the side edge inward, fading to
  // transparent by the time it reaches 55% of viewport width.
  // This leaves the centre of the chat (where messages are) completely
  // unobscured, while the column edges glow with the painting's colour.
  const gradientDirection = isRight ? 'to left' : 'to right'

  // Two-stop gradient with a mid-point for a more organic falloff:
  // full → 18% visible → transparent
  const rgba0 = `rgba(${r},${g},${b},0.18)`
  const rgba1 = `rgba(${r},${g},${b},0.08)`
  const rgba2 = `rgba(${r},${g},${b},0)`

  const gradient = `linear-gradient(${gradientDirection}, ${rgba0} 0%, ${rgba1} 25%, ${rgba2} 55%)`

  const blendMode = isDark ? 'screen' : 'multiply'

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key={isRight ? 'right' : 'left'}
          className="fixed inset-0 pointer-events-none"
          style={{
            // z-index 5: above the canvas (-1) but below all UI (10+)
            zIndex:       5,
            background:   gradient,
            mixBlendMode: blendMode,
          }}
          initial={{ opacity: 0 }}
          animate={{
            opacity: prefersReduced ? 1 : [0.6, 1.0, 0.6],
          }}
          exit={{ opacity: 0 }}
          transition={prefersReduced
            ? { duration: 0.3 }
            : {
                // Initial fade-in
                opacity: {
                  times:    [0, 0.4, 1],
                  duration: 10,          // 0.1Hz — the room's breath
                  repeat:   Infinity,
                  ease:     'easeInOut',
                },
              }
          }
        />
      )}
    </AnimatePresence>
  )
}