import { arrows, PATTERNS, type PatternId } from './autostrum'
import { GESTURES } from './gestures'
import { CHORD_TYPES, NOTE_NAMES, songChordName, type ChordTypeId, type SongChord } from './theory'

const BPM_MIN = 40
const BPM_MAX = 200
const STORAGE_KEY = 'gesture-guitar:song'

export interface Song {
  on: boolean
  /** one chord per left-hand gesture, in GESTURES order */
  slots: (SongChord | null)[]
  auto: boolean
  bpm: number
  pattern: PatternId
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
  ],
  auto: false,
  bpm: 90,
  pattern: 'pop',
})

const clampBpm = (n: number) => Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, n)))

const isKey = <T extends object>(o: T, k: unknown): k is keyof T => typeof k === 'string' && Object.hasOwn(o, k)

function parseChord(c: unknown): SongChord | null {
  if (!c || typeof c !== 'object') return null
  const { root, type } = c as Record<string, unknown>
  return typeof root === 'number' && Number.isInteger(root) && root >= 0 && root < 12 && isKey(CHORD_TYPES, type)
    ? { root, type }
    : null
}

export function loadSong(): Song {
  const song = defaults()
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!saved || typeof saved !== 'object') return song
    song.on = saved.on === true
    if (Array.isArray(saved.slots)) song.slots = song.slots.map((_, i) => parseChord(saved.slots[i]))
    song.auto = saved.auto === true
    if (Number.isFinite(saved.bpm)) song.bpm = clampBpm(saved.bpm)
    if (isKey(PATTERNS, saved.pattern)) song.pattern = saved.pattern
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
  const bpmRange = $<HTMLInputElement>('bpmRange')
  const bpmNumber = $<HTMLInputElement>('bpmNumber')
  const playButton = $<HTMLButtonElement>('musicOn')
  const offButton = $<HTMLButtonElement>('musicOff')

  const slotInputs = radios(
    $('slotPicker'),
    'slot',
    GESTURES.map((g, i) => ({
      value: String(i),
      html: `<span class="slot-face"><span class="gesture" aria-hidden="true">${g}</span><b class="slot-chord"></b></span>`,
    })),
    'slot',
  )
  const rootInputs = radios($('rootPicker'), 'root', [
    ...NOTE_NAMES.map((n, i) => ({ value: String(i), html: `<span>${n}</span>` })),
    { value: '', html: '<span>—</span>', label: 'Sem acorde', title: 'Sem acorde' },
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
    (Object.keys(PATTERNS) as PatternId[]).map((p) => ({
      value: p,
      html: `<span><b>${arrows(PATTERNS[p].steps)}</b>${PATTERNS[p].name}</span>`,
      label: PATTERNS[p].name,
    })),
    'chip pattern',
  )
  bpmRange.min = bpmNumber.min = String(BPM_MIN)
  bpmRange.max = bpmNumber.max = String(BPM_MAX)

  let slot = 0
  let pendingType: ChordTypeId = 'maj'

  function sync() {
    slotInputs.forEach((input, i) => {
      const c = song.slots[i]
      input.checked = i === slot
      const label = c ? songChordName(c) : '—'
      input.setAttribute('aria-label', `Gesto ${i + 1}: ${c ? label : 'sem acorde'}`)
      const name = input.parentElement!.querySelector('.slot-chord')!
      name.textContent = label
      name.classList.toggle('empty', !c)
      name.classList.toggle('long', label.length > 6)
    })
    const c = song.slots[slot]
    if (c) pendingType = c.type
    for (const r of rootInputs) r.checked = r.value === (c ? String(c.root) : '')
    for (const t of typeInputs) t.checked = t.value === pendingType
    autoToggle.setAttribute('aria-pressed', String(song.auto))
    bpmRange.value = bpmNumber.value = String(song.bpm)
    for (const p of patternInputs) p.checked = p.value === song.pattern
    offButton.hidden = !song.on
    playButton.disabled = !song.slots.some(Boolean)
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
    input.addEventListener('change', () => setChord(input.value === '' ? null : { root: Number(input.value), type: pendingType }))
  }
  for (const input of typeInputs) {
    input.addEventListener('change', () => {
      pendingType = input.value as ChordTypeId
      const c = song.slots[slot]
      if (c) setChord({ root: c.root, type: pendingType })
    })
  }
  for (const input of patternInputs) {
    input.addEventListener('change', () => {
      song.pattern = input.value as PatternId
      commit()
    })
  }
  autoToggle.addEventListener('click', () => {
    song.auto = !song.auto
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
