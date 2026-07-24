/**
 * src/App.jsx
 *
 * The master frame and grand orchestrator.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ARCHITECTURE: THE GLASS ONION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Five fixed layers, stacked along the Z-axis. Each is a sibling, not
 * a parent, so none of them affect the others' layout or mounting lifecycle.
 *
 * Layer -1  (z-index: -1)  — LivingCanvas
 *   The generative painting. Fixed, full-bleed, behind everything.
 *   Mounted here, not inside any screen, so it never unmounts.
 *   If it lived inside ChatScreen, navigating away would destroy the
 *   WebGL context and reset the painting mid-session.
 *
 * Layer 10  (z-index: 10)  — Active Screen
 *   The current UI screen (RoomEntry, Intake, Waiting, Chat, Feedback,
 *   Summary). All screens have transparent backgrounds — the canvas bleeds
 *   through the negative space. Only one is mounted at a time.
 *   Framer Motion's AnimatePresence manages the transition.
 *
 * Layer 20  (z-index: 20)  — Canvas Grain
 *   The film-grain overlay. Defined as .grain::after in index.css.
 *   The div itself is pointer-events: none and sits above all screens
 *   but below the overlays, so it textures the whole experience uniformly.
 *   (Already handled by index.css's z-index: 9999 on ::after —
 *   this comment is here for documentation, not because this layer
 *   renders a separate element.)
 *
 * Layer 40  (z-index: 40)  — State Overlays
 *   CrisisOverlay, PauseOverlay, CooldownCard.
 *   These render OVER the active screen without unmounting it.
 *   The chat history stays alive behind a pause overlay, for example.
 *   Governed entirely by FSM mode from sessionStore.
 *
 * Layer 50  (z-index: 50)  — Atmosphere
 *   SessionProgressBar (a thin thread at the very top of the screen).
 *   Connection health indicator ("Reconnecting...").
 *   These are always visible during an active session and must never
 *   be occluded by scrolling chat content.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STATE-DRIVEN ROUTING (NO URL ROUTING)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * There are no URL routes. The active screen is determined entirely by
 * the FSM mode in sessionStore. This means:
 *   - The back button cannot escape a therapeutic state
 *   - Manual URL manipulation cannot bypass intake
 *   - The server's clinical reality is always mirrored exactly
 *   - Deep-linking is not possible (intentionally — sessions are ephemeral)
 *
 * Screen resolution logic is a pure function of (mode, phase):
 *   null / undefined      → RoomEntryScreen
 *   'intake'              → IntakeScreen
 *   'waiting_for_partner' → WaitingScreen (via phase check)
 *   'ready_for_session'   → WaitingScreen
 *   'guided'              → ChatScreen
 *   'free_chat'           → ChatScreen
 *   'cooldown'            → ChatScreen (+ CooldownCard overlay)
 *   'paused'              → ChatScreen (+ PauseOverlay)
 *   'crisis_pause'        → ChatScreen (+ CrisisOverlay)
 *   'safety_lockdown'     → ChatScreen (+ CrisisOverlay)
 *   'wrapping_up'         → ChatScreen
 *   'closed' + no feedback → FeedbackScreen
 *   'closed' + feedback   → SessionSummaryScreen
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOOK REGISTRY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Side-effect hooks that must persist for the entire application lifetime
 * are invoked here, once, at the root of the component tree:
 *
 *   useTheme()         — syncs dark/light class on <html>, theme-color meta tag,
 *                        and OS preference listener
 *   useViewportSize()  — injects --true-viewport-height CSS custom property
 *   useKeyboardInset() — injects --keyboard-inset CSS custom property
 *   useWebSocket()     — manages the WebSocket connection lifecycle
 *
 * These hooks return nothing that App.jsx needs to render —
 * they're invoked purely for their side effects.
 */

