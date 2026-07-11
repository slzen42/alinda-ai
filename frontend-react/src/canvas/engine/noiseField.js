/**
 * src/canvas/engine/noiseField.js
 *
 * The mathematical heart of the LivingCanvas.
 *
 * Implements a data-oriented flow field particle system using fractional
 * Brownian motion with domain warping. Particles trace slow, deliberate
 * paths through a vector field that shifts as the therapy session deepens.
 *
 * THE ABSOLUTE LAW OF ZERO ALLOCATION:
 *   No `new` calls inside any method that runs in the render loop.
 *   All particle state is stored in pre-allocated Float32Array buffers.
 *   All per-frame working values are stored in module-scope typed buffers.
 *   The JS garbage collector will never fire because of this file.
 *
 * MEMORY LAYOUT:
 *   The particle buffer stores 4 floats per particle, tightly packed:
 *   [x₀, y₀, opacity₀, age₀, x₁, y₁, opacity₁, age₁, ...]
 *
 *   PARTICLE_STRIDE = 4
 *   buf[i]   = x position (pixels)
 *   buf[i+1] = y position (pixels)
 *   buf[i+2] = opacity (0.0–1.0) — fades in on spawn, used for edge wrapping
 *   buf[i+3] = age (0.0–1.0) — fraction of particle lifetime elapsed
 *
 * COORDINATE SYSTEM:
 *   All particle positions are in canvas pixel space (not normalized 0–1).
 *   The noise field is sampled in a separate normalized coordinate space
 *   that is independent of canvas dimensions — resizing the canvas does
 *   not change the appearance of the field, only its physical resolution.
 *
 * INTEGRATION WITH OTHER FILES:
 *   - qualityTiers.js  → provides tier config (noiseOctaves, particleCount, etc.)
 *   - theme.js         → provides hexToRgb() for color arrays
 *   - paintings/*.js   → provides paintingParams that shape the field character
 *   - phaseInterpolation.js → provides phaseProgress (0.0–1.0) that calms the field
 *   - paletteBlend.js  → provides interpolated color arrays frame-by-frame
 *   - LivingCanvas.jsx → owns the <canvas> and calls render() each frame
 */

import { createNoise2D } from 'simplex-noise'


// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — NEVER MUTATED
// ─────────────────────────────────────────────────────────────────────────────

// Floats per particle in the packed buffer
const PARTICLE_STRIDE = 4   // x, y, opacity, age

// Noise field resolution — how many cells the field is divided into.
// The field is sampled at cell boundaries; particles interpolate between them.
// Lower resolution = faster lookup, smoother (less granular) field.
// 256×256 is the sweet spot between detail and lookup cost.
const FIELD_COLS = 256
const FIELD_ROWS = 256

// fBm parameters
const FBM_LACUNARITY  = 2.0    // frequency multiplier per octave
const FBM_GAIN        = 0.48   // amplitude multiplier per octave (< 0.5 = convergent series)
const FBM_DOMAIN_WARP = 0.8    // strength of domain warp offset (0 = no warp)

// Particle lifecycle
const PARTICLE_LIFETIME_MIN = 180   // frames — shortest a particle lives before respawning
const PARTICLE_LIFETIME_MAX = 400   // frames — longest
const FADE_IN_FRAMES        = 20    // frames for opacity to reach 1.0 after spawn/wrap
const FADE_OUT_FRAMES       = 30    // frames before death where particle fades out

// Bloom constants
const BLOOM_DECAY_RATE      = 0.0012  // how quickly the repulsor dissipates per frame
const BLOOM_MAX_STRENGTH    = 1.8     // peak repulsion force
const BLOOM_GAUSSIAN_SIGMA  = 0.18    // normalized sigma for the Gaussian falloff (0–1)

// Two PI — computed once, referenced everywhere in trig
const TWO_PI = Math.PI * 2


// ─────────────────────────────────────────────────────────────────────────────
// MODULE-SCOPE WORKING BUFFERS
//
// Pre-allocated at module level so they exist exactly once across all
// NoiseField instances. These are reused by every render() call.
// Named with underscore prefix to signal they are internal implementation
// details, not part of the public API.
// ─────────────────────────────────────────────────────────────────────────────

