import { arrows, CUSTOM_STEPS, isSteps, PATTERNS, type PatternId } from './autostrum'
import { GESTURES } from './gestures'
import { CHORD_TYPES, NOTE_NAMES, songChordName, type ChordTypeId, type SongChord } from './theory'

const BPM_MIN = 40
const BPM_MAX = 200
const STORAGE_KEY = 'gesture-guitar:song'

/** gestures per row; the tilted row's slots follow the upright ones */
export const ROW = GESTURES.length

export interface Song {
  on: boolean
  /** one chord per left-hand gesture, in GESTURES order: upright row, then tilted row */
  slots: (SongChord | null)[]
  /** the tilted hand plays the second row */
  tilted: boolean
  auto: boolean
  /** with the auto strum, showing the strumming hand stops the groove and lets the chord ring */
  hold: boolean
  bpm: number
  pattern: PatternId | 'custom'
  /** the player's own bar, in sixteenths */
  custom: string
}

const defaults = (): Song => ({
  on: false,
  slots: [
    { root: 0, type: 'maj' },
    { root: 7, type: 'maj' },
    { root: 9, type: 'm' },
    { root: 5, type: 'maj' },
    null,
    null,
    null,
    ...Array<null>(ROW).fill(null),
  ],
  tilted: false,
  auto: false,
  hold: false,
  bpm: 90,
  pattern: 'pop',
  custom: 'D...D.U...U.D.U.',
})

export const songSteps = (song: Song) => (song.pattern === 'custom' ? song.custom : PATTERNS[song.pattern].steps)

const STEP_NEXT: Record<string, string> = { '.': 'D', D: 'U', U: '.' }
const STEP_NAMES: Record<string, string> = { '.': 'pausa', D: 'para baixo', U: 'para cima' }
const STEP_PARTS = ['', ', 2ª semicolcheia', ', contratempo', ', 4ª semicolcheia']
const stepCount = (i: number) => `Tempo ${Math.floor(i / 4) + 1}${STEP_PARTS[i % 4]}`

const clampBpm = (n: number) => Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, n)))

const isKey = <T extends object>(o: T, k: unknown): k is keyof T => typeof k === 'string' && Object.hasOwn(o, k)

const isPc = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 12

function parseChord(c: unknown): SongChord | null {
  if (!c || typeof c !== 'object') return null
  const { root, type, bass } = c as Record<string, unknown>
  if (!isPc(root) || !isKey(CHORD_TYPES, type)) return null
  return isPc(bass) && bass !== root ? { root, type, bass } : { root, type }
}

export function loadSong(): Song {
  const song = defaults()
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!saved || typeof saved !== 'object') return song
    song.on = saved.on === true
    if (Array.isArray(saved.slots)) song.slots = song.slots.map((_, i) => parseChord(saved.slots[i]))
    song.tilted = saved.tilted === true
    song.auto = saved.auto === true
    song.hold = saved.hold === true
    if (Number.isFinite(saved.bpm)) song.bpm = clampBpm(saved.bpm)
    if (isKey(PATTERNS, saved.pattern) || saved.pattern === 'custom') song.pattern = saved.pattern
    if (isSteps(saved.custom)) song.custom = saved.custom
  } catch {}
  return song
}

function saveSong(song: Song) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(song))
  } catch {}
}

const TYPE_NAMES: Record<ChordTypeId, string> = {
  maj: 'maior',
  m: 'menor',
  dom7: 'com sétima',
  m7: 'menor com sétima',
  maj7: 'com sétima maior',
  power: 'power chord, só tônica e quinta',
  sus2: 'suspenso com segunda',
  sus4: 'suspenso com quarta',
  add9: 'com nona adicionada',
  maj6: 'com sexta',
  m6: 'menor com sexta',
  dom9: 'com nona',
  dim: 'diminuto',
  m7b5: 'meio diminuto',
  dim7: 'diminuto com sétima',
  aug: 'aumentado',
}

export const slotLabel = (i: number) => (i < ROW ? `${i + 1}` : `${i - ROW + 1} inclinado`)

