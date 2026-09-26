import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { Chord, Degree, PitchShift, Quality } from './theory'

// Left-hand logic ported 1:1 from Gesture Synth; landmarks are in raw (unmirrored) camera space.

/** One per degree, I … VII. */
export const GESTURES = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '🤘', '🤟']

type Hand = NormalizedLandmark[]
type Finger = 'index' | 'middle' | 'ring' | 'pinky'

const JOINTS: Record<Finger, { pip: number; tip: number }> = {
  index: { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring: { pip: 14, tip: 16 },
  pinky: { pip: 18, tip: 20 },
}

const fingerUp = (h: Hand, f: Finger) => h[JOINTS[f].tip].y < h[JOINTS[f].pip].y

const thumbOut = (h: Hand) => h[4].x < h[3].x

export function degreeFor(h: Hand): Degree | null {
  const t = thumbOut(h)
  const i = fingerUp(h, 'index')
  const m = fingerUp(h, 'middle')
  const r = fingerUp(h, 'ring')
  const p = fingerUp(h, 'pinky')
  if (i && p && !m && !r) return t ? 'VII' : 'VI'
  const count = [t, i, m, r, p].filter(Boolean).length
  return (['I', 'II', 'III', 'IV', 'V'] as const)[count - 1] ?? null
}

/** −1 (outward, minor) … +1 (inward, major). */
export function tilt(h: Hand) {
  const wrist = h[0]
  const lo = Math.min(h[9].x, h[13].x)
  const hi = Math.max(h[9].x, h[13].x)
  const s = wrist.x < lo ? (wrist.x - lo) / 0.12 : wrist.x > hi ? (wrist.x - hi) / 0.12 : 0
  return Math.max(-1, Math.min(1, s))
}

export function heightShift(h: Hand): PitchShift {
  const lowest = Math.max(...h.map((p) => p.y))
  return lowest < 0.5 ? 'raise' : lowest >= 0.8 ? 'lower' : 'off'
}

export const isFist = (h: Hand) =>
  !thumbOut(h) && !(['index', 'middle', 'ring', 'pinky'] as const).some((f) => fingerUp(h, f))

export interface Variation {
  quality: Quality
  high: boolean
}

export function readChord(
  h: Hand,
  variation: Variation,
  allow: { raise: boolean; lower: boolean },
): Chord | null {
  const degree = degreeFor(h)
  if (!degree) return null
  const zone = heightShift(h)
  const shift: PitchShift =
    (zone === 'raise' && allow.raise) || (zone === 'lower' && allow.lower) ? zone : 'off'
  return { degree, major: tilt(h) >= 0, shift, ...variation }
}

/** A chord must hold for 100ms before switching; brief dropouts (<50ms) keep the last one. */
export class ChordStabilizer {
  private candidate: Chord | null = null
  private candidateSince = 0
  private lastSeen = 0
  private stable: Chord | null = null

  constructor(private same: (a: Chord | null, b: Chord | null) => boolean) {}

  update(c: Chord | null, now: number) {
    if (c) this.lastSeen = now
    const next = !c && now - this.lastSeen < 50 ? this.candidate : c
    if (!this.same(next, this.candidate)) {
      this.candidate = next
      this.candidateSince = now
    }
    if (now - this.candidateSince >= 100) this.stable = this.candidate
    return this.stable
  }
}
