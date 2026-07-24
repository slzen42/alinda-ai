/**
 * src/utils/formatTime.js
 *
 * Temporal formatting with clinical sensitivity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLINICAL PHILOSOPHY
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Timestamps in therapy are emotional signals, not administrative metadata.
 * The difference between "Sent at 20:55:14" and "Just now" is the difference
 * between a ledger entry and a human presence. Every formatting decision here
 * prioritizes warmth, immediacy, and the user's local experience over
 * technical precision.
 *
 * The specific decisions:
 *
 * SECONDS ARE OMITTED IN ALL CHAT DISPLAY:
 *   Seconds induce urgency. In a live therapy session, urgency is the enemy.
 *   No timestamp displayed to the user in the chat transcript will ever
 *   include seconds. The session timer (handled separately in useSessionTimer)
 *   does display seconds — but only because accurate timekeeping is a
 *   clinical necessity there, not a display choice.
 *
 * "JUST NOW" FOR THE FIRST MINUTE:
 *   A message sent 45 seconds ago is not "8:55 PM." It is "Just now."
 *   This keeps the user in the present moment rather than tracking the clock.
 *   The threshold is 60 seconds — one full minute before a clock time appears.
 *
 * TODAY / YESTERDAY ANCHORING:
 *   "July 23rd, 2026" is archival. "Today at 4:15 PM" is alive.
 *   Anything from today is anchored to "Today." Yesterday is "Yesterday."
 *   Everything older gets a full date.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PERFORMANCE: Intl FORMATTERS ARE CACHED
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `new Intl.DateTimeFormat()` is expensive. In a chat transcript with 80
 * messages, calling it 80 times per render would drop frames on mid-range
 * phones. All formatters are instantiated once at module load time and
 * cached. After the first call, formatting 80 timestamps costs only the
 * string formatting — no object construction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LOCALIZATION
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * undefined is passed as the locale to all Intl constructors — this tells
 * the browser to use the user's system locale automatically. Partner A in
 * New York sees "8:55 PM"; Partner B in Kolkata sees "8:25 AM". Both are
 * reading the same UTC timestamp from the server, displayed in their own
 * local time, with no configuration required.
 */


// ─────────────────────────────────────────────────────────────────────────────
// CACHED FORMATTERS
//
// Instantiated once at module load. These are the only Intl objects
// created in this file's lifetime.
// ─────────────────────────────────────────────────────────────────────────────

