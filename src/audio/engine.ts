import workletUrl from './guitar-worklet.ts?worker&url'
import type { StrokeEvent, WorkletMessage } from './guitar-worklet'

export type ToneId = 'nylon' | 'steel' | 'clean' | 'drive'

interface Tone {
  label: string
  short: string
  t60: number
  brightness: number
  pickPos: number
  drive: number
  lowpass: number
  body: boolean
  reverb: number
  gain: number
}

export const TONES: Record<ToneId, Tone> = {
  nylon: { label: 'Violão Nylon', short: 'NYL', t60: 2.4, brightness: 0.42, pickPos: 0.2, drive: 0, lowpass: 5200, body: true, reverb: 0.22, gain: 1.1 },
  steel: { label: 'Violão Aço', short: 'AÇO', t60: 4.5, brightness: 0.85, pickPos: 0.12, drive: 0, lowpass: 10000, body: true, reverb: 0.2, gain: 0.9 },
  clean: { label: 'Guitarra Clean', short: 'CLN', t60: 6, brightness: 0.62, pickPos: 0.22, drive: 1.5, lowpass: 6000, body: false, reverb: 0.28, gain: 0.9 },
  drive: { label: 'Guitarra Drive', short: 'OD', t60: 9, brightness: 0.7, pickPos: 0.18, drive: 28, lowpass: 4200, body: false, reverb: 0.16, gain: 0.35 },
}

const LET_RING = 2.5
const LET_RING_REVERB = 1.3
/** A palm landing on the strings, choking what still rings. */
export const PM_CHOKE_T60 = 0.08

export interface Pluck {
  string: number
  freq: number
  velocity: number
  /** seconds from now */
  delay: number
  t60?: number
  palmMute?: boolean
}

export interface AutoStrum {
  /** voiced strings, low → high; null rests but keeps time */
  notes: { string: number; freq: number }[] | null
  bpm: number
  steps: string
  palmMute: boolean
}

const palmT60 = (t: Tone) => Math.min(0.6, Math.max(0.3, t.t60 * 0.1))
const PM_BRIGHTNESS = 0.35
const PM_VELOCITY = 0.85

function driveCurve(k: number) {
  const n = 2048
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = k <= 0 ? x : Math.tanh(k * x) / Math.tanh(k)
  }
  return c
}

function impulse(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  }
  return buf
}

export class GuitarEngine {
  ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private shaper!: WaveShaperNode
  private lowpass!: BiquadFilterNode
  private bodyIn!: GainNode
  private bodyBypass!: GainNode
  private wet!: GainNode
  private pre!: GainNode
  private tone: ToneId = 'nylon'
  private letRing = false
  private auto: AutoStrum | null = null
  private autoKey = 'null'
  onStroke: ((e: StrokeEvent) => void) | null = null

  async start() {
    if (this.ctx) {
      await this.ctx.resume()
      return
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    await ctx.audioWorklet.addModule(workletUrl)
    this.node = new AudioWorkletNode(ctx, 'guitar-strings', {
      numberOfInputs: 0,
      outputChannelCount: [2],
    })
    this.node.port.onmessage = (e: MessageEvent<StrokeEvent>) => this.onStroke?.(e.data)

    this.pre = ctx.createGain()
    const tighten = ctx.createBiquadFilter()
    tighten.type = 'highpass'
    tighten.frequency.value = 70
    this.shaper = ctx.createWaveShaper()
    this.shaper.oversample = '4x'
    this.lowpass = ctx.createBiquadFilter()
    this.lowpass.type = 'lowpass'
    this.lowpass.Q.value = 0.7

    this.bodyIn = ctx.createGain()
    this.bodyBypass = ctx.createGain()
    const bodyOut = ctx.createGain()
    let prev: AudioNode = this.bodyIn
    for (const [f, q, g] of [[105, 1.4, 6], [210, 1.8, 3], [2800, 0.8, 2.5]]) {
      const b = ctx.createBiquadFilter()
      b.type = 'peaking'
      b.frequency.value = f
      b.Q.value = q
      b.gain.value = g
      prev.connect(b)
      prev = b
    }
    prev.connect(bodyOut)
    this.bodyBypass.connect(bodyOut)

    const verb = ctx.createConvolver()
    verb.buffer = impulse(ctx, 2.2)
    this.wet = ctx.createGain()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.ratio.value = 4
    comp.attack.value = 0.003
    comp.release.value = 0.2
    const master = ctx.createGain()
    master.gain.value = 0.9

    this.node.connect(this.pre)
    this.pre.connect(tighten)
    tighten.connect(this.shaper)
    this.shaper.connect(this.lowpass)
    this.lowpass.connect(this.bodyIn)
    this.lowpass.connect(this.bodyBypass)
    bodyOut.connect(comp)
    bodyOut.connect(verb)
    verb.connect(this.wet)
    this.wet.connect(comp)
    comp.connect(master)
    master.connect(ctx.destination)

    this.setTone(this.tone)
  }

  setTone(id: ToneId) {
    this.tone = id
    if (!this.ctx || !this.node) return
    const t = TONES[id]
    const ring = this.letRing
    this.post({ type: 'config', t60: t.t60 * (ring ? LET_RING : 1), brightness: t.brightness, pickPos: t.pickPos })
    this.shaper.curve = driveCurve(t.drive)
    this.pre.gain.value = t.gain
    this.lowpass.frequency.value = t.lowpass
    this.bodyIn.gain.value = t.body ? 1 : 0
    this.bodyBypass.gain.value = t.body ? 0 : 1
    this.wet.gain.value = t.reverb * (ring ? LET_RING_REVERB : 1)
    this.postAuto()
  }

  setLetRing(on: boolean) {
    this.letRing = on
    this.setTone(this.tone)
  }

  pluck(plucks: Pluck[]) {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const t = TONES[this.tone]
    for (const p of plucks) {
      const pm = p.palmMute && p.t60 === undefined
      this.post({
        type: 'pluck',
        string: p.string,
        freq: p.freq,
        velocity: pm ? p.velocity * PM_VELOCITY : p.velocity,
        when: now + p.delay,
        t60: pm ? palmT60(t) : p.t60,
        brightness: pm ? t.brightness * PM_BRIGHTNESS : undefined,
        mute: pm ? 1 : undefined,
      })
    }
  }

  /** Hand the strum over to the audio thread; `null` stops it. Cheap to call every frame. */
  setAuto(a: AutoStrum | null) {
    const key = JSON.stringify(a)
    if (key === this.autoKey) return
    this.autoKey = key
    this.auto = a
    this.postAuto()
  }

  private postAuto() {
    const a = this.auto
    const t = TONES[this.tone]
    const palm = { t60: palmT60(t), brightness: t.brightness * PM_BRIGHTNESS, velocity: PM_VELOCITY, choke: PM_CHOKE_T60 }
    this.post({ type: 'auto', state: a && { notes: a.notes, bpm: a.bpm, steps: a.steps, palm: a.palmMute ? palm : null } })
  }

  damp(t60 = 0.12, string?: number) {
    this.post({ type: 'damp', t60, string })
  }

  private post(m: WorkletMessage) {
    this.node?.port.postMessage(m)
  }
}
