// Extended Karplus-Strong: one delay-line voice per guitar string.

import { AutoStrummer, SPREAD, strokeOrder } from '../autostrum'

declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: unknown): void

type Pluck = Extract<WorkletMessage, { type: 'pluck' }>

/** The strum grid runs here on the audio clock, so a slow video frame can't push a stroke off the beat. */
export interface AutoState {
  /** voiced strings, low → high; null rests but keeps time */
  notes: { string: number; freq: number }[] | null
  bpm: number
  steps: string
  palm: { t60: number; brightness: number; velocity: number; choke: number } | null
}

/** Posted back for each auto stroke so the main thread can shake the strings. */
export interface StrokeEvent {
  at: number
  strings: number[]
  velocity: number
  palmMute: boolean
}

export type WorkletMessage =
  | { type: 'config'; t60: number; brightness: number; pickPos: number }
  | {
      type: 'pluck'
      string: number
      freq: number
      velocity: number
      when: number
      t60?: number
      brightness?: number
      /** 0–1: in-loop lowpass that kills the highs first, like a palm resting on the saddle */
      mute?: number
    }
  | { type: 'damp'; string?: number; t60: number }
  | { type: 'auto'; state: AutoState | null }

const SIZE = 4096
const STRINGS = 6

/**
 * Loop one-pole coefficient so partials around 1.5kHz lose `mute * 300` dB/s whatever the pitch
 * (the filter runs once per period, so low strings need a much steeper pole than high ones).
 */
function palmPole(freq: number, mute: number) {
  const g2 = 10 ** (-(300 * mute) / freq / 10)
  const c = Math.cos((2 * Math.PI * 1500) / sampleRate)
  const b = (1 - g2 * c) / (1 - g2)
  return b - Math.sqrt(b * b - 1)
}

class StringVoice {
  buf = new Float32Array(SIZE)
  w = 0
  delay = 100
  apC = 0
  apX = 0
  apY = 0
  prev = 0
  lpA = 0
  lpY = 0
  freq = 110
  loss = 0.99
  silentFor = 0
  active = false
  /** plucked with the default decay, so config changes (tone, let ring) retune it */
  followsConfig = false
  panL: number
  panR: number

  constructor(index: number) {
    const pan = (index / (STRINGS - 1) - 0.5) * 0.5
    this.panL = Math.cos((pan + 0.5) * Math.PI * 0.5)
    this.panR = Math.sin((pan + 0.5) * Math.PI * 0.5)
  }

  setT60(t60: number) {
    this.loss = 10 ** (-3 / (t60 * this.freq))
  }

  pluck(freq: number, velocity: number, t60: number, brightness: number, pickPos: number, mute: number) {
    this.freq = freq
    this.lpA = mute > 0 ? palmPole(freq, mute) : 0
    // Loop delay = integer line + 0.5 (averaging filter) + one-pole phase delay + allpass fraction.
    const w = (2 * Math.PI * freq) / sampleRate
    const lpA = this.lpA
    const lpDelay = lpA ? Math.atan2(lpA * Math.sin(w), 1 - lpA * Math.cos(w)) / w : 0
    const period = sampleRate / freq - lpDelay
    let d = Math.floor(period - 0.5)
    let frac = period - 0.5 - d
    if (frac < 0.1) {
      d -= 1
      frac += 1
    }
    this.delay = d
    this.apC = (1 - frac) / (1 + frac)
    this.setT60(t60)

    const exc = new Float32Array(d)
    const a = Math.min(0.95, 0.08 + brightness * (0.35 + 0.65 * velocity))
    let lp = 0
    for (let i = 0; i < d; i++) {
      lp += a * (Math.random() * 2 - 1 - lp)
      exc[i] = lp
    }
    const pick = Math.max(1, Math.round(d * pickPos))
    let mean = 0
    for (let i = d - 1; i >= 0; i--) {
      exc[i] -= i >= pick ? exc[i - pick] : 0
      mean += exc[i]
    }
    mean /= d
    let peak = 1e-9
    for (let i = 0; i < d; i++) {
      exc[i] -= mean
      peak = Math.max(peak, Math.abs(exc[i]))
    }
    const gain = (0.25 + 0.75 * velocity) / peak
    for (let i = 0; i < d; i++) {
      const idx = (this.w - d + i + SIZE) % SIZE
      this.buf[idx] = this.buf[idx] * 0.15 + exc[i] * gain * 0.5
    }
    this.active = true
    this.silentFor = 0
  }

