/**
 * src/hooks/useSessionTimer.js
 *
 * Hardware-synchronized, pause-aware session timer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY setInterval IS WRONG FOR THIS USE CASE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * JavaScript's setInterval drifts. On a desktop browser it may drift
 * by 1–2ms per second — barely noticeable over 5 minutes, but over a
 * 90-minute therapy session it accumulates to a visible discrepancy between
 * the client's displayed time and the server's actual session duration.
 *
 * More critically: when a mobile browser backgrounds, setInterval pauses
 * entirely. The phone locks, 10 minutes pass, the user unlocks — and the
 * timer thinks only 1 second has elapsed. The client and server are now
 * completely out of sync.
 *
 * The correct approach: calculate elapsed time by comparing Date.now() to the
 * backend-provided session_started_at on every RAF tick. This is always in
 * sync with the server because both measures are in wall-clock time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL TENSION: TIME MUST BE KNOWN, NOT FELT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A ticking countdown clock induces scarcity anxiety — the exact opposite
 * of the therapeutic "time is not an issue" environment Alinda is designed to
 * create. The progress float (0.0–1.0) this hook produces feeds the
 * SessionProgressBar, which renders as a thin, unobtrusive thread at the top
 * of the screen. The user can check it but it never demands attention.
 *
 * The hook updates using requestAnimationFrame rather than setInterval.
 * This has two advantages:
 * 1. RAF pauses when the browser is backgrounded (no false "session over" events)
 * 2. The progress float is always smoothly updated, never jumping in 1-second increments
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PAUSE ACCUMULATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * When the session is paused, time must not advance. The hook tracks the
 * accumulated pause duration. When a pause begins, it records the pause start
 * time. When it ends, it adds the pause duration to a running total.
 *
 * Elapsed clinical time = (now - session_started_at) - total_pause_duration
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PHASE CALCULATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The hook calculates which therapeutic phase the time suggests, independent
 * of the backend FSM's own phase tracking. This provides a "time-based phase
 * hint" that PhaseInterpolation.js can cross-reference with the AI's actual
 * clinical assessment. If the backend says "opening" but 40 minutes have
 * elapsed, something interesting is happening — the canvas can reflect that.
 *
 * Standard phase thresholds (as fractions of total duration):
 *   0.00–0.12  → opening      (first 10 minutes of a 90min session)
 *   0.12–0.35  → exploration  (minutes 10-31)
 *   0.35–0.65  → deepening    (minutes 31-58)
 *   0.65–0.88  → resolution   (minutes 58-79)
 *   0.88–1.00  → closing      (final 11 minutes)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * UPDATE FREQUENCY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The progress float updates every animation frame (up to 60fps). However,
 * React state updates are batched — we only call setState when the integer
 * second changes, to avoid 60 React re-renders per second. The exact float
 * is exposed as a ref for components that consume it through CSS custom
 * properties (SessionProgressBar does this — it reads the ref in its own
 * RAF loop and updates a CSS var directly, bypassing React entirely).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSessionStore }                           from 'store/sessionStore'


// ─────────────────────────────────────────────────────────────────────────────
// PHASE THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────

const PHASE_THRESHOLDS = [
  { phase: 'opening',     start: 0.00 },
  { phase: 'exploration', start: 0.12 },
  { phase: 'deepening',   start: 0.35 },
  { phase: 'resolution',  start: 0.65 },
  { phase: 'closing',     start: 0.88 },
]

function _progressToPhase(progress) {
  let result = 'opening'
  for (const { phase, start } of PHASE_THRESHOLDS) {
    if (progress >= start) result = phase
    else break
  }
  return result
}

function _formatMMSS(totalSeconds) {
  const clampedSeconds = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(clampedSeconds / 60)
  const s = clampedSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function _formatHHMMSS(totalSeconds) {
  const clampedSeconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(clampedSeconds / 3600)
  const m = Math.floor((clampedSeconds % 3600) / 60)
  const s = clampedSeconds % 60
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}


// ─────────────────────────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provides accurate, pause-aware session timing for all time-dependent UI.
 *
 * @returns {TimerBundle}
 */
