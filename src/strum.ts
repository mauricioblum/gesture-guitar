export interface Point {
  x: number
  y: number
}

export interface StringLayout {
  /** nut (left end of strings) */
  nut: number
  /** strum zone start = where the neck meets the body */
  x0: number
  /** saddle (right end of strings) */
  x1: number
  ys: number[]
  spacing: number
}

export interface StrumHit {
  string: number
  velocity: number
  /** seconds relative to the first hit of this frame */
  offset: number
  direction: 'down' | 'up'
  /** pick x where it met this string, interpolated between frames */
  x: number
}

/** A guitar lying across the screen: neck on the left (fretting hand), body on the right (strumming hand). */
export function layoutStrings(w: number, h: number): StringLayout {
  const portrait = h > w
  const nut = w * (portrait ? 0.04 : 0.26)
  const x0 = w * (portrait ? 0.4 : 0.56)
  const x1 = w * (portrait ? 0.9 : 0.86)
  const span = portrait ? Math.min(h * 0.15, w * 0.42) : Math.min(h * 0.18, 150)
  const mid = h * (portrait ? 0.77 : 0.76)
  const spacing = span / 5
  const ys = Array.from({ length: 6 }, (_, i) => mid - span / 2 + spacing * i)
  return { nut, x0, x1, ys, spacing }
}

const DEADBAND = 5
const MAX_SPREAD = 0.035

/** Detects the pick crossing each string, with a deadband so jitter on a string doesn't retrigger it. */
export class StrumDetector {
  private side: (-1 | 1 | 0)[] = [0, 0, 0, 0, 0, 0]
  private prev: { p: Point; t: number } | null = null

  reset() {
    this.side = [0, 0, 0, 0, 0, 0]
    this.prev = null
  }

  update(
    p: Point | null,
    t: number,
    layout: StringLayout,
    screenH: number,
    right = layout.x1 + (layout.x1 - layout.x0) * 0.08,
  ): StrumHit[] {
    if (!p) {
      this.reset()
      return []
    }
    const margin = (layout.x1 - layout.x0) * 0.08
    const inside = p.x > layout.x0 - margin && p.x < right
    const prev = this.prev
    this.prev = { p, t }

    const crossings: { string: number; frac: number }[] = []
    layout.ys.forEach((y, i) => {
      const d = p.y - y
      if (Math.abs(d) < DEADBAND) return
      const s = d > 0 ? 1 : -1
      if (this.side[i] !== 0 && s !== this.side[i] && inside && prev) {
        const span = p.y - prev.p.y
        const frac = span === 0 ? 0 : Math.min(1, Math.max(0, (y - prev.p.y) / span))
        crossings.push({ string: i, frac })
      }
      this.side[i] = s
    })
    if (!crossings.length || !prev) return []

    const dt = Math.max(1, t - prev.t) / 1000
    const speed = Math.abs(p.y - prev.p.y) / screenH / dt
    const velocity = Math.min(1, Math.max(0.12, speed / 3.2))
    const direction = p.y > prev.p.y ? 'down' : 'up'

    crossings.sort((a, b) => a.frac - b.frac)
    const first = crossings[0].frac
    return crossings.map((c) => ({
      string: c.string,
      velocity,
      offset: Math.min(MAX_SPREAD, (c.frac - first) * dt),
      direction,
      x: prev.p.x + c.frac * (p.x - prev.p.x),
    }))
  }
}