interface PanelHooks {
  /** the song changed: mode, chords or tempo */
  changed(): void
  /** strum a chord the player just picked */
  preview(c: SongChord): void
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function radios(host: HTMLElement, name: string, items: { value: string; html: string; label?: string; title?: string }[], cls = 'chip') {
  host.innerHTML = items
    .map(
      (it) =>
        `<label class="${cls}"${it.title ? ` title="${it.title}"` : ''}><input type="radio" name="${name}" value="${it.value}"${it.label ? ` aria-label="${it.label}"` : ''} />${it.html}</label>`,
    )
    .join('')
  return [...host.querySelectorAll('input')]
}

export function musicPanel(song: Song, hooks: PanelHooks) {
  const modal = $('musicModal')
  const autoToggle = $<HTMLButtonElement>('autoToggle')
  const holdToggle = $<HTMLButtonElement>('holdToggle')
  const bpmRange = $<HTMLInputElement>('bpmRange')
  const bpmNumber = $<HTMLInputElement>('bpmNumber')
  const playButton = $<HTMLButtonElement>('musicOn')
  const offButton = $<HTMLButtonElement>('musicOff')

  const rowToggle = $<HTMLButtonElement>('rowToggle')

  const slotInputs = radios(
    $('slotPicker'),
    'slot',
    [...GESTURES, ...GESTURES].map((g, i) => ({
      value: String(i),
      html: `<span class="slot-face"><span class="gesture${i >= ROW ? ' tilted' : ''}" aria-hidden="true">${g}</span><b class="slot-chord"></b></span>`,
    })),
    'slot',
  )
  const rootInputs = radios($('rootPicker'), 'root', [
    ...NOTE_NAMES.map((n, i) => ({ value: String(i), html: `<span>${n}</span>` })),
    { value: '', html: '<span>—</span>', label: 'Sem acorde', title: 'Sem acorde' },
  ])
  const bassInputs = radios($('bassPicker'), 'bass', [
    ...NOTE_NAMES.map((n, i) => ({ value: String(i), html: `<span>${n}</span>`, label: `Baixo em ${n}` })),
    { value: '', html: '<span>—</span>', label: 'Baixo na tônica', title: 'Baixo na tônica' },
  ])
  const typeInputs = radios(
    $('typePicker'),
    'type',
    (Object.keys(CHORD_TYPES) as ChordTypeId[]).map((t) => ({
      value: t,
      html: `<span>${t === 'maj' ? 'Maior' : t === 'm' ? 'Menor' : CHORD_TYPES[t].symbol}</span>`,
      title: TYPE_NAMES[t],
    })),
  )
  const patternInputs = radios(
    $('patternPicker'),
    'pattern',
    [
      ...(Object.keys(PATTERNS) as PatternId[]).map((p) => ({
        value: p,
        html: `<span><b>${arrows(PATTERNS[p].steps)}</b>${PATTERNS[p].name}</span>`,
        label: PATTERNS[p].name,
      })),
      { value: 'custom', html: '<span><b>✎</b>Custom</span>', label: 'Custom' },
    ],
    'chip pattern',
  )
  const customEditor = $('customEditor')
  const customGrid = $('customGrid')
  customGrid.innerHTML = Array.from({ length: CUSTOM_STEPS / 4 }, (_, beat) => {
    const cells = Array.from({ length: 4 }, (_, j) => {
      const i = beat * 4 + j
      const count = j === 0 ? `${beat + 1}` : j === 2 ? 'e' : '·'
      return `<button type="button" class="step" data-i="${i}"><span class="step-arrow"></span><span class="step-count">${count}</span></button>`
    })
    return `<div class="step-beat">${cells.join('')}</div>`
  }).join('')
  const stepButtons = [...customGrid.querySelectorAll<HTMLButtonElement>('.step')]
  bpmRange.min = bpmNumber.min = String(BPM_MIN)
  bpmRange.max = bpmNumber.max = String(BPM_MAX)

  let slot = 0
  let pendingType: ChordTypeId = 'maj'

  function sync() {
    slotInputs.forEach((input, i) => {
      const c = song.slots[i]
      input.checked = i === slot
      const label = c ? songChordName(c) : '—'
      input.setAttribute('aria-label', `Gesto ${slotLabel(i)}: ${c ? label : 'sem acorde'}`)
      input.parentElement!.hidden = i >= ROW && !song.tilted
      const name = input.parentElement!.querySelector('.slot-chord')!
      name.textContent = label
      name.classList.toggle('empty', !c)
      name.classList.toggle('long', label.length > 6)
    })
    const c = song.slots[slot]
    if (c) pendingType = c.type
    for (const r of rootInputs) r.checked = r.value === (c ? String(c.root) : '')
    for (const t of typeInputs) t.checked = t.value === pendingType
    for (const b of bassInputs) {
      b.checked = b.value === String(c?.bass ?? '')
      b.disabled = !c
    }
    autoToggle.setAttribute('aria-pressed', String(song.auto))
    holdToggle.setAttribute('aria-pressed', String(song.hold))
    holdToggle.disabled = !song.auto
    bpmRange.value = bpmNumber.value = String(song.bpm)
    for (const p of patternInputs) p.checked = p.value === song.pattern
    customEditor.hidden = song.pattern !== 'custom'
    stepButtons.forEach((b, i) => {
      const s = song.custom[i]
      b.dataset.step = s
      b.querySelector('.step-arrow')!.textContent = arrows(s) || '·'
      b.setAttribute('aria-label', `${stepCount(i)}: ${STEP_NAMES[s]}`)
    })
    offButton.hidden = !song.on
    rowToggle.textContent = song.tilted ? '− Remover fileira inclinada' : '+ Fileira inclinada'
    rowToggle.setAttribute('aria-pressed', String(song.tilted))
    playButton.disabled = !song.slots.slice(0, song.tilted ? undefined : ROW).some(Boolean)
    playButton.toggleAttribute('data-on', song.on)
  }

  function commit() {
    saveSong(song)
    sync()
    hooks.changed()
  }

  function setChord(c: SongChord | null) {
    song.slots[slot] = c
    commit()
    if (c) hooks.preview(c)
  }

  for (const input of slotInputs) {
    input.addEventListener('change', () => {
      slot = Number(input.value)
      sync()
      const c = song.slots[slot]
      if (c) hooks.preview(c)
    })
  }
  for (const input of rootInputs) {
    input.addEventListener('change', () => {
      if (input.value === '') return setChord(null)
      const root = Number(input.value)
      const bass = song.slots[slot]?.bass
      setChord(bass === undefined || bass === root ? { root, type: pendingType } : { root, type: pendingType, bass })
    })
  }
  for (const input of bassInputs) {
    input.addEventListener('change', () => {
      const c = song.slots[slot]
      if (!c) return
      const bass = input.value === '' ? c.root : Number(input.value)
      setChord(bass === c.root ? { root: c.root, type: c.type } : { ...c, bass })
    })
  }
  for (const input of typeInputs) {
    input.addEventListener('change', () => {
      pendingType = input.value as ChordTypeId
      const c = song.slots[slot]
      if (c) setChord({ ...c, type: pendingType })
    })
  }
  for (const input of patternInputs) {
    input.addEventListener('change', () => {
      song.pattern = input.value as Song['pattern']
      commit()
    })
  }
  function setStep(i: number, s: string) {
    song.custom = song.custom.slice(0, i) + s + song.custom.slice(i + 1)
    commit()
  }
  const STEP_KEYS: Record<string, string> = { ArrowDown: 'D', ArrowUp: 'U', Backspace: '.', Delete: '.', ' ': '.' }
  stepButtons.forEach((b, i) => {
    b.addEventListener('click', () => setStep(i, STEP_NEXT[song.custom[i]]))
    b.addEventListener('keydown', (e) => {
      if (e.key in STEP_KEYS) {
        e.preventDefault()
        setStep(i, STEP_KEYS[e.key])
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        stepButtons[(i + (e.key === 'ArrowLeft' ? -1 : 1) + CUSTOM_STEPS) % CUSTOM_STEPS].focus()
      }
    })
  })
  $('customClear').addEventListener('click', () => {
    song.custom = '.'.repeat(CUSTOM_STEPS)
    commit()
  })
  rowToggle.addEventListener('click', () => {
    song.tilted = !song.tilted
    if (song.tilted) slot = ROW + (slot % ROW)
    else slot %= ROW
    commit()
    slotInputs[slot].focus({ preventScroll: true })
  })
  autoToggle.addEventListener('click', () => {
    song.auto = !song.auto
    commit()
  })
  holdToggle.addEventListener('click', () => {
    song.hold = !song.hold
    commit()
  })
  bpmRange.addEventListener('input', () => {
    song.bpm = clampBpm(Number(bpmRange.value))
    commit()
  })
  // Typing "1" on the way to "120" must not snap to 40, so the number only clamps once it's done.
  bpmNumber.addEventListener('change', () => {
    const n = Number(bpmNumber.value)
    if (bpmNumber.value !== '' && Number.isFinite(n)) song.bpm = clampBpm(n)
    commit()
  })

  const opener = $<HTMLButtonElement>('musicButton')
  function close() {
    if (modal.classList.contains('hidden')) return
    modal.classList.add('hidden')
    opener.focus({ preventScroll: true })
  }
  playButton.addEventListener('click', () => {
    song.on = true
    commit()
    close()
  })
  offButton.addEventListener('click', () => {
    song.on = false
    commit()
    close()
  })
  $('closeMusic').addEventListener('click', close)
  modal.addEventListener('click', (e) => e.target === modal && close())

  return {
    open(at: number | null) {
      if (at !== null) slot = at
      if (!song.tilted) slot %= ROW
      sync()
      modal.classList.remove('hidden')
      slotInputs[slot].focus({ preventScroll: true })
    },
    close,
    get isOpen() {
      return !modal.classList.contains('hidden')
    },
  }
}
