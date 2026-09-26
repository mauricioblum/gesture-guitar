export type Degree = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI' | 'VII'
export type PitchShift = 'off' | 'raise' | 'lower'

export const DEGREES: Degree[] = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

export const KEYS = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'] as const
export type Key = (typeof KEYS)[number]

const KEY_LABELS: Record<Key, string> = {
  A: 'A', Bb: 'A#/Bb', B: 'B', C: 'C', Db: 'C#/Db', D: 'D',
  Eb: 'D#/Eb', E: 'E', F: 'F', Gb: 'F#/Gb', G: 'G', Ab: 'G#/Ab',
}

export const keyLabel = (k: Key) => KEY_LABELS[k]

const KEY_PC: Record<Key, number> = {
  C: 0, Db: 1, D: 2, Eb: 3, E: 4, F: 5, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11,
}

const SCALE_NAMES: Record<Key, string[]> = {
  A: ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
  Bb: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
  B: ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
  C: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  Db: ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C'],
  D: ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
  Eb: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'],
  E: ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
  F: ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'],
  Gb: ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F'],
  G: ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
  Ab: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G'],
}

// Same mapping as Gesture Synth: VII sits a semitone below the tonic.
const DEGREE_OFFSET: Record<Degree, number> = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 }

export type Quality = 1 | 2 | 3 | 4

export interface Chord {
  degree: Degree
  major: boolean
  shift: PitchShift
  /** 1 root position, 2 first inversion, 3 maj7/m7, 4 dom7/dim7 */
  quality: Quality
  /** voicing up the neck */
  high: boolean
}

export const sameChord = (a: Chord | null, b: Chord | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.degree === b.degree &&
    a.major === b.major &&
    a.shift === b.shift &&
    a.quality === b.quality &&
    a.high === b.high)

function sharpen(n: string) {
  if (n.endsWith('b')) return n.slice(0, -1)
  if (n.endsWith('#')) return `${n.slice(0, -1)}𝄪`
  return `${n}#`
}

function flatten(n: string) {
  if (n.endsWith('#')) return n.slice(0, -1)
  if (n.endsWith('b')) return `${n.slice(0, -1)}𝄫`
  return `${n}b`
}

// Same suffixes as Gesture Synth: 2 → first inversion (⁶), 3 → maj7 / m7, 4 → 7 / °7.
function suffix(c: Chord) {
  if (c.quality === 2) return '⁶'
  if (c.quality === 3) return c.major ? 'maj7' : '7'
  if (c.quality === 4) return c.major ? '7' : '°7'
  return ''
}

export function chordName(c: Chord, key: Key) {
  let n = SCALE_NAMES[key][DEGREES.indexOf(c.degree)]
  if (c.shift === 'raise') n = sharpen(n)
  else if (c.shift === 'lower') n = flatten(n)
  const minor = !c.major && !(c.quality === 4)
  return `${n}${minor ? 'm' : ''}${suffix(c)}`
}

export function romanName(c: Chord) {
  const r = c.major ? c.degree : c.degree.toLowerCase()
  const shifted = c.shift === 'raise' ? `♯${r}` : c.shift === 'lower' ? `♭${r}` : r
  return `${shifted}${suffix(c)}`
}

export function chordRootPc(c: Chord, key: Key) {
  const s = c.shift === 'raise' ? 1 : c.shift === 'lower' ? -1 : 0
  return (((KEY_PC[key] + DEGREE_OFFSET[c.degree] + s) % 12) + 12) % 12
}

// Standard tuning, low E (string 0) to high E (string 5).
export const TUNING = [40, 45, 50, 55, 59, 64]
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e']

/** Fret per string, `null` = muted. */
export type Voicing = (number | null)[]

interface VoicingSpec {
  tones: number[]
  bass: number
  required: number[]
  high: boolean
  /** pitch class whose doubling sounds muddy (the third, in triads) */
  avoidDouble?: number
  /** how many strings from the bass up get played; the rest are muted */
  strings?: number
}

function specFor(c: Chord, rootPc: number): VoicingSpec {
  const pc = (i: number) => (rootPc + i) % 12
  const third = pc(c.major ? 4 : 3)
  const fifth = pc(7)
  switch (c.quality) {
    case 2:
      return { tones: [rootPc, third, fifth], bass: third, required: [rootPc, fifth], high: c.high }
    case 3: {
      const seventh = pc(c.major ? 11 : 10)
      return { tones: [rootPc, third, fifth, seventh], bass: rootPc, required: [third, seventh], high: c.high }
    }
    case 4:
      return c.major
        ? { tones: [rootPc, pc(4), fifth, pc(10)], bass: rootPc, required: [pc(4), pc(10)], high: c.high }
        : { tones: [rootPc, pc(3), pc(6), pc(9)], bass: rootPc, required: [pc(3), pc(6), pc(9)], high: c.high }
    default:
      return { tones: [rootPc, third, fifth], bass: rootPc, required: [third, fifth], high: c.high, avoidDouble: third }
  }
}

const voicingCache = new Map<string, Voicing>()

export function voicingFor(c: Chord, rootPc: number): Voicing {
  const id = `${rootPc}-${c.major}-${c.quality}-${c.high}`
  const cached = voicingCache.get(id)
  if (cached) return cached
  const v = searchVoicing(specFor(c, rootPc))
  voicingCache.set(id, v)
  return v
}

// ---------- Music mode: any chord, outside the key ----------

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']

interface ChordType {
  /** what follows the root: '' → C, 'm7' → Cm7 */
  symbol: string
  /** semitones above the root */
  tones: number[]
  /** tones the voicing can't drop; the root is always the bass */
  required: number[]
  avoidDouble?: number
  strings?: number
}

