/**
 * src/canvas/LivingCanvas.jsx
 *
 * The ignition key for Alinda's generative canvas background.
 *
 * Renders exactly one <canvas> element. React mounts it once and then
 * the vanilla JS engine takes complete ownership of that DOM node,
 * running its RAF loop in the shadows while React sleeps.
 *
 * THE HERMETIC SEAL:
 *   Exactly two pieces of React state exist in this component:
 *     isReady: boolean — false until initialization completes (fires once)
 *     isError: boolean — true only on catastrophic init failure
 *   Everything else — every class instance, every RAF ID, every timestamp —
 *   lives in useRef hooks. React re-renders never touch the canvas engine.
 *
 * CANVAS STATE vs. PAINTING PARAMS:
 *   Painting params  — the personality (Frankenthaler/Pollock character)
 *   Canvas state overrides — the mood (cooldown, stillness, breakthrough)
 *   Final params = mergeCanvasParams(paintingParams, stateOverrides)
 *
 *   Canvas state files (canvas/states/*.js) must export:
 *   {
 *     speedMul:      number,  // multiplier on particleSpeed
 *     opacityMul:    number,  // multiplier on particleOpacity
 *     flowMul:       number,  // multiplier on flowSpeed
 *     varianceMul:   number,  // multiplier on angleVariance
 *     sedimentAdd:   number,  // additive delta on ageSediment
 *     radiusMul:     number,  // multiplier on particleRadius
 *   }
 *
 *   Painting files (paintings/*.js) must export a default object:
 *   {
 *     name:            string,
 *     fieldAngleOffset: number,
 *     flowSpeed:        number,
 *     angleVariance:    number,
 *     particleRadius:   number,
 *     particleSpeed:    number,
 *     particleOpacity:  number,
 *     ageSediment:      number,
 *     settleBias:       number, // radians — direction of calm
 *   }
 *
 * ANIMATION LOOP ORDER (invariant — must not be reordered):
 *   1. performanceMonitor.recordFrame(now)
 *   2. paletteBlend.update(now)
 *   3. phaseInterpolator.update(now)
 *   4. noiseField.render(ctx, delta)
 *   5. CSS custom property bridge (glow sync, only when changed)
 *
 * PROPS:
 *   role: 'a' | 'b' — which partner is viewing. Required.
 *     Used by resolveCanvasStyle() to pick the correct painting in
 *     asymmetric sessions where partners see different canvases.
 *   overrideCanvasState: string | null — when provided, forces a specific
 *     canvas state name regardless of the session FSM. Used by screens
 *     that exist outside the session (WaitingScreen passes 'waiting').
 *   className: string — optional extra CSS classes on the container
 *   onPhaseArrival: Function — optional callback fired when a phase
 *     transition completes. Used by screens to trigger sound effects.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { NoiseField }          from 'canvas/engine/noiseField'
import { PaletteBlend }        from 'canvas/engine/paletteBlend'
import { PhaseInterpolator }   from 'canvas/engine/phaseInterpolation'
import {
  resolveTier,
  getTierConfig,
  PerformanceMonitor,
  isDocumentVisible,
  VISIBILITY_CHANGE_EVENT,
  getReducedMotionQuery,
} from 'canvas/engine/qualityTiers'

// Canvas state param objects — will be populated in files 18–22
import { canvasIdleOverrides }        from 'canvas/states/canvasIdle'
import { canvasWaitingOverrides }     from 'canvas/states/canvasWaiting'
import { canvasCooldownOverrides }    from 'canvas/states/canvasCooldown'
import { canvasStillnessOverrides }   from 'canvas/states/canvasStillness'
import { canvasBreakthroughOverrides } from 'canvas/states/canvasBreakthrough'

// Painting system — will be populated in files 12–17
import { getPainting, DEFAULT_PAINTING_PARAMS } from 'paintings/index'
import { resolveCanvasStyle }                    from 'paintings/resolveCanvasStyle'

// Design utilities
import { modeToCanvasState, getCanvasDimensions, phaseToProgress } from 'design/theme'
import { canvasDefaults } from 'design/tokens'

// Motion
import { transitionStone, transitionStoneReduced } from 'animations/motionTokens'

// Stores — will be populated in files 32–34
import { useThemeStore }   from 'store/themeStore'
import { useSessionStore } from 'store/sessionStore'


// ─────────────────────────────────────────────────────────────────────────────
// CANVAS STATE → OVERRIDES REGISTRY
// Maps canvas state name to the override object exported by each state file.
// ─────────────────────────────────────────────────────────────────────────────

const STATE_OVERRIDES_MAP = {
  idle:         canvasIdleOverrides,
  waiting:      canvasWaitingOverrides,
  guided:       null,               // guided = base painting params, no override
  free_chat:    null,               // same as guided
  cooldown:     canvasCooldownOverrides,
  stillness:    canvasStillnessOverrides,
  breakthrough: canvasBreakthroughOverrides,
}

// Identity overrides — no modification to painting params
const IDENTITY_OVERRIDES = {
  speedMul:    1.0,
  opacityMul:  1.0,
  flowMul:     1.0,
  varianceMul: 1.0,
  sedimentAdd: 0.0,
  radiusMul:   1.0,
}

// Actions that trigger a breakthrough bloom
const BREAKTHROUGH_ACTIONS = new Set(['affirm_progress', 'suggest_framework'])


// ─────────────────────────────────────────────────────────────────────────────
// PARAM COMPOSITING — Pure function, no allocation
// Merges a painting's personality params with a canvas state's mood overrides.
// All operations are on primitive numbers — no objects created at call sites.
// ─────────────────────────────────────────────────────────────────────────────

function mergeCanvasParams(painting, overrides) {
  if (!overrides) return painting

  return {
    name:            painting.name,
    fieldAngleOffset: painting.fieldAngleOffset,
    flowSpeed:        painting.flowSpeed        * (overrides.flowMul     ?? 1.0),
    angleVariance:    painting.angleVariance    * (overrides.varianceMul ?? 1.0),
    particleRadius:   painting.particleRadius   * (overrides.radiusMul   ?? 1.0),
    particleSpeed:    painting.particleSpeed    * (overrides.speedMul    ?? 1.0),
    particleOpacity:  painting.particleOpacity  * (overrides.opacityMul  ?? 1.0),
    ageSediment:      painting.ageSediment      + (overrides.sedimentAdd ?? 0.0),
    settleBias:       painting.settleBias,
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// LIVING CANVAS COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function LivingCanvas({
  role                = 'a',
  overrideCanvasState = null,
  className           = '',
  onPhaseArrival      = null,
}) {
  const prefersReduced = useReducedMotion()

  // ── React state — exactly two, both fire only once ──────────────────────────
  const [isReady, setIsReady] = useState(false)
  const [isError, setIsError] = useState(false)

  // ── DOM refs ──────────────────────────────────────────────────────────────────
  const canvasRef    = useRef(null)    // the <canvas> DOM element
  const containerRef = useRef(null)    // the wrapper div (for CSS custom properties)

  // ── Engine instance refs ───────────────────────────────────────────────────
  const noiseFieldRef         = useRef(null)
  const paletteBlendRef       = useRef(null)
  const phaseInterpolatorRef  = useRef(null)
  const monitorRef            = useRef(null)
  const ctxRef                = useRef(null)

  // ── Loop control refs ──────────────────────────────────────────────────────
  const rafRef              = useRef(null)
  const lastFrameTimeRef    = useRef(0)
  const isInitializedRef    = useRef(false)
  const isLoopRunningRef    = useRef(false)

  // ── Configuration refs ─────────────────────────────────────────────────────
  const tierConfigRef         = useRef(null)
  const pixelRatioRef         = useRef(1)
  const currentPaintingRef    = useRef(DEFAULT_PAINTING_PARAMS)
  const currentCanvasStateRef = useRef('idle')

  // ── Breakthrough tracking ──────────────────────────────────────────────────
  const lastBreakthroughActionRef = useRef(null)
  const breakthroughTimerRef      = useRef(null)
  const isBreakthroughActiveRef   = useRef(false)

  // ── Store subscriptions — selective to minimize re-renders ─────────────────
  // Each selector is narrow: only the exact value needed, nothing more.
  const themeMode         = useThemeStore(s => s.resolvedMode)
  const sessionMode       = useSessionStore(s => s.session?.mode ?? null)
  const sessionPhase      = useSessionStore(s => s.session?.session_phase ?? 'opening')
  const lastAction        = useSessionStore(s => s.session?.last_action ?? null)
  const sessionStyleA     = useSessionStore(s => s.session?.session_style_a ?? 'balanced')
  const sessionStyleB     = useSessionStore(s => s.session?.session_style_b ?? 'balanced')
  const styleResolution   = useSessionStore(s => s.session?.style_resolution ?? 'matched')
  const sessionStyle      = useSessionStore(s => s.session?.session_style ?? 'balanced')


  // ─────────────────────────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Resolves the active canvas state name: prop override → session FSM → idle.
   */
  const resolveActiveCanvasState = useCallback(() => {
    if (overrideCanvasState) return overrideCanvasState
    if (sessionMode) return modeToCanvasState(sessionMode)
    return 'idle'
  }, [overrideCanvasState, sessionMode])

  /**
   * Resolves the active painting params for this device's role.
   * Falls back to DEFAULT_PAINTING_PARAMS before any session exists.
   */
  const resolveActivePainting = useCallback(() => {
    if (!sessionMode || sessionMode === 'intake') {
      return DEFAULT_PAINTING_PARAMS
    }
    const paintingKey = resolveCanvasStyle(
      role, sessionStyleA, sessionStyleB, styleResolution, sessionStyle
    )
    return getPainting(paintingKey)
  }, [role, sessionMode, sessionStyleA, sessionStyleB, styleResolution, sessionStyle])

  /**
   * Computes the final merged params and pushes them to the NoiseField.
   * Called whenever canvas state or painting style changes.
   * Zero allocation — mergeCanvasParams returns a new plain object but
   * this is called only on state changes (infrequent), never in the loop.
   */
  const applyCurrentParams = useCallback(() => {
    const field = noiseFieldRef.current
    if (!field) return

    const stateName  = resolveActiveCanvasState()
    const painting   = resolveActivePainting()
    const overrides  = STATE_OVERRIDES_MAP[stateName] ?? IDENTITY_OVERRIDES
    const merged     = mergeCanvasParams(painting, overrides)

    currentPaintingRef.current    = painting
    currentCanvasStateRef.current = stateName

    field.updatePaintingParams(merged)
  }, [resolveActiveCanvasState, resolveActivePainting])

  /**
   * Activates breakthrough painting params for the bloom's duration,
   * then restores the base painting params when the bloom decays.
   */
  const activateBreakthroughState = useCallback(() => {
    if (isBreakthroughActiveRef.current) return
    const field = noiseFieldRef.current
    if (!field) return

    isBreakthroughActiveRef.current = true

    const painting   = currentPaintingRef.current
    const btOverrides = canvasBreakthroughOverrides
    const merged      = mergeCanvasParams(painting, btOverrides)
    field.updatePaintingParams(merged)

    // Restore after the bloom has fully decayed
    clearTimeout(breakthroughTimerRef.current)
    breakthroughTimerRef.current = setTimeout(() => {
      isBreakthroughActiveRef.current = false
      applyCurrentParams()
    }, canvasDefaults.bloomDuration + 300)  // +300ms grace
  }, [applyCurrentParams])


  // ─────────────────────────────────────────────────────────────────────────────
  // ANIMATION LOOP — defined as a stable ref-based function
  //
  // The function is defined inside the mount useEffect so it has closure
  // over the local engine references without needing them as dependencies.
  // This is the canonical React pattern for RAF loops that must not restart
  // when dependencies change.
  // ─────────────────────────────────────────────────────────────────────────────

  const stopLoop = useCallback(() => {
    isLoopRunningRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])


  // ─────────────────────────────────────────────────────────────────────────────
  // EFFECT 1 — INITIALIZATION (runs exactly once on mount)
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function init() {
      const canvas = canvasRef.current
      if (!canvas) throw new Error('Canvas element not available')

      // ── Step 1: Interrogate device ─────────────────────────────────────────
      const tierName   = await resolveTier()
      if (cancelled) return
      const tierConfig = getTierConfig(tierName)
      tierConfigRef.current = tierConfig

      // ── Step 2: Measure and size the canvas ───────────────────────────────
      // Read CSS dimensions before DPR multiplication.
      // offsetWidth/offsetHeight are the correct values here — they return
      // the element's layout size in CSS pixels, accounting for any transforms.
      const cssWidth  = canvas.offsetWidth  || window.innerWidth
      const cssHeight = canvas.offsetHeight || window.innerHeight
      const { width, height, ratio } = getCanvasDimensions(cssWidth, cssHeight, tierName)

      canvas.width  = width
      canvas.height = height
      pixelRatioRef.current = ratio

      // ── Step 3: Acquire 2D context ────────────────────────────────────────
      // alpha: false tells the compositor this canvas is always fully opaque.
      // On Safari and Chrome this is a significant compositing performance win.
      // The alpha-decay trail technique works precisely because the canvas
      // is opaque — the background color accumulates correctly.
      const ctx = canvas.getContext('2d', {
        alpha:                 false,
        desynchronized:        true,  // hint to use the canvas on a separate thread (Chrome)
        willReadFrequently:    false,
      })
      if (!ctx || cancelled) throw new Error('2D context unavailable')
      ctxRef.current = ctx

      // Scale context to DPR — do this ONCE here, never again.
      // All subsequent draw calls use CSS pixels; the context handles scaling.
      ctx.scale(ratio, ratio)

      // ── Step 4: Resolve painting and canvas state ─────────────────────────
      const initialStateName = overrideCanvasState ?? 'idle'
      const initialPainting  = resolveActivePainting()
      const initialOverrides = STATE_OVERRIDES_MAP[initialStateName] ?? IDENTITY_OVERRIDES
      const initialParams    = mergeCanvasParams(initialPainting, initialOverrides)

      currentPaintingRef.current    = initialPainting
      currentCanvasStateRef.current = initialStateName

      // ── Step 5: Instantiate the four engines ──────────────────────────────

      // NoiseField — the particle system and vector field
      const noiseField = new NoiseField(tierConfig, initialParams, width, height)
      noiseFieldRef.current = noiseField

      // PaletteBlend — the chromatic hydration engine
      const activeTheme = themeMode === 'dark' ? 'dark' : 'light'
      const paletteBlend = new PaletteBlend(activeTheme, initialStateName, noiseField)
      paletteBlendRef.current = paletteBlend

      // PhaseInterpolator — the glacial session phase settler
      const initialPhase  = sessionPhase ?? 'opening'
      const phaseInterp   = new PhaseInterpolator(noiseField, initialPhase, tierConfig)
      phaseInterpolatorRef.current = phaseInterp

      // Wire arrival callback to the prop and/or sound manager
      phaseInterp.onArrival((arrivedPhase) => {
        if (typeof onPhaseArrival === 'function') {
          onPhaseArrival(arrivedPhase)
        }
        // soundManager.playPhaseArrival(arrivedPhase) — wired in soundManager step
      })

      // PerformanceMonitor — the thermal downgrade watchdog
      const monitor = new PerformanceMonitor(tierConfig, (newConfig) => {
        // Thermal downgrade callback — called mid-session if the device struggles
        if (cancelled) return
        noiseFieldRef.current?.applyTierConfig(newConfig)
        tierConfigRef.current = newConfig
        console.info('[LivingCanvas] Tier downgraded to', newConfig.name)
      })
      monitorRef.current = monitor

      // ── Step 6: Snap to correct initial colors ────────────────────────────
      // Critical: this writes the correct colors to the canvas BEFORE
      // the first visible frame. Prevents any flash of incorrect palette.
      paletteBlend.snapToState(activeTheme, initialStateName)
      phaseInterp.snapToPhase(initialPhase)

      // ── Step 7: Paint one silent frame before reveal ──────────────────────
      // This fills the canvas with the correct background color before the
      // Framer Motion fade-in begins. Without this, the canvas is momentarily
      // transparent between mount and first paint.
      const now = performance.now()
      paletteBlend.update(now)
      phaseInterp.update(now)
      noiseField.render(ctx, 16.67)

      // ── Step 8: Attach environmental event listeners ──────────────────────
      // These are attached here (not in separate effects) so they have direct
      // access to the engine instances without going through refs.

      // Visibility — pause loop when app is backgrounded
      const handleVisibilityChange = () => {
        // The loop itself checks isDocumentVisible() each frame —
        // this listener is just for the log and any cleanup needed
        if (document.visibilityState !== 'visible') {
          // Reset lastFrameTime so delta doesn't accumulate during background
          lastFrameTimeRef.current = 0
        }
      }
      document.addEventListener(VISIBILITY_CHANGE_EVENT, handleVisibilityChange)

      // Resize — handles keyboard slide-up, orientation change, window resize
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: newCssWidth, height: newCssHeight } =
            entry.contentRect

          const { width: newW, height: newH, ratio: newRatio } =
            getCanvasDimensions(newCssWidth, newCssHeight, tierConfigRef.current?.name ?? 'standard')

          if (Math.abs(newW - canvas.width) < 2 && Math.abs(newH - canvas.height) < 2) {
            return  // Sub-pixel change — ignore (prevents jitter on mobile scroll)
          }

          canvas.width  = newW
          canvas.height = newH
          pixelRatioRef.current = newRatio

          // Re-apply the context scale — resizing the canvas resets the transform
          ctxRef.current?.setTransform(1, 0, 0, 1, 0, 0)
          ctxRef.current?.scale(newRatio, newRatio)

          // Proportionally move existing particles to their new positions
          noiseFieldRef.current?.resize(newW, newH)
        }
      })
      resizeObserver.observe(canvas)

      // DPR change — handles OS display zoom and accessibility scaling
      let dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      const handleDprChange = () => {
        // Re-measure and resize when display zoom changes
        const newCssW = canvas.offsetWidth
        const newCssH = canvas.offsetHeight
        const { width: newW, height: newH, ratio: newRatio } =
          getCanvasDimensions(newCssW, newCssH, tierConfigRef.current?.name ?? 'standard')
        canvas.width  = newW
        canvas.height = newH
        pixelRatioRef.current = newRatio
        ctxRef.current?.setTransform(1, 0, 0, 1, 0, 0)
        ctxRef.current?.scale(newRatio, newRatio)
        noiseFieldRef.current?.resize(newW, newH)

        // Re-register listener for the new DPR value
        dprMql.removeEventListener('change', handleDprChange)
        dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        dprMql.addEventListener('change', handleDprChange)
      }
      dprMql.addEventListener('change', handleDprChange)

      // Reduced motion — listen for OS-level changes mid-session
      const reducedMotionMql = getReducedMotionQuery()
      const handleReducedMotionChange = (e) => {
        if (e.matches && tierConfigRef.current?.name !== 'conserve') {
          const conserveConfig = getTierConfig('conserve')
          noiseFieldRef.current?.applyTierConfig(conserveConfig)
          tierConfigRef.current = conserveConfig
        }
      }
      reducedMotionMql?.addEventListener('change', handleReducedMotionChange)

      // ── Step 9: Start the RAF loop ────────────────────────────────────────
      isInitializedRef.current = true
      isLoopRunningRef.current = true
      lastFrameTimeRef.current = performance.now()

      function frame(now) {
        if (!isLoopRunningRef.current) return

        rafRef.current = requestAnimationFrame(frame)

        // Skip computation when backgrounded — save battery
        if (!isDocumentVisible()) return

        // Delta time — capped at 50ms to prevent a massive jump after
        // the app was backgrounded (tab switch, phone call, etc.)
        const prevTime = lastFrameTimeRef.current
        const delta    = prevTime === 0 ? 16.67 : Math.min(now - prevTime, 50)
        lastFrameTimeRef.current = now

        const monitor     = monitorRef.current
        const palette     = paletteBlendRef.current
        const phase       = phaseInterpolatorRef.current
        const field       = noiseFieldRef.current
        const drawCtx     = ctxRef.current
        const container   = containerRef.current

        // All four engines must exist before we attempt any frame operations
        if (!palette || !phase || !field || !drawCtx) return

        // ── FRAME EXECUTION ORDER (invariant) ──────────────────────────────

        // 1. Record frame for thermal monitoring
        monitor?.recordFrame(now)

        // 2. Advance color blend — must run before render() reads colors
        palette.update(now)

        // 3. Advance phase settle — must run before render() reads field params
        phase.update(now)

        // 4. Render particles onto the canvas
        field.render(drawCtx, delta)

        // 5. CSS bridge — update glow custom properties only when changed
        //    This is the only DOM write in the loop. Guarded by hasGlowChanged()
        //    so it fires at most once per transition, not 60 times per second.
        if (container && palette.hasGlowChanged()) {
          const { r, g, b } = palette.getGlowChannels()
          container.style.setProperty('--canvas-glow-r', r)
          container.style.setProperty('--canvas-glow-g', g)
          container.style.setProperty('--canvas-glow-b', b)
        }
      }

      rafRef.current = requestAnimationFrame(frame)

      // ── Step 10: Reveal ───────────────────────────────────────────────────
      if (!cancelled) setIsReady(true)

      // ── Cleanup function for this useEffect ───────────────────────────────
      return () => {
        cancelled = true
        isLoopRunningRef.current  = false
        isInitializedRef.current  = false

        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        clearTimeout(breakthroughTimerRef.current)

        document.removeEventListener(VISIBILITY_CHANGE_EVENT, handleVisibilityChange)
        resizeObserver.disconnect()
        dprMql.removeEventListener('change', handleDprChange)
        reducedMotionMql?.removeEventListener('change', handleReducedMotionChange)
      }
    }

    const cleanup = { fn: null }

    init()
      .then(fn => { if (fn) cleanup.fn = fn })
      .catch(err => {
        console.error('[LivingCanvas] Initialization failed:', err)
        setIsError(true)
      })

    return () => {
      cleanup.fn?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // NOTE: Empty deps are intentional. The loop is self-contained and reads
  // all live values through refs. The external-facing effects below handle
  // store changes by whispering to the engine through refs.


  // ─────────────────────────────────────────────────────────────────────────────
  // EFFECT 2 — THEME CHANGE
  // React noticed the theme changed. Whisper to PaletteBlend. Go back to sleep.
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!paletteBlendRef.current) return
    const theme = themeMode === 'dark' ? 'dark' : 'light'
    paletteBlendRef.current.setTheme(theme, performance.now())
  }, [themeMode])


  // ─────────────────────────────────────────────────────────────────────────────
  // EFFECT 3 — SESSION MODE CHANGE
  // FSM mode changed (guided → cooldown, cooldown → guided, etc.).
  // Updates the canvas state and re-composites the painting params.
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!paletteBlendRef.current) return

    const newStateName = resolveActiveCanvasState()
    if (newStateName === currentCanvasStateRef.current) return

    currentCanvasStateRef.current = newStateName
    paletteBlendRef.current.setCanvasState(newStateName, performance.now())
    applyCurrentParams()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionMode, overrideCanvasState])


  // ─────────────────────────────────────────────────────────────────────────────
  // EFFECT 4 — SESSION PHASE CHANGE
  // Phase changed (opening → exploration → deepening → resolution → closing).
  // The PhaseInterpolator handles the 8-second glacial transition internally.
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!phaseInterpolatorRef.current || !sessionPhase) return
    phaseInterpolatorRef.current.setPhase(sessionPhase, performance.now())
  }, [sessionPhase])


  // ─────────────────────────────────────────────────────────────────────────────
  // EFFECT 5 — BREAKTHROUGH ACTION DETECTION
  // When Alinda fires a breakthrough-class action (affirm_progress,
  // suggest_framework), trigger the bloom expansion on the NoiseField.
  //
  // Guarded by lastBreakthroughActionRef to prevent re-triggering if the
  // same action object reference is seen on multiple renders.
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!noiseFieldRef.current) return
    if (!lastAction) return
    if (!BREAKTHROUGH_ACTIONS.has(lastAction)) return
    if (lastAction === lastBreakthroughActionRef.current) return

    lastBreakthroughActionRef.current = lastAction

    // Bloom position: center-of-canvas, slightly above center (0.45)
    // so it radiates from the "heart" of the composition rather than
    // the geometric middle.
    noiseFieldRef.current.triggerBloom(0.5, 0.45)
    activateBreakthroughState()
  }, [lastAction, activateBreakthroughState])


  // ─────────────────────────────────────────────────────────────────────────────
  // EFFECT 6 — PAINTING STYLE CHANGE
  // Fires when session style resolution changes — rare, but handles the
  // edge case where a safety override fires after session start.
  // ─────────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!noiseFieldRef.current) return
    if (isBreakthroughActiveRef.current) return  // Don't interrupt a bloom
    applyCurrentParams()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStyleA, sessionStyleB, styleResolution, sessionStyle])


  // ─────────────────────────────────────────────────────────────────────────────
  // REVEAL ANIMATION VARIANTS
  // The canvas wrapper fades in once the engine is ready.
  // Respects prefers-reduced-motion.
  // ─────────────────────────────────────────────────────────────────────────────

  const revealVariants = {
    hidden:  { opacity: 0 },
    visible: {
      opacity:    1,
      transition: prefersReduced ? transitionStoneReduced : transitionStone,
    },
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // ERROR STATE
  // If initialization failed catastrophically, render the CSS background color.
  // The app continues to function — Alinda still responds, the session still runs.
  // The canvas is a background enhancement, never a critical dependency.
  // ─────────────────────────────────────────────────────────────────────────────

  if (isError) {
    return (
      <div
        className={`fixed inset-0 -z-10 bg-surface-base ${className}`}
        aria-hidden="true"
      />
    )
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  //
  // The component renders:
  //   motion.div (fixed, full-bleed, z-index -1, handles fade-in)
  //     └── div (container ref — receives CSS custom properties for glow)
  //           └── canvas (the only thing the engine draws to)
  //
  // The motion.div is opacity-0 until isReady — this hides the single silent
  // pre-reveal frame we painted in init. Once isReady, Framer Motion fades it
  // in using the stone transition.
  //
  // aria-hidden: true — the canvas is purely decorative. Screen readers
  // should not announce it. The therapeutic content lives in the React DOM.
  // ─────────────────────────────────────────────────────────────────────────────

  
  return (
    <motion.div
      className="fixed inset-0 -z-10 overflow-hidden"
      variants={revealVariants}
      initial="hidden"
      animate={isReady ? 'visible' : 'hidden'}
      aria-hidden="true"
    >
      {/* Grain overlay — applied via the grain CSS utility class from index.css.
          Sits over the canvas at z-index 9999 in CSS, creating the weathered
          stone texture that unifies the painting and the UI. */}
      <div
        ref={containerRef}
        className="grain absolute inset-0"
        // CSS custom properties set imperatively by the RAF loop:
        // --canvas-glow-r / --canvas-glow-g / --canvas-glow-b
        // These are read by TurnGlow.jsx and AlindaPresencePulse.jsx
        // to synchronize their box-shadow glow colors with the canvas.
      >
        <canvas
          ref={canvasRef}
          // CSS: full-bleed, no pointer events, no selection
          // width/height are set in pixels by the init effect (DPR-aware)
          // DO NOT set width/height attributes here — the init effect sets them.
          style={{
            display:        'block',
            width:          '100%',
            height:         '100%',
            pointerEvents:  'none',
            userSelect:     'none',
            // Will-change hints to the browser that this element will animate.
            // Promotes it to its own compositor layer — critical for smooth
            // 60fps rendering without painting artifacts on the DOM above.
            willChange:     'contents',
          }}
        />
      </div>
    </motion.div>
  )
}