import React, { lazy, Suspense, useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

// Design & stores
import { useTheme }         from 'hooks/useTheme'
import { useViewportSize }  from 'hooks/useViewportSize'
import { useKeyboardInset } from 'hooks/useKeyboardInset'
import { useWebSocket }     from 'hooks/useWebSocket'
import { useSessionState }  from 'hooks/useSessionState'
import { useCrisisState }   from 'hooks/useSessionState'
import { useSessionStore }  from 'store/sessionStore'
import { useThemeStore }    from 'store/themeStore'
import { soundManager }     from 'lib/soundManager'

// Canvas — always mounted, never lazy-loaded
// It needs to be running before any screen mounts so the painting
// has accumulated some history by the time the user sees it.
import LivingCanvas from 'canvas/LivingCanvas'

// Motion tokens
import {
  transitionStone,
  transitionStoneReduced,
} from 'animations/motionTokens'
import { pageVariants, pageVariantsReduced } from 'animations/transitions'

// Screens — lazy loaded so the initial bundle stays small.
// The Foyer screen (RoomEntry) is the only one that loads eagerly —
// it must be ready the instant the app opens.
import RoomEntryScreen from 'screens/RoomEntryScreen'

const IntakeScreen         = lazy(() => import('screens/IntakeScreen'))
const WaitingScreen        = lazy(() => import('screens/WaitingScreen'))
const ChatScreen           = lazy(() => import('screens/ChatScreen'))
const FeedbackScreen       = lazy(() => import('screens/FeedbackScreen'))
const SessionSummaryScreen = lazy(() => import('screens/SessionSummaryScreen'))

// State overlays — lazy loaded since they only appear in specific FSM states
const CrisisOverlay = lazy(() => import('components/states/CrisisOverlay'))
const PauseOverlay  = lazy(() => import('components/states/PauseOverlay'))
const CooldownCard  = lazy(() => import('components/states/CooldownCard'))
const SafetyBanner  = lazy(() => import('components/states/SafetyBanner'))

// Atmosphere layer
const SessionProgressBar = lazy(() => import('components/progress/SessionProgressBar'))

// Connection health indicator — inline, tiny, no lazy needed
import ConnectionToast from './components/ui/ConnectionToast'


// ─────────────────────────────────────────────────────────────────────────────
// SCREEN RESOLVER
//
// Pure function — determines which screen to show based on FSM state.
// Returns a { key, Component } pair. The key is what AnimatePresence uses
// to identify when the active screen has changed and trigger a transition.
// ─────────────────────────────────────────────────────────────────────────────

function resolveActiveScreen(mode, phase, myFeedbackSubmitted) {
  // Pre-session states
  if (!mode || mode === 'intake') {
    // If a partner has joined but intake isn't started, still show entry
    if (phase === 'waiting_for_partner' || phase === 'waiting_for_intake') {
      return { key: 'waiting', Component: WaitingScreen }
    }
    return { key: 'entry', Component: RoomEntryScreen }
  }

  // Explicit waiting states
  if (mode === 'ready_for_session') {
    return { key: 'waiting', Component: WaitingScreen }
  }

  // All live session states — ChatScreen handles the rest via overlays
  if (
    mode === 'guided'          ||
    mode === 'free_chat'       ||
    mode === 'cooldown'        ||
    mode === 'paused'          ||
    mode === 'crisis_pause'    ||
    mode === 'safety_lockdown' ||
    mode === 'wrapping_up'
  ) {
    return { key: 'chat', Component: ChatScreen }
  }

  // Post-session
  if (mode === 'closed') {
    if (myFeedbackSubmitted) {
      return { key: 'summary', Component: SessionSummaryScreen }
    }
    return { key: 'feedback', Component: FeedbackScreen }
  }

  // Fallback — should not be reachable in production
  return { key: 'entry', Component: RoomEntryScreen }
}


// ─────────────────────────────────────────────────────────────────────────────
// OVERLAY RESOLVER
//
// Determines which overlays should render on top of the active screen.
// Multiple overlays can be active simultaneously (e.g., a SafetyBanner
// could show alongside a CrisisOverlay), though in practice only one
// heavy overlay is active at a time.
// ─────────────────────────────────────────────────────────────────────────────

function resolveOverlays(mode) {
  return {
    showCrisis:   mode === 'crisis_pause' || mode === 'safety_lockdown',
    showPause:    mode === 'paused',
    showCooldown: mode === 'cooldown',
    showSafety:   mode === 'safety_lockdown',
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SCREEN SUSPENSION FALLBACK
//
// Shown while a lazy-loaded screen chunk is downloading.
// Uses the marble base color so there's no visible flash of white.
// In practice, the canvas is already visible behind this, so the
// fallback is just the canvas — which is perfectly appropriate.
// ─────────────────────────────────────────────────────────────────────────────

function ScreenSuspenseFallback() {
  return (
    <div
      className="fixed inset-0 bg-transparent"
      aria-label="Loading"
      aria-live="polite"
    />
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// APP COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const prefersReduced = useReducedMotion()

  // ── Hook Registry — side effects only ─────────────────────────────────────
  useTheme()
  useViewportSize()
  useKeyboardInset()

  // ── Session state ──────────────────────────────────────────────────────────
  const mode                 = useSessionStore(s => s.session?.mode ?? null)
  const phase                = useSessionStore(s => s.session?.phase ?? null)
  const roomId               = useSessionStore(s => s.roomId)
  const myRole               = useSessionStore(s => s.myRole)
  const myFeedbackSubmitted  = useSessionStore(s => {
    const { session, myRole: role } = s
    return role === 'a'
      ? session?.feedback_submitted_a
      : session?.feedback_submitted_b
  })

  const { isSessionActive, canvasState, lastAction, myStyle } = useSessionState()
  const { isInCrisis }  = useCrisisState()
  const resolvedMode    = useThemeStore(s => s.resolvedMode)
  const connectionStatus = useSessionStore(s => s.connectionStatus)

  // ── WebSocket lifecycle — managed here so it persists across screen changes ─
  // Passing null before the user has joined a room — the hook no-ops cleanly.
  useWebSocket(roomId, myRole)

  // ── Screen resolution ──────────────────────────────────────────────────────
  const { key: screenKey, Component: ActiveScreen } = resolveActiveScreen(
    mode, phase, myFeedbackSubmitted
  )
  const overlays = resolveOverlays(mode)

  // ── Sound manager — unlock on first meaningful interaction ────────────────
  // soundManager.unlock() is called here via a one-time effect rather than
  // inside RoomEntryScreen's button handler, because the unlock must happen
  // at the root level where the AudioContext can persist across all screens.
  // The actual call is triggered by the first tap anywhere in the document.
  const hasUnlockedAudio = useRef(false)
  useEffect(() => {
    const unlock = () => {
      if (hasUnlockedAudio.current) return
      hasUnlockedAudio.current = true
      soundManager.unlock()
      document.removeEventListener('pointerdown', unlock)
    }
    document.addEventListener('pointerdown', unlock, { once: true })
    return () => document.removeEventListener('pointerdown', unlock)
  }, [])

  // ── Breakthrough detection — trigger bloom and sound ──────────────────────
  const lastActionRef = useRef(null)
  useEffect(() => {
    if (!lastAction) return
    if (lastAction === lastActionRef.current) return
    lastActionRef.current = lastAction

    if (lastAction === 'affirm_progress' || lastAction === 'suggest_framework') {
      soundManager.playBreakthrough()
      // LivingCanvas handles the visual bloom via its own useEffect on lastAction
    }
  }, [lastAction])

  // ── Session lifecycle sounds ──────────────────────────────────────────────
  const prevModeRef = useRef(null)
  useEffect(() => {
    if (!mode || mode === prevModeRef.current) return
    const prevMode = prevModeRef.current
    prevModeRef.current = mode

    if (mode === 'cooldown' && prevMode === 'guided') {
      soundManager.onCooldownEnter()
    }
    if (mode === 'guided' && prevMode === 'cooldown') {
      soundManager.onCooldownExit()
    }
    if (mode === 'closed') {
      soundManager.onSessionEnd()
    }
  }, [mode])

  // ── Choose page transition variants based on motion preference ────────────
  const pageVars = prefersReduced ? pageVariantsReduced : pageVariants

  return (
    <div
      // The root element fills the true viewport height (injected by useViewportSize)
      // rather than 100vh, which breaks on mobile.
      className="relative overflow-hidden"
      style={{ height: 'var(--true-viewport-height, 100dvh)' }}
    >
      {/* ─────────────────────────────────────────────────────────────────────
          LAYER -1: THE LIVING CANVAS
          Fixed behind everything. Never unmounts. Receives canvas state
          derived from the current FSM mode via useSessionState's canvasState.
          ───────────────────────────────────────────────────────────────────── */}
      <LivingCanvas
        role={myRole ?? 'a'}
        overrideCanvasState={
          // Before session starts, canvas is idle.
          // Once session starts, let LivingCanvas derive its own state
          // from the session store — pass null to indicate "use FSM."
          isSessionActive ? null : (canvasState ?? 'idle')
        }
      />

      {/* ─────────────────────────────────────────────────────────────────────
          LAYER 10: ACTIVE SCREEN
          AnimatePresence mode="wait" ensures the exiting screen completes its
          exit animation before the entering screen begins its entrance.
          The screenKey changing is what triggers the transition.
          ───────────────────────────────────────────────────────────────────── */}
      <div className="fixed inset-0 z-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screenKey}
            variants={pageVars}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute inset-0"
          >
            <Suspense fallback={<ScreenSuspenseFallback />}>
              <ActiveScreen />
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          LAYER 40: STATE OVERLAYS
          These mount/unmount independently of the active screen.
          The screen underneath stays alive — the chat history is preserved
          during a pause or crisis overlay.
          ───────────────────────────────────────────────────────────────────── */}
      <div className="fixed inset-0 z-40 pointer-events-none">
        <Suspense fallback={null}>
          <AnimatePresence>
            {overlays.showCrisis && (
              <motion.div
                key="crisis-overlay"
                className="absolute inset-0 pointer-events-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={prefersReduced ? transitionStoneReduced : transitionStone}
              >
                <CrisisOverlay />
              </motion.div>
            )}

            {overlays.showPause && (
              <motion.div
                key="pause-overlay"
                className="absolute inset-0 pointer-events-auto"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={prefersReduced ? transitionStoneReduced : transitionStone}
              >
                <PauseOverlay />
              </motion.div>
            )}

            {overlays.showCooldown && (
              <motion.div
                key="cooldown-card"
                // Cooldown doesn't cover the full screen — just a card
                // The pointer-events-none on the parent lets clicks through
                // except on the card itself
                className="absolute inset-x-0 bottom-24 flex justify-center pointer-events-none"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={prefersReduced ? transitionStoneReduced : transitionStone}
              >
                <div className="pointer-events-auto">
                  <CooldownCard />
                </div>
              </motion.div>
            )}

            {overlays.showSafety && (
              <motion.div
                key="safety-banner"
                className="absolute top-0 inset-x-0 pointer-events-auto"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={prefersReduced ? transitionStoneReduced : transitionStone}
              >
                <SafetyBanner />
              </motion.div>
            )}
          </AnimatePresence>
        </Suspense>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────
          LAYER 50: ATMOSPHERE
          Always-on elements during an active session.
          Progress bar: a thin, unobtrusive thread at the top.
          Connection toast: transient "Reconnecting..." badge.
          ───────────────────────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 top-0 z-50 pointer-events-none">
        <AnimatePresence>
          {isSessionActive && (
            <motion.div
              key="progress"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <Suspense fallback={null}>
                <SessionProgressBar />
              </Suspense>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {(connectionStatus === 'degraded' || connectionStatus === 'offline') && (
            <motion.div
              key="connection-toast"
              className="pointer-events-auto"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={transitionStone}
            >
              <ConnectionToast status={connectionStatus} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}