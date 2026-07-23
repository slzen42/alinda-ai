/**
 * src/hooks/useTypingIndicator.js
 *
 * The polished typing indicator — hysteresis, throttling, and role separation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FLICKERING PROBLEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * iMessage-style typing indicators look continuous because they implement
 * "hysteresis" — a grace period after the typing signal stops before the
 * indicator disappears. Without hysteresis:
 *   - The user pauses to think for 800ms
 *   - The indicator vanishes
 *   - The user resumes typing
 *   - The indicator reappears
 *   - Three bubble animations flash in rapid succession
 *
 * This creates exactly the visual anxiety this app is designed to prevent.
 * The indicator should feel like a continuous presence, not a switch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OUTBOUND THROTTLING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * We cannot send a WebSocket payload on every keystroke. At 60 WPM, that's
 * five keystrokes per second — 300 WebSocket frames per minute, per user.
 * At scale this becomes a significant server load for zero additional value.
 *
 * We send is_typing:true at most once per second during continuous typing.
 * We send is_typing:false automatically 3 seconds after the last keystroke.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROLE SEPARATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three distinct sources of "typing":
 *   PARTNER (role 'a' or 'b'):  the other human partner is typing
 *   ALINDA  (role 'ai'):        Alinda is generating a response
 *   SELF:                       local user (handled by local state, not server)
 *
 * The visual treatment differs:
 *   Partner: standard three-dot typing bubble
 *   Alinda:  a glowing pulse under her name (AlindaPresencePulse)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // In MessageInput.jsx — outbound side:
 *   const { onTypingStart, onTypingStop } = useTypingIndicator()
 *
 *   // In TypingIndicator.jsx — inbound display side:
 *   const { partnerIsTyping, alindaIsTyping, partnerName } = useTypingIndicator()
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { alindaWS }               from 'lib/websocket'
import { useSessionStore }        from 'store/sessionStore'


// ─────────────────────────────────────────────────────────────────────────────
// TIMING CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const OUTBOUND_THROTTLE_MS   = 1000    // send is_typing:true at most once/sec
const OUTBOUND_STOP_AFTER_MS = 3000    // send is_typing:false after 3s of silence
const INBOUND_GRACE_MS       = 1800    // keep partner indicator visible for 1.8s after stop
const ALINDA_GRACE_MS        = 800     // Alinda's indicator disappears faster (she responds quickly)


// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

export function useTypingIndicator() {
  // ── Inbound state — what the UI should display ───────────────────────────
  const [partnerIsTyping, setPartnerIsTyping] = useState(false)
  const [alindaIsTyping,  setAlindaIsTyping]  = useState(false)

  // ── Inbound refs — grace period timers ───────────────────────────────────
  const partnerGraceTimerRef = useRef(null)
  const alindaGraceTimerRef  = useRef(null)

  // ── Outbound refs — throttle and auto-stop ────────────────────────────────
  const lastSentTypingRef    = useRef(0)       // timestamp of last is_typing:true sent
  const stopTypingTimerRef   = useRef(null)    // auto-stop timer
  const isTypingRef          = useRef(false)   // are we currently sending typing signals?

  // ── Store subscriptions ──────────────────────────────────────────────────
  const myRole       = useSessionStore(s => s.myRole)
  const typingRole   = useSessionStore(s => s.session?.typing_role ?? null)
  const partnerTyping = useSessionStore(s => s.session?.partner_typing ?? false)
  const partnerName  = useSessionStore(s => {
    const { session, myRole: role } = s
    return role === 'a' ? session?.name_b : session?.name_a
  })


  // ─────────────────────────────────────────────────────────────────────────
  // INBOUND: REACT TO SERVER TYPING STATE WITH HYSTERESIS
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const partnerRole = myRole === 'a' ? 'b' : 'a'
    const partnerNowTyping = partnerTyping && typingRole === partnerRole
    const alindaNowTyping  = partnerTyping && typingRole === 'ai'

    // ── Partner typing ─────────────────────────────────────────────────────
    if (partnerNowTyping) {
      // Partner started typing — show indicator immediately, cancel grace timer
      clearTimeout(partnerGraceTimerRef.current)
      setPartnerIsTyping(true)
    } else {
      // Partner stopped typing — start grace period before hiding
      clearTimeout(partnerGraceTimerRef.current)
      partnerGraceTimerRef.current = setTimeout(() => {
        setPartnerIsTyping(false)
      }, INBOUND_GRACE_MS)
    }

    // ── Alinda typing ──────────────────────────────────────────────────────
    if (alindaNowTyping) {
      clearTimeout(alindaGraceTimerRef.current)
      setAlindaIsTyping(true)
    } else {
      clearTimeout(alindaGraceTimerRef.current)
      alindaGraceTimerRef.current = setTimeout(() => {
        setAlindaIsTyping(false)
      }, ALINDA_GRACE_MS)
    }

    return () => {
      // Cleanup grace timers if the component unmounts mid-grace-period
      clearTimeout(partnerGraceTimerRef.current)
      clearTimeout(alindaGraceTimerRef.current)
    }
  }, [partnerTyping, typingRole, myRole])


  // ─────────────────────────────────────────────────────────────────────────
  // OUTBOUND: THROTTLED TYPING SIGNALS TO SERVER
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Call this whenever the local user's input value changes (onChange in MessageInput).
   * Throttles the outbound is_typing:true signal to once per OUTBOUND_THROTTLE_MS.
   * Schedules an auto-stop after OUTBOUND_STOP_AFTER_MS of silence.
   */
  const onTypingActivity = useCallback(() => {
    const now = Date.now()

    // Schedule/reset the auto-stop timer every keystroke
    clearTimeout(stopTypingTimerRef.current)
    stopTypingTimerRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false
        alindaWS.sendTypingStatus(false)
      }
    }, OUTBOUND_STOP_AFTER_MS)

    // Throttle: only send is_typing:true if enough time has passed
    if (now - lastSentTypingRef.current >= OUTBOUND_THROTTLE_MS) {
      lastSentTypingRef.current = now
      isTypingRef.current       = true
      alindaWS.sendTypingStatus(true)
    }
  }, [])

  /**
   * Call this when the input is explicitly cleared or the message is sent.
   * Immediately sends is_typing:false without waiting for the auto-stop timer.
   */
  const onTypingStop = useCallback(() => {
    clearTimeout(stopTypingTimerRef.current)
    if (isTypingRef.current) {
      isTypingRef.current = false
      alindaWS.sendTypingStatus(false)
    }
  }, [])

  // Cleanup on unmount — ensure we don't leave a "typing" signal active
  useEffect(() => {
    return () => {
      clearTimeout(stopTypingTimerRef.current)
      clearTimeout(partnerGraceTimerRef.current)
      clearTimeout(alindaGraceTimerRef.current)
      if (isTypingRef.current) {
        alindaWS.sendTypingStatus(false)
        isTypingRef.current = false
      }
    }
  }, [])


  return {
    // Inbound — for display
    partnerIsTyping,
    alindaIsTyping,
    partnerName: partnerName ?? 'Your partner',

    // Outbound — for MessageInput
    onTypingActivity,
    onTypingStop,
  }
}