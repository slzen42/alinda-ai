/**
 * src/paintings/index.js
 *
 * The painting registry. Maps painting keys to their parameter objects
 * and provides the getPainting() resolver used by LivingCanvas.jsx.
 */

import gentle    from './gentle'
import direct    from './direct'
import practical from './practical'
import balanced  from './balanced'

const PAINTINGS = { gentle, direct, practical, balanced }

export const DEFAULT_PAINTING_PARAMS = balanced

/**
 * Returns the painting params for a given style key.
 * Falls back to balanced for any unknown key.
 *
 * @param {'gentle' | 'direct' | 'practical' | 'balanced'} key
 * @returns {Object}
 */
export function getPainting(key) {
  return PAINTINGS[key] ?? balanced
}

/**
 * Returns all painting keys — used by the style selector on IntakeScreen.
 * @returns {string[]}
 */
export function getPaintingKeys() {
  return Object.keys(PAINTINGS)
}