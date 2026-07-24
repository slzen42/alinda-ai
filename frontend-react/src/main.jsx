/**
 * src/main.jsx
 *
 * The ignition sequence. The entry point where React mounts onto the DOM.
 *
 * This file has three jobs and exactly three jobs:
 *   1. Wrap the app in an error boundary so clinical crashes are handled gracefully
 *   2. Wrap in React.StrictMode for development quality assurance
 *   3. Mount React onto the #root div in index.html
 *
 * Everything else — theme, session, routing, canvas — lives in App.jsx.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GLOBAL ERROR BOUNDARY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * In a clinical context, the "white screen of death" is genuinely harmful.
 * A blank screen during a moment of vulnerability reads as the app
 * abandoning the user. The error boundary catches fatal React tree errors
 * and renders a calm, branded fallback instead.
 *
 * The fallback deliberately:
 *   - Uses the marble base color (not default white) so it still feels like Alinda
 *   - Does not show technical error details to the user
 *   - Logs the full error to the console for debugging
 *   - Offers a single clear action: refresh to restore the room
 *   - Uses an inline style (not Tailwind classes) because if the CSS bundle
 *     failed to load, Tailwind classes would be meaningless
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REACT STRICT MODE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * StrictMode intentionally double-invokes every useEffect in development,
 * which is exactly why we built useWebSocket with the cleanedUpRef pattern.
 * If a new component has an effect that fires twice and produces visible
 * artifacts, StrictMode will catch it immediately rather than allowing it
 * to ship to production where it would be harder to reproduce.
 *
 * StrictMode is automatically disabled in production builds by Vite.
 */

import React           from 'react'
import ReactDOM        from 'react-dom/client'
import App             from './App'
import './index.css'


// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL ERROR BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError:   false,
      errorType:  null,
    }
  }

  static getDerivedStateFromError(error) {
    // Classify the error type so we can show a slightly different message
    // for network vs. render vs. unknown errors
    const message = error?.message?.toLowerCase() ?? ''
    let errorType = 'unknown'
    if (message.includes('chunk') || message.includes('loading'))   errorType = 'load'
    if (message.includes('network') || message.includes('fetch'))   errorType = 'network'
    return { hasError: true, errorType }
  }

  componentDidCatch(error, info) {
    // Log to console in all environments — developers and Render's log
    // stream both need to see this
    console.error('[Alinda] Fatal error boundary caught:', error)
    console.error('[Alinda] Component stack:', info?.componentStack)
  }

  handleRefresh() {
    // Preserve the room URL query parameters so the user can re-enter
    // the same room after refreshing, rather than having to re-enter the code
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const isLoadError = this.state.errorType === 'load'

    // Inline styles only — CSS bundle may have failed to load
    const styles = {
      root: {
        position:        'fixed',
        inset:           0,
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: '#EDEAE3',   // --surface-base Olympian
        padding:         '2rem',
        fontFamily:      '"DM Sans", system-ui, sans-serif',
        textAlign:       'center',
      },
      wordmark: {
        fontFamily:    '"Cormorant Garamond", Georgia, serif',
        fontSize:      '2rem',
        fontWeight:    '300',
        letterSpacing: '0.12em',
        color:         '#2E2B27',
        marginBottom:  '2rem',
      },
      heading: {
        fontSize:     '1.125rem',
        fontWeight:   '400',
        color:        '#2E2B27',
        lineHeight:   '1.6',
        maxWidth:     '28rem',
        marginBottom: '0.75rem',
      },
      body: {
        fontSize:     '0.9375rem',
        color:        '#6B645C',
        lineHeight:   '1.6',
        maxWidth:     '26rem',
        marginBottom: '2.5rem',
      },
      button: {
        display:         'inline-block',
        padding:         '0.75rem 2rem',
        backgroundColor: '#7A8C6E',   // --accent-bronze
        color:           '#F2EFE9',
        fontFamily:      '"DM Sans", system-ui, sans-serif',
        fontSize:        '0.9375rem',
        fontWeight:      '400',
        letterSpacing:   '0.04em',
        borderRadius:    '0.5rem',
        border:          'none',
        cursor:          'pointer',
      },
    }

    const message = isLoadError
      ? 'A resource failed to load. This sometimes happens on slow connections.'
      : 'Alinda experienced an interruption.'

    return (
      <div style={styles.root}>
        <div style={styles.wordmark}>Alinda</div>
        <p style={styles.heading}>{message}</p>
        <p style={styles.body}>
          Your session and conversation history are safe.
          Please refresh to restore the room exactly as you left it.
        </p>
        <button
          style={styles.button}
          onClick={this.handleRefresh}
        >
          Restore the room
        </button>
      </div>
    )
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// MOUNT
// ─────────────────────────────────────────────────────────────────────────────

const root = ReactDOM.createRoot(document.getElementById('root'))

root.render(
  <React.StrictMode>
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  </React.StrictMode>
)