export function useSessionTimer() {
  // ── Store subscriptions (granular to avoid re-renders from unrelated changes)
  const startedAt     = useSessionStore(s => s.session?.session_started_at ?? null)
  const durationLimit = useSessionStore(s => s.session?.session_duration_limit ?? 90)
  const paused        = useSessionStore(s => s.session?.mode === 'paused')
  const sessionClosed = useSessionStore(s => s.session?.mode === 'closed')

  // ── React state — only integer seconds trigger re-renders ────────────────
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [timePhase,      setTimePhase]      = useState('opening')

  // ── Mutable refs — updated every RAF tick without triggering re-renders ───
  // The progress ref is the primary data source for SessionProgressBar's own
  // RAF loop, which writes to a CSS custom property directly.
  const progressRef          = useRef(0)        // 0.0 to 1.0
  const elapsedMsRef         = useRef(0)        // raw elapsed ms for precise display
  const lastIntegerSecondRef = useRef(0)        // guards against excess setState calls

  // ── Pause accounting refs ────────────────────────────────────────────────
  const isPausedRef          = useRef(false)    // last known pause state
  const pauseStartRef        = useRef(null)     // when current pause began (ms timestamp)
  const totalPausedMsRef     = useRef(0)        // accumulated pause duration

  // ── RAF loop handle ──────────────────────────────────────────────────────
  const rafRef               = useRef(null)

  // ── Tick function ────────────────────────────────────────────────────────
  const tick = useCallback(() => {
    // Always re-register — the loop must continue as long as the component is mounted
    rafRef.current = requestAnimationFrame(tick)

    if (!startedAt) return         // session hasn't started yet
    if (sessionClosed) return      // session over — freeze

    const now           = Date.now()
    const sessionStartMs = new Date(startedAt).getTime()
    const limitMs        = durationLimit * 60 * 1000

    // ── Pause accounting ────────────────────────────────────────────────────
    if (paused && !isPausedRef.current) {
      // Pause just started
      isPausedRef.current = true
      pauseStartRef.current = now
    } else if (!paused && isPausedRef.current) {
      // Pause just ended — accumulate the duration
      isPausedRef.current = false
      if (pauseStartRef.current !== null) {
        totalPausedMsRef.current += now - pauseStartRef.current
        pauseStartRef.current = null
      }
    }

    // If currently paused, don't advance elapsed time
    if (paused) return

    // ── Calculate clinical elapsed time ─────────────────────────────────────
    // Total wall-clock elapsed, minus all paused time
    const activePausedMs  = isPausedRef.current && pauseStartRef.current
      ? now - pauseStartRef.current
      : 0
    const wallElapsedMs   = now - sessionStartMs
    const clinicalMs      = Math.max(0, wallElapsedMs - totalPausedMsRef.current - activePausedMs)

    elapsedMsRef.current  = clinicalMs
    const progress        = Math.min(1.0, clinicalMs / limitMs)
    progressRef.current   = progress

    // ── Phase calculation ────────────────────────────────────────────────────
    const currentPhase    = _progressToPhase(progress)

    // ── State update — only on integer second change ─────────────────────────
    const currentSecond   = Math.floor(clinicalMs / 1000)
    if (currentSecond !== lastIntegerSecondRef.current) {
      lastIntegerSecondRef.current = currentSecond
      setElapsedSeconds(currentSecond)
      setTimePhase(prev => prev !== currentPhase ? currentPhase : prev)
    }
  }, [startedAt, durationLimit, paused, sessionClosed])

  // ── Start/stop RAF loop ──────────────────────────────────────────────────
  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [tick])

  // ── Reset pause accounting when a new session starts ─────────────────────
  useEffect(() => {
    if (startedAt) {
      totalPausedMsRef.current  = 0
      pauseStartRef.current     = null
      isPausedRef.current       = false
      lastIntegerSecondRef.current = 0
      setElapsedSeconds(0)
      setTimePhase('opening')
    }
  }, [startedAt])


  // ─────────────────────────────────────────────────────────────────────────
  // DERIVED DISPLAY VALUES
  // ─────────────────────────────────────────────────────────────────────────

  const limitSeconds    = durationLimit * 60
  const remainingSeconds = Math.max(0, limitSeconds - elapsedSeconds)
  const progress         = progressRef.current   // live float — reads current RAF value

  // Time remaining formatted as MM:SS or HH:MM:SS
  const remainingDisplay  = _formatMMSS(remainingSeconds)
  const elapsedDisplay    = _formatHHMMSS(elapsedSeconds)

  // Warning thresholds
  const isLastTenMinutes  = remainingSeconds <= 600 && remainingSeconds > 0
  const isLastFiveMinutes = remainingSeconds <= 300 && remainingSeconds > 0
  const isTimeExpired     = elapsedSeconds >= limitSeconds

  // The ref for direct CSS use — expose it for SessionProgressBar
  // to read in its own loop without going through React state.
  // Usage in SessionProgressBar:
  //   useEffect(() => {
  //     const raf = requestAnimationFrame(() => {
  //       progressBarEl.style.setProperty('--progress', progressRef.current)
  //     })
  //     return () => cancelAnimationFrame(raf)
  //   }, [])
  const progressRef_public = progressRef


  return {
    // Core timing
    elapsedSeconds,
    remainingSeconds,
    limitSeconds,
    progress,               // 0.0–1.0 float (reads from ref — always current)
    progressRef: progressRef_public,  // for components that bypass React

    // Display strings
    elapsedDisplay,         // "45:12" or "1:05:00"
    remainingDisplay,       // "44:48"

    // Phase
    timePhase,              // 'opening'|'exploration'|'deepening'|'resolution'|'closing'

    // Status
    isPaused:          paused,
    isSessionClosed:   sessionClosed,
    isLastTenMinutes,
    isLastFiveMinutes,
    isTimeExpired,

    // Pause state for display
    pausedSinceMs: isPausedRef.current ? Date.now() - (pauseStartRef.current ?? Date.now()) : 0,
    totalPausedMs: totalPausedMsRef.current,
  }
}