// "8:55 PM" or "20:55" depending on locale — no seconds
const _timeFormatter = new Intl.DateTimeFormat(undefined, {
    hour:   'numeric',
    minute: '2-digit',
    // No 'second' — intentionally omitted everywhere in the chat UI
  })
  
  // "8:55 PM" — forced 12-hour for display contexts where 12h is preferred
  // (not used by default; exported for components that need it explicitly)
  const _time12Formatter = new Intl.DateTimeFormat(undefined, {
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  })
  
  // "July 23, 2026" — full date for transcript headers and older messages
  const _fullDateFormatter = new Intl.DateTimeFormat(undefined, {
    year:  'numeric',
    month: 'long',
    day:   'numeric',
  })
  
  // "July 23" — date without year for within-current-year display
  const _shortDateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day:   'numeric',
  })
  
  // "Thu, Jul 23" — compact date for session history lists
  const _compactDateFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  })
  
  // "July 23, 2026 at 8:55 PM" — full date + time for accessibility labels
  const _fullDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    year:   'numeric',
    month:  'long',
    day:    'numeric',
    hour:   'numeric',
    minute: '2-digit',
  })
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * Safely parses a timestamp into a Date object.
   * Returns null if the input is invalid, null, or undefined.
   * Never throws — the caller decides what to do with null.
   *
   * @param {string | number | Date | null | undefined} raw
   * @returns {Date | null}
   */
  function _parse(raw) {
    if (!raw) return null
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw
  
    try {
      const d = new Date(raw)
      return isNaN(d.getTime()) ? null : d
    } catch {
      return null
    }
  }
  
  /**
   * Returns true if two Date objects represent the same calendar day
   * in the local timezone.
   *
   * @param {Date} a
   * @param {Date} b
   */
  function _isSameDay(a, b) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth()    === b.getMonth()    &&
      a.getDate()     === b.getDate()
    )
  }
  
  /**
   * Returns true if the date is yesterday in the local timezone.
   *
   * @param {Date} date
   * @param {Date} now
   */
  function _isYesterday(date, now) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    return _isSameDay(date, yesterday)
  }
  
  /**
   * Returns true if the date is within the current calendar year.
   *
   * @param {Date} date
   * @param {Date} now
   */
  function _isThisYear(date, now) {
    return date.getFullYear() === now.getFullYear()
  }
  
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PRIMARY EXPORTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /**
   * The primary message timestamp formatter.
   *
   * Returns a contextual, warm time string appropriate for chat bubbles:
   *   < 60 seconds ago:    "Just now"
   *   < 24 hours, today:   "8:55 PM"
   *   Yesterday:           "Yesterday, 8:55 PM"
   *   Earlier this year:   "July 23, 8:55 PM"
   *   Older:               "July 23, 2026, 8:55 PM"
   *
   * NEVER includes seconds. NEVER returns an error or NaN.
   * Returns '' on null/invalid input — caller can treat empty as "pending."
   *
   * @param {string | number | Date | null | undefined} timestamp
   * @param {Date} [now] — override for testing; defaults to current time
   * @returns {string}
   */
  export function formatMessageTime(timestamp, now = new Date()) {
    const date = _parse(timestamp)
    if (!date) return ''
  
    const diffMs = now.getTime() - date.getTime()
  
    // Within the last 60 seconds — "Just now"
    if (diffMs >= 0 && diffMs < 60_000) return 'Just now'
  
    // Future timestamps (clock skew, optimistic message with future timestamp)
    // — treat as "Just now" rather than showing a confusing future time
    if (diffMs < 0 && Math.abs(diffMs) < 5_000) return 'Just now'
  
    const time = _timeFormatter.format(date)
  
    // Today — only the time
    if (_isSameDay(date, now)) return time
  
    // Yesterday — "Yesterday, 8:55 PM"
    if (_isYesterday(date, now)) return `Yesterday, ${time}`
  
    // This year — "July 23, 8:55 PM"
    if (_isThisYear(date, now)) return `${_shortDateFormatter.format(date)}, ${time}`
  
    // Older — "July 23, 2026, 8:55 PM"
    return `${_fullDateFormatter.format(date)}, ${time}`
  }
  
  /**
   * Returns only the time portion of a timestamp.
   * Used for message groups where the date has already been established
   * by a date separator above the group.
   *
   *   "8:55 PM"
   *
   * @param {string | number | Date | null | undefined} timestamp
   * @returns {string}
   */
  export function formatTimeOnly(timestamp) {
    const date = _parse(timestamp)
    if (!date) return ''
    return _timeFormatter.format(date)
  }
  
  /**
   * Returns a short relative time string for message lists and recent activity.
   * More granular than formatMessageTime for moments just past:
   *
   *   < 60 seconds:   "Just now"
   *   < 60 minutes:   "5 min ago"
   *   < 24 hours:     "3 hours ago"
   *   Yesterday:      "Yesterday"
   *   This year:      "July 23"
   *   Older:          "July 23, 2026"
   *
   * @param {string | number | Date | null | undefined} timestamp
   * @param {Date} [now]
   * @returns {string}
   */
  export function formatRelativeTime(timestamp, now = new Date()) {
    const date = _parse(timestamp)
    if (!date) return ''
  
    const diffMs      = Math.max(0, now.getTime() - date.getTime())
    const diffSeconds = Math.floor(diffMs / 1000)
    const diffMinutes = Math.floor(diffSeconds / 60)
    const diffHours   = Math.floor(diffMinutes / 60)
  
    if (diffSeconds < 60)  return 'Just now'
    if (diffMinutes < 60)  return `${diffMinutes} min ago`
    if (diffHours < 24)    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`
    if (_isYesterday(date, now)) return 'Yesterday'
    if (_isThisYear(date, now))  return _shortDateFormatter.format(date)
  
    return _fullDateFormatter.format(date)
  }
  
  /**
   * Formats a date for session history list entries (FeedbackScreen, SummaryScreen).
   * Shows the date in a compact, human-readable form:
   *
   *   Today:         "Today at 8:55 PM"
   *   Yesterday:     "Yesterday at 8:55 PM"
   *   This week:     "Thu, Jul 23 at 8:55 PM"
   *   Older:         "July 23, 2026"
   *
   * @param {string | number | Date | null | undefined} timestamp
   * @param {Date} [now]
   * @returns {string}
   */
  export function formatSessionDate(timestamp, now = new Date()) {
    const date = _parse(timestamp)
    if (!date) return ''
  
    const time = _timeFormatter.format(date)
  
    if (_isSameDay(date, now))      return `Today at ${time}`
    if (_isYesterday(date, now))    return `Yesterday at ${time}`
  
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
    if (diffDays < 7) return `${_compactDateFormatter.format(date)} at ${time}`
    if (_isThisYear(date, now)) return _fullDateFormatter.format(date)
  
    return _fullDateFormatter.format(date)
  }
  
  /**
   * Formats a session duration in seconds to a human-readable string.
   * Used on the SessionSummaryScreen to show "Session duration: 52 minutes."
   *
   *   0 → ""
   *   45 → "less than a minute"
   *   90 → "1 minute"
   *   3720 → "1 hour 2 minutes"
   *
   * @param {number} totalSeconds
   * @returns {string}
   */
  export function formatDuration(totalSeconds) {
    if (!totalSeconds || totalSeconds <= 0) return ''
  
    const totalMinutes = Math.round(totalSeconds / 60)
    if (totalMinutes === 0) return 'less than a minute'
  
    const hours   = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
  
    if (hours === 0) {
      return `${totalMinutes} minute${totalMinutes !== 1 ? 's' : ''}`
    }
  
    const hoursStr   = `${hours} hour${hours !== 1 ? 's' : ''}`
    if (minutes === 0) return hoursStr
  
    const minutesStr = `${minutes} minute${minutes !== 1 ? 's' : ''}`
    return `${hoursStr} ${minutesStr}`
  }
  
  /**
   * Formats seconds into MM:SS for the session timer display.
   * Used directly by useSessionTimer's display values.
   *
   *   0    → "0:00"
   *   65   → "1:05"
   *   3600 → "60:00"
   *
   * @param {number} totalSeconds
   * @returns {string}
   */
  export function formatCountdown(totalSeconds) {
    const clamped = Math.max(0, Math.floor(totalSeconds))
    const m = Math.floor(clamped / 60)
    const s = clamped % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  
  /**
   * Returns a full accessible datetime string for use in aria-label attributes.
   * Screen readers should speak the full, unambiguous date and time.
   *
   *   "July 23, 2026 at 8:55 PM"
   *
   * @param {string | number | Date | null | undefined} timestamp
   * @returns {string}
   */
  export function formatAccessibleDateTime(timestamp) {
    const date = _parse(timestamp)
    if (!date) return ''
    return _fullDateTimeFormatter.format(date)
  }
  
  /**
   * Returns true if a timestamp is "recent" — within the last N seconds.
   * Used by TypingIndicator to decide whether to treat an incoming
   * timestamp as "just happened" rather than delayed.
   *
   * @param {string | number | Date | null | undefined} timestamp
   * @param {number} [withinSeconds]
   * @returns {boolean}
   */
  export function isRecent(timestamp, withinSeconds = 30) {
    const date = _parse(timestamp)
    if (!date) return false
    return (Date.now() - date.getTime()) < withinSeconds * 1000
  }
  
  /**
   * Checks if two timestamps fall on the same calendar day.
   * Used by the chat transcript to decide whether to render a
   * date separator between two consecutive messages.
   *
   * @param {string | number | Date | null | undefined} a
   * @param {string | number | Date | null | undefined} b
   * @returns {boolean}
   */
  export function isSameCalendarDay(a, b) {
    const da = _parse(a)
    const db = _parse(b)
    if (!da || !db) return false
    return _isSameDay(da, db)
  }
  
  /**
   * Formats a date as a chat section separator — the label that appears
   * between message groups on different days.
   *
   *   Today
   *   Yesterday
   *   Thursday, July 23
   *   July 23, 2026
   *
   * @param {string | number | Date | null | undefined} timestamp
   * @param {Date} [now]
   * @returns {string}
   */
  export function formatDateSeparator(timestamp, now = new Date()) {
    const date = _parse(timestamp)
    if (!date) return ''
  
    if (_isSameDay(date, now))   return 'Today'
    if (_isYesterday(date, now)) return 'Yesterday'
    if (_isThisYear(date, now)) {
      // "Thursday, July 23"
      return new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        month:   'long',
        day:     'numeric',
      }).format(date)
    }
  
    return _fullDateFormatter.format(date)
  }