  tick() {
    const x = this.buf[(this.w - this.delay + SIZE) % SIZE]
    const avg = 0.5 * (x + this.prev)
    this.prev = x
    const lp = (this.lpY = avg + this.lpA * (this.lpY - avg))
    const ap = this.apC * lp + this.apX - this.apC * this.apY
    this.apX = lp
    this.apY = ap
    this.buf[this.w] = ap * this.loss
    this.w = (this.w + 1) % SIZE
    if (Math.abs(x) < 1e-5) {
      if (++this.silentFor > SIZE) this.active = false
    } else this.silentFor = 0
    return x
  }
}

class GuitarProcessor extends AudioWorkletProcessor {
  voices = Array.from({ length: STRINGS }, (_, i) => new StringVoice(i))
  queue: Pluck[] = []
  t60 = 3
  brightness = 0.6
  pickPos = 0.15
  auto: AutoState | null = null
  strummer = new AutoStrummer()

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<WorkletMessage>) => {
      const m = e.data
      if (m.type === 'config') {
        this.t60 = m.t60
        this.brightness = m.brightness
        this.pickPos = m.pickPos
        for (const v of this.voices) if (v.active && v.followsConfig) v.setT60(m.t60)
      } else if (m.type === 'pluck') {
        this.queue.push(m)
      } else if (m.type === 'damp') {
        this.damp(m.t60, m.string)
      } else if (m.type === 'auto') {
        if (!m.state) this.strummer.reset()
        this.auto = m.state
      }
    }
  }

  damp(t60: number, string?: number) {
    const targets = string === undefined ? this.voices : [this.voices[string]]
    for (const v of targets) {
      v.setT60(t60)
      v.followsConfig = false
    }
  }

  autoStrum(until: number) {
    const a = this.auto!
    for (const s of this.strummer.update(currentTime, until, a.bpm, a.steps, a.notes !== null)) {
      const notes = strokeOrder(a.notes!, s.dir)
      const palm = a.palm
      // The palm lands on all six strings, choking whatever still rings before the new stroke.
      if (palm) this.damp(palm.choke)
      notes.forEach((n, k) =>
        this.queue.push({
          type: 'pluck',
          string: n.string,
          freq: n.freq,
          velocity: palm ? s.velocity * palm.velocity : s.velocity,
          when: s.at + k * SPREAD[s.dir],
          t60: palm?.t60,
          brightness: palm?.brightness,
          mute: palm ? 1 : undefined,
        }),
      )
      const event: StrokeEvent = { at: s.at, strings: notes.map((n) => n.string), velocity: s.velocity, palmMute: !!palm }
      this.port.postMessage(event)
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const [L, R] = outputs[0]
    const frames = L.length

    if (this.auto) this.autoStrum(currentTime + frames / sampleRate)
    if (this.queue.length) {
      const horizon = currentTime + frames / sampleRate
      this.queue = this.queue.filter((p) => {
        if (p.when > horizon) return true
        const v = this.voices[p.string]
        v.pluck(p.freq, p.velocity, p.t60 ?? this.t60, p.brightness ?? this.brightness, this.pickPos, p.mute ?? 0)
        v.followsConfig = p.t60 === undefined
        return false
      })
    }

    for (const v of this.voices) {
      if (!v.active) continue
      for (let i = 0; i < frames; i++) {
        const s = v.tick()
        L[i] += s * v.panL
        R[i] += s * v.panR
      }
    }
    return true
  }
}

registerProcessor('guitar-strings', GuitarProcessor)
