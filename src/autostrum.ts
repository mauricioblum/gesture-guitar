// One 4/4 bar: D down, U up, . rest. 8 steps are eighth notes, 16 are sixteenths.
export const PATTERNS = {
  basic: { name: 'Básica', steps: 'D.D.D.D.' },
  pop: { name: 'Pop', steps: 'D.DU.UDU' },
  eighths: { name: 'Contínua', steps: 'DUDUDUDU' },
  rock: { name: 'Rock', steps: 'DDDDDDDD' },
}
export type PatternId = keyof typeof PATTERNS

/** The custom pattern is one bar of sixteenths. */
export const CUSTOM_STEPS = 16
export const isSteps = (s: unknown): s is string => typeof s === 'string' && new RegExp(`^[DU.]{${CUSTOM_STEPS}}$`).test(s)

export const arrows = (steps: string) =>
  steps.replace(/D/g, '↓').replace(/U/g, '↑').replace(/\./g, ' ').trim()

export type StrokeDir = 'down' | 'up'

export interface AutoStroke {
  /** audio-clock time the stroke lands */
  at: number
  dir: StrokeDir
  velocity: number
}

/** Seconds between neighbouring strings within one stroke. */
export const SPREAD: Record<StrokeDir, number> = { down: 0.012, up: 0.009 }

/** Down hits every voiced string low → high; up only brushes the top four, high → low. */
export const strokeOrder = <T>(voiced: T[], dir: StrokeDir) => (dir === 'down' ? voiced : voiced.slice(-4).reverse())

const LATE = 0.05
// update() runs on every audio block, so the usual "nothing due" answer doesn't allocate.
const NONE: AutoStroke[] = []

function velocity(step: number, dir: StrokeDir, perBeat: number) {
  const base = dir === 'up' ? 0.42 : step % perBeat === 0 ? 0.64 : 0.54
  return base + (step === 0 ? 0.1 : 0) + (Math.random() - 0.5) * 0.08
}

/**
 * Strum grid on the audio clock. Rests shorter than a bar keep the groove;
 * after a longer one the next chord starts the pattern from the top.
 */
export class AutoStrummer {
  private next: number | null = null
  private step = 0
  private lastPlaying = -Infinity

  reset() {
    this.next = null
  }

  /** Strokes landing before `until`. */
  update(now: number, until: number, bpm: number, steps: string, playing: boolean): AutoStroke[] {
    const bar = 240 / bpm
    const dur = bar / steps.length
    const perBeat = steps.length / 4
    if (playing) this.lastPlaying = now
    let next = this.next
    if (next === null || now - this.lastPlaying > bar || now - next > bar) {
      if (!playing) {
        this.next = null
        return NONE
      }
      next = now
      this.step = 0
    }
    if (next >= until) return NONE
    const out: AutoStroke[] = []
    for (; next < until; next += dur) {
      const s = steps[this.step]
      if (playing && s !== '.' && next > now - LATE) {
        const dir = s === 'U' ? 'up' : 'down'
        out.push({ at: Math.max(now, next), dir, velocity: velocity(this.step, dir, perBeat) })
      }
      this.step = (this.step + 1) % steps.length
    }
    this.next = next
    return out
  }
}
