/**
 * src/animations/transitions.js
 *
 * The choreography dictionary for Alinda.
 *
 * Consumes motion primitives from motionTokens.js and builds complete
 * Framer Motion Variants objects — the declarative animation state maps
 * that components reference by name rather than inline values.
 *
 * Structure of a Variants object:
 *   {
 *     hidden:  { ...initial state — what the element looks like before entering },
 *     visible: { ...resting state — what the element looks like in the UI },
 *     exit:    { ...final state — what the element looks like as it leaves },
 *   }
 *
 * HOW COMPONENTS USE THIS FILE:
 *   import { pageVariants, messageBubbleVariants } from 'animations/transitions'
 *   <motion.div
 *     variants={pageVariants}
 *     initial="hidden"
 *     animate="visible"
 *     exit="exit"
 *   />
 *
 * REDUCED MOTION:
 *   Every exported constant has a parallel *Reduced version.
 *   The useReducedMotion hook in hooks/useTheme.js selects between them.
 *   Components should never check useReducedMotion directly — they should
 *   import both variants and let a central hook pass the correct one.
 *
 * Naming convention:
 *   {ElementType}Variants      — full motion
 *   {ElementType}VariantsReduced — prefers-reduced-motion version
 */

import {
    transitionStone,        transitionStoneReduced,
    transitionReveal,       transitionRevealReduced,
    transitionVanish,       transitionVanishReduced,
    transitionBreath,       transitionBreathReduced,
    staggerStandard,        staggerSlow,        staggerFast,
    tapPrimary,             tapLight,
  } from './motionTokens'
  import { easing } from 'design/tokens'
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PAGE-LEVEL TRANSITIONS
  //
  // Applied to the root element of each screen component, wrapping the
  // full-screen content. React Router's AnimatePresence (configured in
  // App.jsx with mode="wait") ensures the exiting screen finishes its
  // exit animation before the entering screen begins — creating the
  // sensation of stepping deeper into an architectural space rather
  // than swiping sideways through a carousel.
  //
  // The entering screen drifts upward by 8px — heavy, not dramatic.
  // The exiting screen drifts downward by 4px and fades — it settles
  // back into the stone it came from.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const pageVariants = {
    hidden: {
      opacity: 0,
      y:       8,     // rising from slightly below — ascending into the space
    },
    visible: {
      opacity:    1,
      y:          0,
      transition: transitionStone,
    },
    exit: {
      opacity:    0,
      y:          -4, // settling slightly upward as it recedes
      transition: {
        ...transitionVanish,
        duration: transitionVanish.duration * 0.8, // exits slightly faster than entries
      },
    },
  }
  
  export const pageVariantsReduced = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: transitionRevealReduced },
    exit:    { opacity: 0, transition: transitionVanishReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STAGGER CONTAINER
  //
  // A parent variant that orchestrates sequential child animations.
  // Apply to any list or grid whose children have their own variants.
  // The children's own transition handles how they move — this parent
  // only controls when they begin.
  //
  // Usage:
  //   <motion.ul variants={staggerContainerVariants} initial="hidden" animate="visible">
  //     {messages.map(m => (
  //       <motion.li key={m.id} variants={messageBubbleVariants} />
  //     ))}
  //   </motion.ul>
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const staggerContainerVariants = {
    hidden:  {},
    visible: { transition: staggerStandard },
    exit:    {},
  }
  
  export const staggerContainerSlowVariants = {
    hidden:  {},
    visible: { transition: staggerSlow },
    exit:    {},
  }
  
  export const staggerContainerFastVariants = {
    hidden:  {},
    visible: { transition: staggerFast },
    exit:    {},
  }
  
  // Reduced — all children appear simultaneously with a single opacity fade
  export const staggerContainerVariantsReduced = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: transitionRevealReduced },
    exit:    { opacity: 0, transition: transitionVanishReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // MESSAGE BUBBLES
  //
  // Each message rises upward from below — as though surfacing from the
  // sediment of the conversation — and fades softly on the way in.
  // The drift distance is very small (6px) to avoid looking like a
  // notification app. The feeling should be emergence, not delivery.
  //
  // Exit is intentionally omitted for individual message bubbles — once
  // a message exists in the transcript, it doesn't animate out. Only
  // the whole transcript container exits as a unit (via pageVariants).
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const messageBubbleVariants = {
    hidden: {
      opacity: 0,
      y:       6,    // rising from below — surfacing, not dropping
      scale:   0.99,
    },
    visible: {
      opacity:    1,
      y:          0,
      scale:      1,
      transition: transitionReveal,
    },
  }
  
  export const messageBubbleVariantsReduced = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: transitionRevealReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TYPING INDICATOR
  //
  // The three dots that appear while the other partner or Alinda is typing.
  // These need their own stagger so the dots animate sequentially —
  // the universal visual language for "someone is thinking."
  // The dots pulse (scale up and down) in a cycle, each offset by 120ms
  // from the previous.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const typingDotVariants = {
    idle: {
      scale:   1,
      opacity: 0.4,
    },
    pulse: {
      scale:      [1, 1.35, 1],     // the dot swells and returns
      opacity:    [0.4, 1, 0.4],
      transition: {
        type:       'tween',
        ease:       'easeInOut',    // dots use standard ease — they're not stone
        duration:   0.7,
        repeat:     Infinity,
        repeatType: 'loop',
      },
    },
  }
  
  // The container staggers the three dots with 120ms between each
  export const typingContainerVariants = {
    idle:  {},
    pulse: { transition: { staggerChildren: 0.12, delayChildren: 0 } },
  }
  
  export const typingDotVariantsReduced = {
    idle:  { opacity: 0.4 },
    pulse: { opacity: 1, transition: { ...transitionBreathReduced, repeat: Infinity, repeatType: 'reverse' } },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TURN GLOW
  //
  // The ambient bronze light that rises from the bottom of the screen
  // on the active speaker's device. Not a notification — an atmosphere.
  // Uses the breath transition for its own pulsing presence.
  // Animated entirely through opacity — the gradient itself is defined
  // in the .turn-glow CSS class in index.css.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const turnGlowVariants = {
    inactive: {
      opacity:    0,
      transition: transitionVanish,
    },
    active: {
      opacity:    [0.6, 1, 0.6],   // breathes between 60% and 100%
      transition: transitionBreath,
    },
  }
  
  export const turnGlowVariantsReduced = {
    inactive: { opacity: 0,   transition: transitionVanishReduced },
    active:   { opacity: 0.7, transition: transitionRevealReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // ALINDA PRESENCE PULSE
  //
  // The soft radial glow under Alinda's name during free_chat/observe mode.
  // Slower than the turn glow — she's watching, not waiting.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const alindaPulseVariants = {
    absent: {
      opacity:    0,
      scale:      0.9,
      transition: transitionVanish,
    },
    present: {
      opacity:    [0.4, 0.85, 0.4],  // very gentle — barely there
      scale:      [0.95, 1.05, 0.95],
      transition: {
        ...transitionBreath,
        duration: transitionBreath.duration * 1.4,  // even slower than turn glow
      },
    },
  }
  
  export const alindaPulseVariantsReduced = {
    absent:  { opacity: 0, transition: transitionVanishReduced },
    present: { opacity: 0.5, transition: transitionRevealReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STAGE PILL
  //
  // The small session-phase label at the top of the chat screen.
  // When the dialogue_stage changes (e.g. "Opening up" → "Reflecting"),
  // the old label should fade out and the new one slide in from below.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const stagePillVariants = {
    enter: {
      opacity: 0,
      y:       4,
    },
    center: {
      opacity:    1,
      y:          0,
      transition: transitionReveal,
    },
    exit: {
      opacity:    0,
      y:          -4,
      transition: transitionVanish,
    },
  }
  
  export const stagePillVariantsReduced = {
    enter:  { opacity: 0 },
    center: { opacity: 1, transition: transitionRevealReduced },
    exit:   { opacity: 0, transition: transitionVanishReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // INSCRIPTION EFFECT (Text Reveal)
  //
  // For the Alinda wordmark and major phase titles. Text rises from the
  // stone as if being carved upward — a clip-path reveal combined with
  // a soft fade. The parent element needs overflow: hidden for the clip
  // to work correctly.
  //
  // Applied to individual words or the full text block depending on
  // whether the stagger container wraps individual word spans.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const inscriptionVariants = {
    hidden: {
      opacity:   0,
      y:         12,    // starts below the baseline — emerging from the stone
      clipPath:  'inset(100% 0% 0% 0%)',   // fully clipped from below
    },
    visible: {
      opacity:  1,
      y:        0,
      clipPath: 'inset(0% 0% 0% 0%)',      // fully revealed
      transition: {
        ...transitionStone,
        duration: transitionStone.duration * 1.2,  // slightly slower than stone — monumental
      },
    },
    exit: {
      opacity:    0,
      y:          -6,
      transition: transitionVanish,
    },
  }
  
  export const inscriptionVariantsReduced = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: transitionRevealReduced },
    exit:    { opacity: 0, transition: transitionVanishReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FROST MODAL (Overlays — Pause, Crisis, Cooldown)
  //
  // Overlays do not drop from above. They solidify — emerging from the
  // background opacity, like frosted glass slowly forming in the air in
  // front of the canvas. No directional movement. Pure presence.
  //
  // This approach is intentional: a descending overlay implies something
  // is being imposed from above. An opacity emergence implies something
  // is materialising within the space — gentler and less alarming.
  //
  // The crisis/stillness state uses an even slower, more gradual version
  // specifically to avoid contributing to visual alarm during a crisis.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const frostModalVariants = {
    hidden: {
      opacity:       0,
      backdropFilter: 'blur(0px)',
    },
    visible: {
      opacity:       1,
      backdropFilter: 'blur(12px)',
      transition: {
        ...transitionStone,
        // Stagger: opacity arrives first, blur fills in after
        opacity:       { ...transitionStone },
        backdropFilter: { ...transitionStone, delay: 0.08 },
      },
    },
    exit: {
      opacity:       0,
      backdropFilter: 'blur(0px)',
      transition:    transitionVanish,
    },
  }
  
  export const frostModalVariantsReduced = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: transitionRevealReduced },
    exit:    { opacity: 0, transition: transitionVanishReduced },
  }
  
  // The crisis-specific variant — even slower emergence so it doesn't
  // feel like a visual shock during an already alarming moment.
  export const crisisOverlayVariants = {
    hidden: {
      opacity: 0,
    },
    visible: {
      opacity:    1,
      transition: {
        type:     'tween',
        ease:     'linear',         // no easing at all — completely gradual
        duration: 0.9,              // 900ms — the slowest overlay in the system
      },
    },
    exit: {
      opacity:    0,
      transition: {
        type:     'tween',
        ease:     'linear',
        duration: 1.2,              // even slower exit — the crisis doesn't snap away
      },
    },
  }
  
  export const crisisOverlayVariantsReduced = frostModalVariantsReduced
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // INTAKE STEP TRANSITIONS
  //
  // Each question on IntakeScreen is a full-screen step.
  // The entering question rises from below (diving deeper).
  // The exiting question drifts upward and away (receding into the past).
  // This creates consistent directionality: the user is always descending
  // through the questions, moving into something deeper and more interior.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const intakeStepVariants = {
    enter: {
      opacity: 0,
      y:       24,     // entering from below — diving deeper
    },
    center: {
      opacity:    1,
      y:          0,
      transition: transitionStone,
    },
    exit: {
      opacity:    0,
      y:          -16, // exiting upward — receding into the past
      transition: transitionVanish,
    },
  }
  
  export const intakeStepVariantsReduced = {
    enter:  { opacity: 0 },
    center: { opacity: 1, transition: transitionRevealReduced },
    exit:   { opacity: 0, transition: transitionVanishReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION SUMMARY SECTIONS
  //
  // Each section of the SessionSummaryScreen (Key Themes, Breakthroughs,
  // etc.) enters with a slow stagger, feeling like tiles of a mosaic
  // being placed one at a time. The concrete commitment card, which has
  // the most visual weight on that screen, enters last and with the
  // most deliberate timing — so the user reads up to it, not past it.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const summarySectionVariants = {
    hidden: {
      opacity: 0,
      y:       10,
    },
    visible: {
      opacity:    1,
      y:          0,
      transition: {
        ...transitionReveal,
        duration: transitionReveal.duration * 1.3,  // slightly slower than standard reveals
      },
    },
  }
  
  // The concrete commitment card — heavier, more weighted arrival
  export const commitmentCardVariants = {
    hidden: {
      opacity: 0,
      y:       14,
      scale:   0.98,
    },
    visible: {
      opacity:    1,
      y:          0,
      scale:      1,
      transition: transitionStone,   // the heaviest available transition
    },
  }
  
  export const summarySectionVariantsReduced = {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: transitionRevealReduced },
  }
  
  export const commitmentCardVariantsReduced = summarySectionVariantsReduced
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // WAITING SCREEN TRANSITIONS
  //
  // The WaitingScreen fades into the ChatScreen when both intakes are done.
  // This is the single most important transition in the whole app —
  // it is the moment the session actually begins. It deserves the most
  // deliberate, anticipation-building treatment.
  //
  // The waiting canvas breathes out (opacity decreases) while the chat
  // canvas breathes in (opacity increases) — a single continuous breath
  // bridging the two states.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const waitingTransitionVariants = {
    visible: {
      opacity:    1,
      transition: transitionStone,
    },
    exit: {
      opacity:    0,
      scale:      1.015,  // the canvas very slightly expands as it fades — like a held breath releasing
      transition: {
        type:     'tween',
        ease:     easing.stone,  // imported at top via motionTokens
        duration: 0.8,           // 800ms — longer than standard vanish, honoring the moment
      },
    },
  }
  
  export const waitingTransitionVariantsReduced = {
    visible: { opacity: 1, transition: transitionRevealReduced },
    exit:    { opacity: 0, transition: transitionVanishReduced },
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FEEDBACK STAR RATING
  //
  // The five star icons on FeedbackScreen arrive in a fast cascade.
  // On selection, the selected star and all stars to its left pulse
  // once — a single, confident acknowledgment of the choice.
  // ─────────────────────────────────────────────────────────────────────────────
  
  export const starVariants = {
    unselected: {
      scale:   1,
      opacity: 0.35,
    },
    selected: {
      scale:      [1, 1.18, 1],   // a single confident pulse, not a loop
      opacity:    1,
      transition: {
        type:       'tween',
        ease:       easing.settle,
        duration:   0.28,
        times:      [0, 0.4, 1],
      },
    },
    hover: {
      scale:      1.08,
      opacity:    0.7,
      transition: {
        type:     'tween',
        ease:     easing.settle,
        duration: 0.15,
      },
    },
  }
  
  export const starVariantsReduced = {
    unselected: { opacity: 0.35 },
    selected:   { opacity: 1, transition: transitionRevealReduced },
    hover:      { opacity: 0.65 },
  }
