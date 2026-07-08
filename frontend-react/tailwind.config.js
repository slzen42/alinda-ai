/** @type {import('tailwindcss').Config} */
export default {
    // ── Dark mode strategy ─────────────────────────────────────────────────────
    // 'class' tells Tailwind to apply dark: variants when the 'dark' class
    // is present on <html>. This is set by the IIFE in index.html before
    // first paint, and updated by hooks/useTheme.js when the user toggles.
    // This is the only line that makes the entire light/dark system work.
    darkMode: 'class',
  
    content: [
      './index.html',
      './src/**/*.{js,jsx}',
    ],
  
    theme: {
      // ── Reset to zero ─────────────────────────────────────────────────────
      // By overriding (not extending) these top-level keys, we prevent any
      // Tailwind default from leaking into the design — no slate-500, no
      // shadow-md, no font-sans pointing to ui-sans-serif. Every token
      // that exists in this app is declared explicitly below.
      colors: {
        // All semantic colors are CSS custom properties defined in
        // index.css under :root (Olympian light) and .dark (Titan dark).
        // Using variables here means a single class like bg-surface-base
        // automatically responds to the dark class — no dark: prefix
        // needed for semantic tokens. Only use dark: for one-off overrides
        // that aren't worth adding to the token system.
        transparent: 'transparent',
        current:     'currentColor',
  
        // ── Surfaces ─────────────────────────────────────────────────────
        // The "stone" the UI is made of.
        surface: {
          base:    'var(--surface-base)',    // ground plane — the marble itself
          raised:  'var(--surface-raised)',  // cards, input fields — slightly lighter/darker
          overlay: 'var(--surface-overlay)', // overlays, modals — most contrast
          edge:    'var(--surface-edge)',    // subtle borders, dividers
        },
  
        // ── Text ──────────────────────────────────────────────────────────
        text: {
          primary:   'var(--text-primary)',   // body copy, message text
          secondary: 'var(--text-secondary)', // labels, captions, stage pill
          muted:     'var(--text-muted)',     // placeholders, disabled state
          inverse:   'var(--text-inverse)',   // text on dark surfaces in light mode (rare)
        },
  
        // ── Accent: Terracotta ────────────────────────────────────────────
        // The warm fired-clay tone — used for the room code display,
        // the concrete commitment card, interactive focus rings.
        // Olympian: #C17A5B / Titan: #A0604A
        terracotta: {
          DEFAULT: 'var(--accent-terracotta)',
          soft:    'var(--accent-terracotta-soft)',   // very low opacity fills
          strong:  'var(--accent-terracotta-strong)', // text on light surfaces
        },
  
        // ── Accent: Bronze ────────────────────────────────────────────────
        // The oxidised bronze-green — used for Alinda's presence indicators,
        // the session progress fill, the turn glow.
        // Olympian: #7A8C6E / Titan: #8FA88E (more luminous against dark ground)
        bronze: {
          DEFAULT: 'var(--accent-bronze)',
          soft:    'var(--accent-bronze-soft)',
          strong:  'var(--accent-bronze-strong)',
        },
  
        // ── State: Crisis / Safety ────────────────────────────────────────
        // Used exclusively in CrisisOverlay and SafetyBanner.
        // Kept deliberately muted — the design decision was that crisis
        // states should feel still and quiet, not alarming red.
        // Olympian: #8B7355 (aged ochre) / Titan: #A08060
        crisis: {
          DEFAULT: 'var(--crisis)',
          soft:    'var(--crisis-soft)',
        },
      },
  
      // ── Typography ─────────────────────────────────────────────────────────
      fontFamily: {
        // Carved, lapidary serif — used for the Alinda wordmark, screen
        // headers, and section titles. Cormorant Garamond carries the
        // inscriptional quality of ancient stonecutting without reading
        // as a costume.
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
  
        // Clean humanist sans — used for all body copy, UI labels,
        // message text, and input fields. DM Sans is precise without
        // feeling corporate; it pairs well with Cormorant's elegance
        // without competing with it.
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
  
      fontSize: {
        // Named scale, not arbitrary numbers — every component picks from
        // this list. The values are chosen for readability at arm's length
        // on a phone screen (nothing smaller than 13px in use), while the
        // larger sizes carry the "monumentally calm" quality of the Greek
        // typography reference.
        'xs':   ['0.8125rem', { lineHeight: '1.5' }],   // 13px — captions only
        'sm':   ['0.9375rem', { lineHeight: '1.5' }],   // 15px — secondary labels
        'base': ['1.0625rem', { lineHeight: '1.6' }],   // 17px — body / message text
        'lg':   ['1.1875rem', { lineHeight: '1.5' }],   // 19px — large labels
        'xl':   ['1.375rem',  { lineHeight: '1.4' }],   // 22px — section headers
        '2xl':  ['1.75rem',   { lineHeight: '1.3' }],   // 28px — screen titles
        '3xl':  ['2.25rem',   { lineHeight: '1.2' }],   // 36px — the wordmark
        '4xl':  ['3rem',      { lineHeight: '1.1' }],   // 48px — hero moments only
      },
  
      fontWeight: {
        light:   '300',
        normal:  '400',
        medium:  '500',
        // No bold/extrabold — the design language communicates weight
        // through scale and spacing, not font weight. Heavy weights
        // would undermine the "carved into stone" quality.
      },
  
      letterSpacing: {
        tight:   '-0.01em',
        normal:  '0em',
        wide:    '0.06em',   // used for all-caps labels (stage pill, section headers)
        widest:  '0.14em',   // used for the wordmark only
      },
  
      // ── Spacing ────────────────────────────────────────────────────────────
      // Generous spacing scale — the museum-walls principle applied to layout.
      // Components breathe; nothing is cramped. Named in a 4px base grid.
      spacing: {
        px:   '1px',
        0:    '0',
        0.5:  '2px',
        1:    '4px',
        1.5:  '6px',
        2:    '8px',
        2.5:  '10px',
        3:    '12px',
        3.5:  '14px',
        4:    '16px',
        5:    '20px',
        6:    '24px',
        7:    '28px',
        8:    '32px',
        10:   '40px',
        12:   '48px',
        14:   '56px',
        16:   '64px',
        20:   '80px',
        24:   '96px',
        28:   '112px',
        32:   '128px',
      },
  
      // ── Border radius ──────────────────────────────────────────────────────
      borderRadius: {
        none:    '0',
        sm:      '4px',
        DEFAULT: '8px',
        md:      '12px',
        lg:      '16px',
        xl:      '20px',
        full:    '9999px',   // for the stage pill, glow indicators
        // Asymmetric bubble radii are handled in component CSS directly
        // (MessageBubble.jsx uses inline style or a custom class for the
        // one soft corner) — Tailwind's single-value radius can't express
        // per-corner asymmetry natively without plugins.
      },
  
      // ── Shadows ────────────────────────────────────────────────────────────
      // Only stone-appropriate shadows exist here. Every Tailwind default
      // shadow (which reads as modern web / Material Design) is replaced.
      // Components that need a modern drop-shadow will not find one — this
      // is intentional.
      boxShadow: {
        none:           'none',
        // Debossed — for inputs, cards pressed into the marble surface
        'stone-inset':  'inset 0 1px 4px 0 var(--shadow-stone)',
        'stone-inset-deep': 'inset 0 2px 8px 0 var(--shadow-stone-deep)',
        // Ambient lift — for floating elements (overlays, the StagePill)
        // Extremely soft, warm, directional downward only
        'ambient':      '0 2px 16px 0 var(--shadow-ambient)',
        // Turn glow — the floor-light effect under the active speaker
        // Spreads upward, not downward (negative y-offset on the spread)
        'glow-turn':    '0 -12px 40px 0 var(--glow-turn)',
        // Alinda presence — the bronze pulse under her name during free_chat
        'glow-alinda':  '0 0 20px 0 var(--glow-alinda)',
      },
  
      // ── No transition presets ─────────────────────────────────────────────
      // All transitions are handled by Framer Motion (animations/transitions.js)
      // with the exact curves from animations/motionTokens.js. Tailwind's
      // built-in transition classes would produce generic, bouncy-feeling
      // results inconsistent with "heavy-stone, no elastic" principle.
      transitionDuration: {},
      transitionTimingFunction: {},
      transitionDelay: {},
      animation: {},
      keyframes: {},
  
      extend: {
        // ── Viewport height — dvh ─────────────────────────────────────────
        // dvh (dynamic viewport height) shrinks when the mobile browser's
        // address bar is visible and expands when it hides. This ensures
        // the app always fills exactly the visible screen without causing
        // scroll on the body — critical for the chat input staying pinned
        // above the keyboard on mobile Safari.
        height: {
          'dvh':   '100dvh',
          'dvh-90': '90dvh',
          'dvh-80': '80dvh',
        },
        minHeight: {
          'dvh': '100dvh',
        },
        maxHeight: {
          'dvh': '100dvh',
        },
  
        // ── Backdrop blur ─────────────────────────────────────────────────
        // Used for the frosted-glass quality of the pause and crisis
        // overlays — a heavy blur over the canvas feels like frosted
        // marble, not like a modern UI modal.
        backdropBlur: {
          'stone': '12px',
          'stone-heavy': '24px',
        },
      },
    },
  
    plugins: [],
  }