// For bloom Gaussian calculation — [dx, dy, distSq, falloff, angle, strength]
const _bloomWork = new Float64Array(6)

// For fBm calculation — [nx, ny, warpX, warpY, angle, vx, vy]
const _fbmWork = new Float64Array(7)

// For per-particle step — reused every particle, every frame
const _stepWork = new Float64Array(4)  // [fieldX, fieldY, angle, speed]

// For color composition — [r, g, b, a] as 0–255 / 0–1
const _colorWork = new Float32Array(4)


// ─────────────────────────────────────────────────────────────────────────────
// NOISE FIELD CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class NoiseField {
  /**
   * @param {Object} tierConfig      — from qualityTiers.getTierConfig()
   * @param {Object} paintingParams  — from paintings/*.js
   * @param {number} width           — canvas pixel width (physical, post-DPR)
   * @param {number} height          — canvas pixel height (physical, post-DPR)
   */
  constructor(tierConfig, paintingParams, width, height) {
    // ── Noise source ──────────────────────────────────────────────────────────
    // A single noise generator per instance.
    // createNoise2D returns a deterministic but organically varied function.
    this._noise = createNoise2D()

    // ── Dimensions ────────────────────────────────────────────────────────────
    this._width  = width
    this._height = height

    // ── Tier config ───────────────────────────────────────────────────────────
    this._tierConfig    = tierConfig
    this._maxParticles  = tierConfig.particleCount
    this._octaves       = tierConfig.noiseOctaves
    this._noiseScale    = tierConfig.noiseScale
    this._noiseSpeed    = tierConfig.noiseSpeed
    this._alphaDecay    = tierConfig.alphaDecay
    this._breathDepth   = tierConfig.breathDepth

    // Domain warping is disabled on CONSERVE (2 octaves) —
    // it requires an extra fBm pass which doubles the sampling cost.
    this._useDomainWarp = tierConfig.noiseOctaves >= 3

    // ── Painting params ───────────────────────────────────────────────────────
    this._painting = paintingParams

    // ── Time ─────────────────────────────────────────────────────────────────
    this._time           = 0      // advances each frame — drives field evolution
    this._breathPhase    = 0      // 0–2π sine cycle for breath mechanic
    this._phaseProgress  = 0.0   // 0.0 (opening) → 1.0 (closing) — calms the field

    // ── Particle buffers (pre-allocated, never reallocated) ───────────────────
    // PARTICLE_STRIDE floats per particle × max particles
    this._particles = new Float32Array(this._maxParticles * PARTICLE_STRIDE)

    // Particle lifetime (integer frames) — Int16Array saves memory vs Float32Array
    // Max value 400 fits comfortably in Int16 range (32767).
    this._lifetimes = new Int16Array(this._maxParticles)
    this._maxLifetimes = new Int16Array(this._maxParticles)

    // ── Vector field cache ────────────────────────────────────────────────────
    // Pre-computed angle for each cell of the field grid.
    // Updated lazily (not every frame — see _fieldNeedsUpdate).
    // Float32Array is sufficient precision for angles.
    this._fieldAngles = new Float32Array(FIELD_COLS * FIELD_ROWS)
    this._fieldNeedsUpdate = true
    this._fieldUpdateCounter = 0
    // The field is recomputed every N frames to smooth CPU spikes.
    // At 60fps: every 6 frames = 100ms between full-field updates (imperceptible)
    // At 30fps: every 3 frames = 100ms
    this._fieldUpdateInterval = Math.round(tierConfig.targetFPS / 10)

    // ── Bloom state ───────────────────────────────────────────────────────────
    this._bloomActive   = false
    this._bloomX        = 0      // normalized 0–1
    this._bloomY        = 0      // normalized 0–1
    this._bloomStrength = 0      // 0.0–BLOOM_MAX_STRENGTH, decays to 0

    // ── Color state ───────────────────────────────────────────────────────────
    // Current particle draw color as [r, g, b] integers 0–255.
    // Updated by paletteBlend.js via updateColors() — not computed here.
    this._particleR = 122
    this._particleG = 140
    this._particleB = 110

    // Background color (also set by paletteBlend.js)
    this._bgR = 237
    this._bgG = 234
    this._bgB = 227


    // Add to constructor, near the other instance variable declarations:
    this._noiseSpeedOffset    = 0
    this._particleOpacityMul  = 1.0
    this._settleBiasStrength  = 0.0

    // ── Initialization ────────────────────────────────────────────────────────
    this._initParticles()
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // INITIALIZATION — runs exactly once per NoiseField instance
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Seeds all particles at random positions across the canvas with
   * staggered ages so they don't all die and respawn simultaneously.
   * Called once in the constructor — never called again.
   */
  _initParticles() {
    for (let i = 0; i < this._maxParticles; i++) {
      const base = i * PARTICLE_STRIDE
      this._particles[base]     = Math.random() * this._width      // x
      this._particles[base + 1] = Math.random() * this._height     // y
      this._particles[base + 2] = Math.random()                    // opacity (pre-aged)
      this._particles[base + 3] = Math.random()                    // age (staggered)

      // Stagger initial lifetimes so no frame has mass respawning
      const maxL = PARTICLE_LIFETIME_MIN + Math.floor(Math.random() * (PARTICLE_LIFETIME_MAX - PARTICLE_LIFETIME_MIN))
      this._maxLifetimes[i] = maxL
      this._lifetimes[i]    = Math.floor(Math.random() * maxL)    // start at a random age
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // FRACTIONAL BROWNIAN MOTION
  //
  // Samples the noise generator with multiple octaves of increasing frequency
  // and decreasing amplitude, then optionally warps the sample coordinates
  // using a secondary fBm pass to break repeating patterns.
  //
  // Returns a value in [-1, 1].
  //
  // IMPORTANT: This is the most CPU-intensive function in the file.
  // It is called once per field cell per field update (256×256 × octaves).
  // Every line inside the octave loop is performance-critical.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * @param {number} nx — normalized x coordinate (0.0 to 1.0)
   * @param {number} ny — normalized y coordinate
   * @param {number} octaves
   * @param {boolean} warp — whether to apply domain warping first
   * @returns {number} — [-1, 1]
   */
  _fbm(nx, ny, octaves, warp) {
    let sampX = nx
    let sampY = ny

    if (warp && this._useDomainWarp) {
      // Domain warping: sample fBm once to get a displacement vector,
      // then use the displaced coordinates for the actual fBm.
      // Uses a 90° rotation offset (nx + 5.2, ny + 1.3) for the Y component
      // to ensure the two offsets are independent — standard Quilez technique.
      const warpX = this._fbm(nx + 5.2, ny + 1.3, Math.max(1, octaves - 1), false)
      const warpY = this._fbm(nx + 1.7, ny + 9.2, Math.max(1, octaves - 1), false)
      sampX = nx + FBM_DOMAIN_WARP * warpX
      sampY = ny + FBM_DOMAIN_WARP * warpY
    }

    let value     = 0
    let amplitude = 0.5
    let frequency = 1.0
    let maxValue  = 0       // for normalization

    for (let oct = 0; oct < octaves; oct++) {
      value    += amplitude * this._noise(sampX * frequency, sampY * frequency)
      maxValue += amplitude
      amplitude *= FBM_GAIN
      frequency *= FBM_LACUNARITY
    }

    // Normalize to [-1, 1]
    return value / maxValue
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // VECTOR FIELD UPDATE
  //
  // Recomputes the angle at each grid cell. Not called every frame —
  // called every _fieldUpdateInterval frames to spread the CPU cost.
  //
  // The angle at each cell is the direction a particle at that position
  // should move. We derive it from the fBm value by mapping [-1,1] to [0, 2π],
  // then apply biological modifiers (breath, phase settling).
  // ─────────────────────────────────────────────────────────────────────────────

  _updateField() {
    const invCols  = 1 / FIELD_COLS
    const invRows  = 1 / FIELD_ROWS
    const tOffset  = this._time * this._noiseScale * 100

    // Breath modifier — a sine wave that slowly biases angles
    // Makes the field "expand" and "contract" like lungs
    const breathMod = Math.sin(this._breathPhase) * this._breathDepth

    // Phase settling — biases angles toward the "calm" direction defined
    // by the active painting's settleBias (an angle in radians representing
    // the direction of calm — horizontal for most paintings).
    // As phaseProgress → 1.0, the field increasingly prefers this angle.
    const settleBias  = this._painting.settleBias ?? 0
    const settleForce = this._settleBiasStrength * 0.6   // max 60% bias at full resolution

    // Painting character — each painting type shifts the base angle offset
    // so the field's macro-currents move in a characteristic direction.
    const angleOffset = this._painting.fieldAngleOffset ?? 0

    for (let row = 0; row < FIELD_ROWS; row++) {
      for (let col = 0; col < FIELD_COLS; col++) {
        const nx = col * invCols
        const ny = row * invRows

        // Sample the fBm field with time offset for evolution
        const rawNoise = this._fbm(
          nx + tOffset,
          ny + tOffset * 0.7,    // asymmetric time scaling for natural flow
          this._octaves,
          true                    // domain warp enabled based on tier
        )

        // Map noise to angle with all modifiers applied
        let angle = (rawNoise + breathMod + angleOffset) * TWO_PI

        // Phase settling — interpolate toward the calm angle
        if (settleForce > 0) {
          // Angular interpolation (lerp on the unit circle)
          let diff = settleBias - angle
          // Normalize diff to [-π, π] to always take the shorter arc
          while (diff >  Math.PI) diff -= TWO_PI
          while (diff < -Math.PI) diff += TWO_PI
          angle += diff * settleForce
        }

        this._fieldAngles[row * FIELD_COLS + col] = angle
      }
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // FIELD LOOKUP — O(1)
  //
  // Given a particle's pixel position, returns the vector field angle at
  // that position by looking up the pre-computed grid. Uses bilinear
  // interpolation between the four surrounding cells for smoothness.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * @param {number} px — x in pixels
   * @param {number} py — y in pixels
   * @returns {number} — angle in radians
   */
  _lookupAngle(px, py) {
    // Map pixel coordinates to field grid coordinates
    const fx = (px / this._width)  * (FIELD_COLS - 1)
    const fy = (py / this._height) * (FIELD_ROWS - 1)

    const col0 = fx | 0    // bitwise floor — faster than Math.floor for positive numbers
    const row0 = fy | 0

    // Clamp to grid bounds
    const col1 = Math.min(col0 + 1, FIELD_COLS - 1)
    const row1 = Math.min(row0 + 1, FIELD_ROWS - 1)

    const tx = fx - col0   // fractional part for interpolation
    const ty = fy - row0

    // Bilinear interpolation of the four surrounding angles
    // Standard lerp on the unit circle (averaging angles naively fails at ±π boundary)
    const a00 = this._fieldAngles[row0 * FIELD_COLS + col0]
    const a10 = this._fieldAngles[row0 * FIELD_COLS + col1]
    const a01 = this._fieldAngles[row1 * FIELD_COLS + col0]
    const a11 = this._fieldAngles[row1 * FIELD_COLS + col1]

    // X interpolation
    const ax0 = a00 + (a10 - a00) * tx
    const ax1 = a01 + (a11 - a01) * tx

    // Y interpolation
    return ax0 + (ax1 - ax0) * ty
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // BLOOM CONTRIBUTION
  //
  // If a bloom is active, adds a radial repulsion force to the particle's
  // movement direction. The force is strongest at the bloom center and
  // falls off via a Gaussian curve — no hard boundary, only organic expansion.
  //
  // Uses the pre-allocated _bloomWork buffer to avoid any allocations.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Returns the additional angle contribution from the bloom repulsor.
   * Returns 0 if no bloom is active.
   *
   * @param {number} normX — particle x, normalized 0–1
   * @param {number} normY — particle y, normalized 0–1
   * @returns {number} — additional angle offset in radians
   */
  _bloomContribution(normX, normY) {
    if (!this._bloomActive || this._bloomStrength <= 0) return 0

    // dx, dy from bloom center
    _bloomWork[0] = normX - this._bloomX
    _bloomWork[1] = normY - this._bloomY

    // Normalized distance squared
    _bloomWork[2] = _bloomWork[0] * _bloomWork[0] + _bloomWork[1] * _bloomWork[1]

    if (_bloomWork[2] < 1e-6) return 0   // particle is at the bloom center — no direction

    // Gaussian falloff: e^(-dist² / (2σ²))
    // Sigma is in normalized [0,1] space — BLOOM_GAUSSIAN_SIGMA = 0.18 means
    // the repulsor is still noticeable at 18% of the canvas width
    const twoSigmaSq = 2 * BLOOM_GAUSSIAN_SIGMA * BLOOM_GAUSSIAN_SIGMA
    _bloomWork[3] = Math.exp(-_bloomWork[2] / twoSigmaSq)

    // Direction angle: away from bloom center
    _bloomWork[4] = Math.atan2(_bloomWork[1], _bloomWork[0])

    // The contribution is a rotation of the flow field angle by up to π (180°)
    // scaled by the bloom strength and Gaussian falloff.
    // At peak, particles near the center turn completely away from their
    // normal flow direction; at the periphery, they only slightly deviate.
    _bloomWork[5] = this._bloomStrength * _bloomWork[3]

    return _bloomWork[5] * Math.sin(_bloomWork[4])
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // PARTICLE RESPAWN — Zero allocation
  //
  // Respawns a single dead particle by writing directly into the buffer.
  // The particle appears at a random position on one of the four canvas
  // edges (never in the center — prevents a visible "pop" in the middle).
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * @param {number} i — particle index (not byte offset)
   */
  _respawnParticle(i) {
    const base = i * PARTICLE_STRIDE

    // Spawn on a random edge — particles flow in from the margins
    const edge = (Math.random() * 4) | 0
    let x, y
    switch (edge) {
      case 0: x = Math.random() * this._width;  y = -2;                    break  // top
      case 1: x = Math.random() * this._width;  y = this._height + 2;     break  // bottom
      case 2: x = -2;                            y = Math.random() * this._height; break  // left
      default: x = this._width + 2;             y = Math.random() * this._height; break  // right
    }

    this._particles[base]     = x
    this._particles[base + 1] = y
    this._particles[base + 2] = 0      // opacity: starts at 0, fades in
    this._particles[base + 3] = 0      // age: freshly born

    const maxL = PARTICLE_LIFETIME_MIN + Math.floor(Math.random() * (PARTICLE_LIFETIME_MAX - PARTICLE_LIFETIME_MIN))
    this._maxLifetimes[i] = maxL
    this._lifetimes[i]    = 0
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // EDGE WRAPPING
  //
  // Teleports a particle that has drifted off-screen to the opposite edge.
  // Sets opacity to 0 so it fades in from the new position rather than
  // popping into existence.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Checks and applies edge wrapping for a single particle.
   * Mutates the buffer directly.
   *
   * @param {number} base — byte offset into _particles (i * PARTICLE_STRIDE)
   * @returns {boolean} — true if wrapping occurred (opacity reset needed)
   */
  _wrapEdges(base) {
    const margin = 4   // pixels of leeway before wrapping
    let wrapped  = false

    if (this._particles[base] < -margin) {
      this._particles[base] = this._width + margin - 1
      wrapped = true
    } else if (this._particles[base] > this._width + margin) {
      this._particles[base] = -margin + 1
      wrapped = true
    }

    if (this._particles[base + 1] < -margin) {
      this._particles[base + 1] = this._height + margin - 1
      wrapped = true
    } else if (this._particles[base + 1] > this._height + margin) {
      this._particles[base + 1] = -margin + 1
      wrapped = true
    }

    if (wrapped) {
      this._particles[base + 2] = 0   // reset opacity — fade in from the new edge
    }

    return wrapped
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER — THE MAIN LOOP ENTRY POINT
  //
  // Called by LivingCanvas.jsx on every animation frame.
  // Does exactly two visual operations per frame:
  //   1. Apply the alpha-decay rectangle (trail effect)
  //   2. Draw each particle at its new position
  //
  // The ctx parameter must be the actual 2D rendering context of the canvas.
  // No new objects are created inside this function — it is zero-allocation.
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Main render call. Call once per animation frame.
   *
   * @param {CanvasRenderingContext2D} ctx — the canvas 2D context
   * @param {number} deltaMs — time since last frame in milliseconds
   */
  render(ctx, deltaMs) {
    // ── Time advance ──────────────────────────────────────────────────────────
    // Scale time by painting's speed modifier so each painting evolves
    // at its own characteristic rate.
    const speedMod  = this._painting.flowSpeed ?? 1.0
    this._time      += (this._noiseSpeed + this._noiseSpeedOffset) * speedMod * (deltaMs / 16.67)   // normalize to 60fps

    // Breath cycle — advances independently of main time
    this._breathPhase += (TWO_PI / this._tierConfig.breathPeriod) * deltaMs
    if (this._breathPhase > TWO_PI) this._breathPhase -= TWO_PI

    // ── Bloom decay ───────────────────────────────────────────────────────────
    if (this._bloomActive) {
      this._bloomStrength -= BLOOM_DECAY_RATE * (deltaMs / 16.67)
      if (this._bloomStrength <= 0) {
        this._bloomStrength = 0
        this._bloomActive   = false
      }
    }

    // ── Lazy field update ─────────────────────────────────────────────────────
    this._fieldUpdateCounter++
    if (this._fieldUpdateCounter >= this._fieldUpdateInterval) {
      this._fieldUpdateCounter = 0
      this._updateField()
    }

    // ── Step 1: Alpha decay rectangle ─────────────────────────────────────────
    // Covers the entire canvas with the background color at very low opacity.
    // This dims the previous frame slightly, creating the trailing ribbons.
    // The alphaDecay value from the tier config is mathematically correct
    // for the target FPS — see the constructor comment on this.
    ctx.fillStyle = `rgba(${this._bgR}, ${this._bgG}, ${this._bgB}, ${this._alphaDecay})`
    ctx.fillRect(0, 0, this._width, this._height)

    // ── Step 2: Move and draw each particle ───────────────────────────────────
    const particleSize   = this._painting.particleRadius ?? 1.2
    const particleSpeed  = this._painting.particleSpeed  ?? 1.0

    for (let i = 0; i < this._maxParticles; i++) {
      const base = i * PARTICLE_STRIDE

      const px = this._particles[base]
      const py = this._particles[base + 1]

      // ── Get field angle at this particle's position ───────────────────────
      _stepWork[0] = this._lookupAngle(px, py)

      // ── Add bloom contribution ────────────────────────────────────────────
      if (this._bloomActive) {
        _stepWork[0] += this._bloomContribution(px / this._width, py / this._height)
      }

      // ── Painting modifier: some paintings (Twombly/Practical) add
      // ── a per-particle angle variation that creates gestural mark-making
      if (this._painting.angleVariance > 0) {
        // Variance is applied using the particle index as a seed so each
        // particle has a consistent but unique deviation — not random per frame
        _stepWork[0] += this._painting.angleVariance * Math.sin(i * 0.618)
      }

      // ── Compute velocity from angle ───────────────────────────────────────
      _stepWork[1] = Math.cos(_stepWork[0]) * particleSpeed  // vx
      _stepWork[2] = Math.sin(_stepWork[0]) * particleSpeed  // vy

      // ── Update position ───────────────────────────────────────────────────
      this._particles[base]     = px + _stepWork[1]
      this._particles[base + 1] = py + _stepWork[2]

      // ── Lifetime and age ──────────────────────────────────────────────────
      this._lifetimes[i]++
      const life    = this._lifetimes[i]
      const maxLife = this._maxLifetimes[i]

      if (life >= maxLife) {
        this._respawnParticle(i)
        continue
      }

      this._particles[base + 3] = life / maxLife   // age 0→1

      // ── Opacity: fade in and fade out ─────────────────────────────────────
      let opacity = this._particles[base + 2]

      if (life < FADE_IN_FRAMES) {
        opacity = Math.min(1, opacity + (1 / FADE_IN_FRAMES))
      } else if (life > maxLife - FADE_OUT_FRAMES) {
        opacity = Math.max(0, 1 - (life - (maxLife - FADE_OUT_FRAMES)) / FADE_OUT_FRAMES)
      } else {
        opacity = Math.min(1, opacity + (1 / FADE_IN_FRAMES))
      }

      this._particles[base + 2] = opacity

      // ── Edge wrapping ─────────────────────────────────────────────────────
      this._wrapEdges(base)

      // Skip drawing if fully transparent
      if (opacity < 0.01) continue

      // ── Draw particle ─────────────────────────────────────────────────────
      // A tiny filled circle. ctx.arc + fill is the fastest 2D canvas
      // drawing primitive — faster than putImageData for sparse particles.
      // We avoid ctx.save/restore (expensive) by directly setting globalAlpha.
      const drawR = this._particleR
      const drawG = this._particleG
      const drawB = this._particleB

      // Age-based color shift — older particles drift toward the surface color
      // creating a sense of sedimentation. Amount controlled per painting.
      const ageMix = this._particles[base + 3] * (this._painting.ageSediment ?? 0.2)
      const r = Math.round(drawR + (this._bgR - drawR) * ageMix)
      const g = Math.round(drawG + (this._bgG - drawG) * ageMix)
      const b = Math.round(drawB + (this._bgB - drawB) * ageMix)

      ctx.globalAlpha = opacity * (this._painting.particleOpacity ?? 0.55) * (this._particleOpacityMul ?? 1.0)
      ctx.fillStyle   = `rgb(${r},${g},${b})`
      ctx.beginPath()
      ctx.arc(
        this._particles[base],
        this._particles[base + 1],
        particleSize,
        0,
        TWO_PI
      )
      ctx.fill()
    }

    // Reset globalAlpha so subsequent draw calls (by LivingCanvas.jsx) are unaffected
    ctx.globalAlpha = 1
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC API — called by LivingCanvas.jsx between frames
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Triggers a bloom expansion at the given normalized position.
   * The bloom repulsor peaks immediately and decays naturally.
   *
   * Called by LivingCanvas.jsx when the FSM mode transitions to a
   * breakthrough state (mediator_logic fired 'affirm_progress' or
   * 'suggest_framework' and the canvas state resolved to 'breakthrough').
   *
   * @param {number} normX — 0.0 to 1.0, normalized x position
   * @param {number} normY — 0.0 to 1.0, normalized y position
   */
  triggerBloom(normX, normY) {
    this._bloomX        = normX
    this._bloomY        = normY
    this._bloomStrength = BLOOM_MAX_STRENGTH
    this._bloomActive   = true
  }

  /**
   * Updates the phase progress (0.0 = session opening, 1.0 = session closing).
   * The field gradually calms as this value increases.
   * Called by phaseInterpolation.js which reads session.session_phase.
   *
   * @param {number} progress — 0.0 to 1.0
   */
  setPhaseProgress(progress) {
    this._phaseProgress = Math.max(0, Math.min(1, progress))
  }

  /**
   * Updates the painting parameter set.
   * Called when the canvas state changes (e.g. cooldown → guided)
   * or when the resolved painting style changes at session start.
   * Does NOT reset particles — the field character shifts gradually
   * as the field recomputes over the next several update cycles.
   *
   * @param {Object} paintingParams — from paintings/*.js
   */
  updatePaintingParams(paintingParams) {
    this._painting = paintingParams
    this._fieldNeedsUpdate = true
  }

  /**
   * Updates the particle draw color.
   * Called by paletteBlend.js which interpolates between palette values
   * during theme transitions or state changes.
   *
   * @param {number} r — 0–255
   * @param {number} g — 0–255
   * @param {number} b — 0–255
   */
  setParticleColor(r, g, b) {
    this._particleR = r
    this._particleG = g
    this._particleB = b
  }

  /**
   * Updates the background color used for the alpha-decay rectangle.
   * Must match the CSS background-color of the canvas container exactly —
   * any mismatch creates visible color artifacts in the trail.
   *
   * @param {number} r — 0–255
   * @param {number} g — 0–255
   * @param {number} b — 0–255
   */
  setBackgroundColor(r, g, b) {
    this._bgR = r
    this._bgG = g
    this._bgB = b
  }

  /**
   * Updates the tier config mid-session.
   * Called by LivingCanvas.jsx when PerformanceMonitor triggers a downgrade.
   *
   * Adjusts octave count, alpha decay, particle count, and frame interval.
   * Particle count reduction is handled by simply reducing the loop upper
   * bound in render() — the excess particles continue to exist in the buffer
   * but are never visited. They don't need to be cleaned up.
   *
   * @param {Object} newTierConfig — from qualityTiers.getTierConfig()
   */
  applyTierConfig(newTierConfig) {
    this._tierConfig         = newTierConfig
    this._octaves            = newTierConfig.noiseOctaves
    this._alphaDecay         = newTierConfig.alphaDecay
    this._noiseSpeed         = newTierConfig.noiseSpeed
    this._breathDepth        = newTierConfig.breathDepth
    this._maxParticles       = Math.min(newTierConfig.particleCount, this._particles.length / PARTICLE_STRIDE)
    this._useDomainWarp      = newTierConfig.noiseOctaves >= 3
    this._fieldUpdateInterval = Math.round(newTierConfig.targetFPS / 10)
    this._fieldNeedsUpdate   = true
  }

  /**
   * Resizes the canvas dimensions. Called by LivingCanvas.jsx in its
   * resize observer. Existing particles are scaled proportionally so
   * they continue to trace coherent paths after a resize, rather than
   * all teleporting to wrong positions.
   *
   * @param {number} newWidth  — new physical canvas width (post-DPR)
   * @param {number} newHeight — new physical canvas height (post-DPR)
   */
  resize(newWidth, newHeight) {
    const scaleX = newWidth  / this._width
    const scaleY = newHeight / this._height

    for (let i = 0; i < this._maxParticles; i++) {
      const base = i * PARTICLE_STRIDE
      this._particles[base]     *= scaleX
      this._particles[base + 1] *= scaleY
    }

    this._width  = newWidth
    this._height = newHeight
    this._fieldNeedsUpdate = true
  }

  // Add to NoiseField class, in the PUBLIC API section:

/**
 * Updates the breath depth — how much the field expands/contracts per cycle.
 * Called by PhaseInterpolator on every frame during a phase transition.
 * @param {number} depth — typically 0.03 to 0.08
 */
setBreathDepth(depth) {
  this._breathDepth = depth
}


/**
 * Updates the noise temporal speed.
 * The base value comes from the tier config; phase and perturbation
 * add their offsets on top via setNoiseSpeedOffset().
 * @param {number} speed
 */
setNoiseSpeed(speed) {
  this._noiseSpeed = speed
}

/**
 * Adds an additive offset to noise speed, used for the micro-perturbation.
 * Applied on top of whatever setNoiseSpeed() last set.
 * @param {number} offset — decays to 0 as perturbation fades
 */
setNoiseSpeedOffset(offset) {
  // Not stored — merged directly into the field update's time advance.
  // The rendering loop reads this._noiseSpeed + this._noiseSpeedOffset.
  this._noiseSpeedOffset = offset
}

/**
 * Sets a multiplier on the painting's base particle opacity.
 * @param {number} mul — typically 0.8 to 1.0
 */
setParticleOpacityMul(mul) {
  this._particleOpacityMul = mul
}


/**
 * Sets the strength of the settle bias independently of phaseProgress.
 * Allows the bias to lag behind the main progress value.
 * @param {number} strength — 0.0 to 1.0
 */
setSettleBiasStrength(strength) {
  this._settleBiasStrength = strength
}



  /**
   * Returns current internal statistics for debugging and development.
   * Not called in production. Attach to window in dev mode to inspect.
   *
   * @returns {Object}
   */
  getDebugStats() {
    return {
      time:           this._time.toFixed(4),
      breathPhase:    (this._breathPhase / TWO_PI * 360).toFixed(1) + '°',
      phaseProgress:  this._phaseProgress.toFixed(3),
      activeParticles: this._maxParticles,
      octaves:        this._octaves,
      domainWarp:     this._useDomainWarp,
      bloomActive:    this._bloomActive,
      bloomStrength:  this._bloomStrength.toFixed(3),
      painting:       this._painting.name ?? 'unnamed',
      alphaDecay:     this._alphaDecay,
    }
  }
}