// Ids stay non-numeric so the object keeps this order when listed.
export const CHORD_TYPES = {
  maj: { symbol: '', tones: [0, 4, 7], required: [4, 7], avoidDouble: 4 },
  m: { symbol: 'm', tones: [0, 3, 7], required: [3, 7], avoidDouble: 3 },
  dom7: { symbol: '7', tones: [0, 4, 7, 10], required: [4, 10] },
  m7: { symbol: 'm7', tones: [0, 3, 7, 10], required: [3, 10] },
  maj7: { symbol: 'maj7', tones: [0, 4, 7, 11], required: [4, 11] },
  power: { symbol: '5', tones: [0, 7], required: [7], strings: 3 },
  sus2: { symbol: 'sus2', tones: [0, 2, 7], required: [2, 7] },
  sus4: { symbol: 'sus4', tones: [0, 5, 7], required: [5, 7] },
  add9: { symbol: 'add9', tones: [0, 2, 4, 7], required: [2, 4] },
  maj6: { symbol: '6', tones: [0, 4, 7, 9], required: [4, 9] },
  m6: { symbol: 'm6', tones: [0, 3, 7, 9], required: [3, 9] },
  dom9: { symbol: '9', tones: [0, 2, 4, 7, 10], required: [2, 4, 10] },
  dim: { symbol: 'dim', tones: [0, 3, 6], required: [3, 6] },
  m7b5: { symbol: 'm7(b5)', tones: [0, 3, 6, 10], required: [3, 6, 10] },
  dim7: { symbol: '°7', tones: [0, 3, 6, 9], required: [3, 6, 9] },
  aug: { symbol: 'aug', tones: [0, 4, 8], required: [4, 8] },
} satisfies Record<string, ChordType>

export type ChordTypeId = keyof typeof CHORD_TYPES

export interface SongChord {
  root: number
  type: ChordTypeId
}

export const songChordName = (c: SongChord) => NOTE_NAMES[c.root] + CHORD_TYPES[c.type].symbol

export function songVoicing(c: SongChord): Voicing {
  const id = `song-${c.root}-${c.type}`
  const cached = voicingCache.get(id)
  if (cached) return cached
  const t: ChordType = CHORD_TYPES[c.type]
  const pc = (i: number) => (c.root + i) % 12
  const v = searchVoicing({
    tones: t.tones.map(pc),
    bass: c.root,
    required: t.required.map(pc),
    high: false,
    avoidDouble: t.avoidDouble === undefined ? undefined : pc(t.avoidDouble),
    strings: t.strings,
  })
  voicingCache.set(id, v)
  return v
}

/**
 * Brute-force search over hand positions for a strummable voicing:
 * only low strings may be muted, span ≤ 4 frets, ≤ 4 fingers unless it's a barre.
 * High voicings live from the 5th fret up with no open strings.
 */
function searchVoicing(spec: VoicingSpec): Voicing {
  const tones = new Set(spec.tones)
  let best: Voicing = [null, null, null, null, null, null]
  let bestScore = -Infinity

  for (let pos = spec.high ? 5 : 0; pos <= (spec.high ? 12 : 10); pos++) {
    const lo = Math.max(1, pos)
    const allowed = spec.high ? [] : [0]
    for (let f = lo; f <= lo + 3; f++) allowed.push(f)

    for (let bass = 0; bass <= 2; bass++) {
      const top = Math.min(5, bass + (spec.strings ?? 6) - 1)
      const options = TUNING.map((open, s) =>
        s < bass || s > top ? [] : allowed.filter((f) => tones.has((open + f) % 12)),
      )
      if (options.slice(bass, top + 1).some((o) => o.length === 0)) continue

      const pick: number[] = new Array(6).fill(-1)
      const walk = (s: number) => {
        if (s > top) {
          const score = scoreVoicing(pick, bass, top, spec)
          if (score > bestScore) {
            bestScore = score
            best = pick.map((f, i) => (i < bass || i > top ? null : f))
          }
          return
        }
        if (s < bass) return walk(s + 1)
        for (const f of options[s]) {
          if (s === bass && (TUNING[s] + f) % 12 !== spec.bass) continue
          pick[s] = f
          walk(s + 1)
        }
      }
      walk(0)
    }
  }
  return best
}

function scoreVoicing(frets: number[], bass: number, top: number, spec: VoicingSpec) {
  const played = frets.slice(bass, top + 1)
  const pcs = played.map((f, i) => (TUNING[i + bass] + f) % 12)
  if (spec.required.some((r) => !pcs.includes(r))) return -Infinity

  const fretted = played.filter((f) => f > 0)
  const minF = fretted.length ? Math.min(...fretted) : 0
  const maxF = fretted.length ? Math.max(...fretted) : 0
  if (maxF - minF > 3) return -Infinity

  const atMin = fretted.filter((f) => f === minF).length
  if (fretted.length > 4) {
    // Only playable as a barre starting at the bass, with no open strings behind it.
    if (atMin < 2 || fretted.length - atMin + 1 > 4 || played[0] !== minF) return -Infinity
    if (played.some((f, i) => f === 0 && i > played.indexOf(minF))) return -Infinity
  }

  const opens = played.filter((f) => f === 0).length
  const count = (pc: number) => pcs.filter((p) => p === pc).length
  const span = maxF - minF
  return (
    played.length * 4 + opens * 2 - minF * 2 - span * 3 -
    (opens && maxF > 3 ? 6 : 0) -
    (spec.avoidDouble !== undefined && count(spec.avoidDouble) > 1 ? 1 : 0) +
    (count(spec.tones[0]) > 1 ? 1 : 0) +
    (spec.tones.every((t) => pcs.includes(t)) ? 2 : 0)
  )
}

export const midiToFreq = (m: number) => 440 * 2 ** ((m - 69) / 12)
