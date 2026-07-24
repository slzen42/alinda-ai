/**
 * src/components/ui/ConnectionToast.jsx
 *
 * The connection health indicator. A small, unobtrusive badge that
 * appears at the very top of the screen when the WebSocket is degraded
 * or offline. Disappears automatically when connectivity restores.
 *
 * Deliberately not alarming — therapy should not be interrupted by a
 * big red error banner. The badge is small, warm, and informational.
 */

import { motion } from 'framer-motion'

export default function ConnectionToast({ status }) {
  const isDegraded = status === 'degraded'
  const isOffline  = status === 'offline'

  const message = isOffline
    ? 'No connection — your messages are held safely'
    : 'Reconnecting\u2026'

  return (
    <div className="flex justify-center pt-2 px-4">
      <div className="
        inline-flex items-center gap-2 px-3 py-1.5
        bg-surface-overlay/90 text-text-secondary
        text-xs tracking-wide rounded-full
        shadow-ambient border border-surface-edge
      ">
        {/* Pulsing dot */}
        <motion.span
          className={`
            w-1.5 h-1.5 rounded-full
            ${isOffline ? 'bg-crisis' : 'bg-terracotta'}
          `}
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        {message}
      </div>
    </div>
  )
}