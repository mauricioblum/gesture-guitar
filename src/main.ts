import './style.css'
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { GuitarEngine, PM_CHOKE_T60, TONES, type Pluck, type ToneId } from './audio/engine'
import { PATTERNS, SPREAD, strokeOrder } from './autostrum'
import { ChordStabilizer, GESTURES, isFist, readChord, type Variation } from './gestures'
import { drawPick, renderGuitar, tortoisePattern, type GuitarGeometry } from './guitar-art'
import { loadSong, musicPanel } from './music'
import { layoutStrings, StrumDetector, type Point, type StringLayout } from './strum'
import { tutorial, tutorialSeen } from './tutorial'
import {
  chordName,
  chordRootPc,
  DEGREES,
  KEYS,
  keyLabel,
  midiToFreq,
  romanName,
  sameChord,
  songChordName,
  songVoicing,
  TUNING,
  voicingFor,
  type Chord,
  type Degree,
  type Key,
  type Quality,
  type SongChord,
  type Voicing,
} from './theory'

const MP_VERSION = '1.0.1'
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

const OPEN_VOICING: Voicing = [0, 0, 0, 0, 0, 0]
const DEFAULT_VARIATION: Variation = { quality: 1, high: false }
const NO_SHIFT = { raise: false, lower: false }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const stage = $('stage')
const video = $<HTMLVideoElement>('webcam')
const canvas = $<HTMLCanvasElement>('overlay')
const g = canvas.getContext('2d')!
const chordDisplay = $('chordDisplay')
const romanDisplay = $('romanDisplay')
const keySelect = $<HTMLSelectElement>('keySelect')
const toneSelect = $<HTMLSelectElement>('toneSelect')
const guide = $('guide')
const guideToggle = $<HTMLButtonElement>('guideToggle')
const degreeRows = $('degreeRows')
const helpModal = $('helpModal')
const raiseToggle = $<HTMLButtonElement>('raiseToggle')
const lowerToggle = $<HTMLButtonElement>('lowerToggle')
const letRingToggle = $<HTMLButtonElement>('letRingToggle')
const palmMuteToggle = $<HTMLButtonElement>('palmMuteToggle')
const pmChip = $('pmChip')
const startOverlay = $('startOverlay')
const startButton = $<HTMLButtonElement>('startButton')
const learnButton = $<HTMLButtonElement>('learnButton')
const startNote = $('startNote')
const led = $('led')
const jack = $('inputJack')
const musicButton = $<HTMLButtonElement>('musicButton')

const engine = new GuitarEngine()
const stabilizer = new ChordStabilizer(sameChord)
const detector = new StrumDetector()
const pickPattern = tortoisePattern(g)
const song = loadSong()

let key: Key = 'A'
let landmarker: HandLandmarker | null = null
let lastVideoTime = -1
let hands: { raw: NormalizedLandmark[]; screen: Point[] }[] = []
const shiftAllow = { raise: false, lower: false }
let letRing = false
let pmSwitch = false
let pmPedal = false
let pmFlashAt = -Infinity
let palmShade = 0
let keyboardChord: Chord | null = null
let pointer: Point | null = null

type Mode = 'chord' | 'muted' | 'open'
let current: { chord: Chord | null; slot: number | null; songChord: SongChord | null; mode: Mode; voicing: Voicing } = {
  chord: null,
  slot: null,
  songChord: null,
  mode: 'open',
  voicing: OPEN_VOICING,
}
const vibration = Array.from({ length: 6 }, () => ({ amp: 0, decay: 0.9 }))
let lastHitAt = -Infinity

// ---------- Amp controls ----------

function buildScale(scaleId: string, count: number) {
  const scale = $(scaleId)
  for (let i = 0; i < count; i++) {
    const tick = document.createElement('i')
    tick.style.setProperty('--a', `${-135 + (270 * i) / (count - 1)}deg`)
    scale.prepend(tick)
  }
}

function syncKnob(select: HTMLSelectElement, knobId: string, scaleId: string, valueId: string, text: string) {
  const n = select.options.length
  const i = select.selectedIndex
  $(knobId).style.setProperty('--angle', `${-135 + (270 * i) / (n - 1)}deg`)
  const ticks = $(scaleId).querySelectorAll('i')
  ticks.forEach((t, j) => t.classList.toggle('on', ticks.length - 1 - j === i))
  $(valueId).textContent = text
}

for (const k of KEYS) keySelect.add(new Option(keyLabel(k), k, false, k === key))
for (const [id, t] of Object.entries(TONES)) toneSelect.add(new Option(t.label, id))
buildScale('keyScale', KEYS.length)
buildScale('toneScale', toneSelect.options.length)

const syncKey = () => syncKnob(keySelect, 'keyKnob', 'keyScale', 'keyValue', key)
const syncTone = () =>
  syncKnob(toneSelect, 'toneKnob', 'toneScale', 'toneValue', TONES[toneSelect.value as ToneId].short)
syncKey()
syncTone()

keySelect.addEventListener('change', () => {
  key = keySelect.value as Key
  syncKey()
})
toneSelect.addEventListener('change', () => {
  engine.setTone(toneSelect.value as ToneId)
  syncTone()
})
for (const select of [keySelect, toneSelect]) {
  select.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (select.disabled) return
      const n = select.options.length
      select.selectedIndex = Math.min(n - 1, Math.max(0, select.selectedIndex + Math.sign(e.deltaY)))
      select.dispatchEvent(new Event('change'))
    },
    { passive: false },
  )
}

for (const [btn, k] of [[raiseToggle, 'raise'], [lowerToggle, 'lower']] as const) {
  btn.addEventListener('click', () => {
    shiftAllow[k] = !shiftAllow[k]
    btn.setAttribute('aria-pressed', String(shiftAllow[k]))
  })
}

letRingToggle.addEventListener('click', () => {
  letRing = !letRing
  letRingToggle.setAttribute('aria-pressed', String(letRing))
  engine.setLetRing(letRing)
})

palmMuteToggle.addEventListener('click', () => {
  pmSwitch = !pmSwitch
  palmMuteToggle.setAttribute('aria-pressed', String(pmSwitch))
})

// Mouse-clicked amp buttons give focus back, so Space stays the P.M. pedal instead of re-clicking them.
for (const b of document.querySelectorAll<HTMLButtonElement>('#amp button')) {
  b.addEventListener('click', (e) => e.detail > 0 && b.blur())
}

const setPedal = (on: boolean) => {
  pmPedal = on
  palmMuteToggle.toggleAttribute('data-held', on)
}
// Chromium treats a mouse-focused <select> as :focus-visible, so track Tab navigation ourselves.
let keyboardNav = false
window.addEventListener('keydown', (e) => e.key === 'Tab' && (keyboardNav = true), true)
window.addEventListener('pointerdown', () => (keyboardNav = false), true)
const modalOpen = () => !helpModal.classList.contains('hidden') || panel.isOpen
const isPedal = (e: KeyboardEvent) =>
  e.code === 'Space' &&
  !modalOpen() &&
  !(keyboardNav && (e.target instanceof HTMLButtonElement || e.target instanceof HTMLSelectElement))
window.addEventListener('keydown', (e) => {
  if (!isPedal(e)) return
  e.preventDefault()
  setPedal(true)
})
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return
  if (pmPedal) e.preventDefault()
  setPedal(false)
})
window.addEventListener('blur', () => setPedal(false))
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return
  setPedal(false)
  // The strum lives on the audio thread; without frames nobody could change or stop the chord.
  engine.setAuto(null)
})

degreeRows.innerHTML = GESTURES.map(
  (gesture) => `<li><span class="gesture">${gesture}</span><span class="roman"></span><b class="chord"></b></li>`,
).join('')

const setGuide = (open: boolean) => {
  guide.classList.toggle('hidden', !open)
  guideToggle.setAttribute('aria-expanded', String(open))
}
guideToggle.addEventListener('click', () => {
  const open = guide.classList.contains('hidden')
  setGuide(open)
  // The closing card points here, so opening the guide dismisses it.
  if (open) lesson.close()
})
$('helpButton').addEventListener('click', () => helpModal.classList.remove('hidden'))
$('closeHelp').addEventListener('click', () => helpModal.classList.add('hidden'))
helpModal.addEventListener('click', (e) => e.target === helpModal && helpModal.classList.add('hidden'))
$('lessonButton').addEventListener('click', () => {
  helpModal.classList.add('hidden')
  lesson.start()
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!modalOpen()) lesson.close()
    helpModal.classList.add('hidden')
    panel.close()
  }
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || modalOpen()) return
  if (e.key === '0' || e.key === ')') keyboardChord = null
  const n = Number(e.code.replace('Digit', ''))
  if (n >= 1 && n <= 7) keyboardChord = { degree: DEGREES[n - 1], major: !e.shiftKey, shift: 'off', ...DEFAULT_VARIATION }
})

// ---------- Music mode ----------

const lesson = tutorial({ changed: applyMode, key: () => key })
/** The lesson teaches the free mode, so a saved song waits until it ends. */
const musicOn = () => song.on && !lesson.active
const autoOn = () => musicOn() && song.auto
/** Music mode only reads which gesture is up, so tilt and height can't restart the chord. */
const gestureOnly = (c: Chord | null): Chord | null => c && { ...c, major: true, shift: 'off' }
const slotOf = (d: Degree) => DEGREES.indexOf(d)

function ring(string: number, velocity: number, muted: boolean, palm: boolean) {
  const v = vibration[string]
  v.amp = Math.max(v.amp, (muted ? 1.5 : palm ? 2.4 : 6) * (0.4 + velocity))
  v.decay = muted || palm ? 0.78 : 0.9
}

const notesOf = (v: Voicing) => v.flatMap((f, string) => (f === null ? [] : [{ string, freq: midiToFreq(TUNING[string] + f) }]))

engine.onStroke = (e) => {
  for (const s of e.strings) ring(s, e.velocity, false, e.palmMute)
  lastHitAt = performance.now()
  if (e.palmMute) pmFlashAt = lastHitAt
}

const panel = musicPanel(song, {
  changed: applyMode,
  preview(c) {
    engine.damp(0.08)
    const notes = strokeOrder(notesOf(songVoicing(c)), 'down')
    engine.pluck(notes.map((n, k) => ({ ...n, velocity: 0.55, delay: 0.02 + k * SPREAD.down })))
    for (const n of notes) ring(n.string, 0.55, false, false)
  },
})

// Holding a gesture while clicking opens straight on its slot.
musicButton.addEventListener('click', () => panel.open(current.slot))

function applyMode() {
  const music = musicOn()
  stage.classList.toggle('music', music)
  stage.classList.toggle('auto', autoOn())
  keySelect.disabled = music
  lowerToggle.disabled = raiseToggle.disabled = song.on || lesson.active
  guideToggle.disabled = lesson.active
  if (lesson.active) setGuide(false)
  musicButton.toggleAttribute('data-on', music)
  musicButton.setAttribute('aria-label', music ? 'Música (modo música ligado)' : 'Música')
}
applyMode()

const pointerPos = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
canvas.addEventListener('pointerdown', (e) => {
  pointer = pointerPos(e)
  try {
    canvas.setPointerCapture(e.pointerId)
  } catch {}
})
canvas.addEventListener('pointermove', (e) => pointer && (pointer = pointerPos(e)))
const release = () => (pointer = null)
canvas.addEventListener('pointerup', release)
canvas.addEventListener('pointercancel', release)

// ---------- Startup ----------

async function startCamera() {
  video.srcObject = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  })
  await new Promise<void>((r) => (video.onloadedmetadata = () => r()))
  await video.play()
}

async function loadLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL)
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
  })
}

async function power(button: HTMLButtonElement, learn: boolean) {
  startButton.disabled = learnButton.disabled = true
  button.toggleAttribute('data-warming', true)
  button.querySelector('.rocker-text')!.textContent = 'Aquecendo…'
  await engine.start()
  engine.setTone(toneSelect.value as ToneId)
  try {
    await startCamera()
    landmarker = await loadLandmarker()
    jack.classList.add('live')
  } catch (err) {
    console.error(err)
    stage.classList.add('no-camera')
    startNote.textContent = 'A câmera não abriu. Dá pra tocar com o mouse e as teclas 1–7.'
    await new Promise((r) => setTimeout(r, 2200))
  }
  startOverlay.classList.add('hidden')
  if (learn) lesson.start()
}

startButton.addEventListener('click', () => power(startButton, false))
learnButton.addEventListener('click', () => power(learnButton, true))
// Once the lesson has been seen, plain "Ligar" becomes the main switch.
if (tutorialSeen()) {
  learnButton.classList.add('dark')
  startButton.classList.remove('dark')
}

// ---------- Geometry ----------

let W = 0
let H = 0
let layout: StringLayout
let art: { canvas: HTMLCanvasElement; geo: GuitarGeometry }

/** Palm-mute lane past the bridge pins; `exit` < `enter` is the hysteresis band while chugging. */
interface PmBounds {
  exit: number
  enter: number
  outer: number
  reach: number
}
let pm: PmBounds

function pmBounds(): PmBounds {
  const { x0, x1, spacing: sp } = layout
  const [e0, e1] = zoneEdges()
  const landscape = W >= H
  const enter = x1 + sp * (landscape ? 0.75 : 0.35)
  const exit = x1 - sp * (landscape ? 0.5 : 0.2)
  const outer = Math.min(enter + Math.max(e1 - e0, sp * 1.1), landscape ? W * 0.94 : W - sp * 0.25)
  const reach = Math.min(outer + (x1 - x0) * 0.08, landscape ? W * 0.965 : W - 2)
  return { exit, enter, outer, reach }
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const r = canvas.getBoundingClientRect()
  W = r.width
  H = r.height
  canvas.width = Math.round(W * dpr)
  canvas.height = Math.round(H * dpr)
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  layout = layoutStrings(W, H)
  art = renderGuitar(layout, W, H, dpr)
  pm = pmBounds()
}
window.addEventListener('resize', resize)
resize()

/** object-fit: cover crop of the camera frame, in video pixels. */
function coverCrop() {
  const vw = video.videoWidth
  const vh = video.videoHeight
  const scale = Math.max(W / vw, H / vh)
  const sw = W / scale
  const sh = H / scale
  return { vw, vh, sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh }
}

function toScreen(p: NormalizedLandmark, c: ReturnType<typeof coverCrop>): Point {
  return {
    x: W - ((p.x * c.vw - c.sx) / c.sw) * W,
    y: ((p.y * c.vh - c.sy) / c.sh) * H,
  }
}

// ---------- Main loop ----------

function detect(now: number) {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return
  lastVideoTime = video.currentTime
  const res = landmarker.detectForVideo(video, now)
  const crop = coverCrop()
  hands = res.landmarks.map((raw) => ({ raw, screen: raw.map((p) => toScreen(p, crop)) }))
}

/**
 * Assign roles by screen position (mirrored view): leftmost hand frets, rightmost strums.
 * With the auto strum nothing needs strumming, so a lone hand always frets.
 */
function splitHands(auto: boolean) {
  if (hands.length >= 2) {
    const [a, b] = [...hands].sort((h1, h2) => h1.screen[0].x - h2.screen[0].x)
    return { left: a, right: b }
  }
  if (hands.length === 1) {
    return auto || hands[0].screen[0].x < W / 2 ? { left: hands[0], right: null } : { left: null, right: hands[0] }
  }
  return { left: null, right: null }
}

// Strum zones along the body, neck side → bridge. The zone is read where a strum starts
// and held for the rest of that strum, so drifting sideways mid-stroke can't flip it.
const ZONE_QUALITIES: Quality[] = [1, 4, 3, 2]
const STRUM_HOLD_MS = 160
const PM_ZONE = ZONE_QUALITIES.length
const PM_STICKY_MS = 600
const PM_FLASH_MS = 260
let activeZone = 0
let strumLock: { zone: number; dir: 'down' | 'up'; at: number; pm: boolean } | null = null
/** strings the current strum has crossed so far */
const stroke = new Set<number>()

const qualityOf = (z: number): Quality => ZONE_QUALITIES[z] ?? ZONE_QUALITIES[0]
const pmSticky = (now: number) => !!strumLock && strumLock.zone === PM_ZONE && now - strumLock.at < PM_STICKY_MS
const onBridge = (x: number, now: number) => x < pm.reach && x >= (pmSticky(now) ? pm.exit : pm.enter)

interface PmUi {
  live: boolean
  lit: boolean
  armed: boolean
  forced: boolean
}

function zoneEdges() {
  const start = art.geo.soundhole.x + art.geo.soundhole.r * 0.9
  const w = (layout.x1 - start) / 3
  return [start, start + w, start + 2 * w]
}

const zoneAt = (x: number) => zoneEdges().filter((e) => x > e).length

function zoneLabel(q: Quality, major: boolean) {
  if (q === 2) return 'Inv ⁶'
  if (q === 3) return major ? 'maj7' : 'm7'
  if (q === 4) return major ? '7' : '°7'
  return 'Normal'
}

function frame(now: number) {
  detect(now)
  const auto = autoOn()
  const { left, right } = splitHands(auto)

  const music = musicOn()
  const read = left ? readChord(left.raw, DEFAULT_VARIATION, lesson.active ? NO_SHIFT : shiftAllow) : null
  const live = music ? gestureOnly(read) : read
  const base = stabilizer.update(left ? live : music ? gestureOnly(keyboardChord) : keyboardChord, now)
  const slot = base ? slotOf(base.degree) : null
  const songChord = music && slot !== null ? song.slots[slot] : null
  const mode: Mode = (music ? songChord : base) ? 'chord' : left && isFist(left.raw) ? 'muted' : 'open'

  const pick = auto ? null : right ? right.screen[8] : pointer
  const hits = detector.update(pick, now, layout, H, pm.reach)
  let strokeStart = false
  if (auto) strumLock = null
  if (hits.length) {
    const { direction: dir, x } = hits[0]
    const held = !!strumLock && strumLock.dir === dir && now - strumLock.at < STRUM_HOLD_MS
    let strokePm: boolean
    if (held) {
      activeZone = strumLock!.zone
      strokePm = strumLock!.pm
    } else {
      activeZone = onBridge(x, now) ? PM_ZONE : music ? 0 : zoneAt(x)
      strokePm = activeZone === PM_ZONE || pmSwitch || pmPedal
      strokeStart = true
    }
    strumLock = { zone: activeZone, dir, at: now, pm: strokePm }
  }
  if (strokeStart) stroke.clear()
  for (const h of hits) stroke.add(h.string)

  const chord = base && !music ? { ...base, quality: qualityOf(activeZone) } : null
  const voicing = songChord ? songVoicing(songChord) : chord ? voicingFor(chord, chordRootPc(chord, key)) : OPEN_VOICING
  const changed = !sameChord(chord, current.chord) || songChord !== current.songChord

  if (mode === 'muted' && current.mode !== 'muted') engine.damp(0.05)
  else if (!letRing && changed) {
    // Lifting a finger only silences the strings whose note actually changes.
    voicing.forEach((f, i) => f !== current.voicing[i] && engine.damp(0.14, i))
  }
  if ((chord || songChord) && changed) {
    chordDisplay.classList.remove('pop')
    void chordDisplay.offsetWidth
    chordDisplay.classList.add('pop')
  }
  current = { chord, slot, songChord, mode, voicing }

  if (hits.length) {
    const muted = mode === 'muted'
    const palm = !muted && strumLock!.pm
    // The palm landing covers all six strings, so it also chokes let-ring tails and earlier chugs.
    if (palm && strokeStart) engine.damp(PM_CHOKE_T60)
    if (palm) pmFlashAt = now
    const plucks: Pluck[] = []
    for (const h of hits) {
      const fret = voicing[h.string]
      if (fret === null) continue
      plucks.push({
        string: h.string,
        freq: midiToFreq(TUNING[h.string] + fret),
        velocity: muted ? h.velocity * 0.7 : h.velocity,
        delay: h.offset,
        t60: muted ? 0.035 : undefined,
        palmMute: palm,
      })
      ring(h.string, h.velocity, muted, palm)
    }
    engine.pluck(plucks)
    lastHitAt = now
  }

  engine.setAuto(
    auto
      ? {
          notes: mode === 'chord' && !panel.isOpen ? notesOf(voicing) : null,
          bpm: song.bpm,
          steps: PATTERNS[song.pattern].steps,
          palmMute: pmSwitch || pmPedal,
        }
      : null,
  )

  const pmLive = mode !== 'muted'
  const forced = pmSwitch || pmPedal
  const lit = pmLive && (forced || !!strumLock?.pm)
  const { ys, spacing: sp } = layout
  const armed =
    pmLive && !lit && !!pick && onBridge(pick.x, now) && pick.y > ys[0] - 2 * sp && pick.y < ys[5] + 2 * sp
  const pmUi: PmUi = { live: pmLive, lit, armed, forced }

  lesson.update(chord, base, hits.length && mode !== 'muted' ? stroke.size : 0)
  const aim = lesson.target
  render(now, voicing, left, right, pick, mode, base?.major ?? true, pmUi, aim ? ZONE_QUALITIES.indexOf(aim.quality) : -1)
  updateHud(chord, slot, mode, live, DEFAULT_VARIATION, !!left || !!right, now, lit)
  requestAnimationFrame(frame)
}

// ---------- Rendering ----------

function render(
  now: number,
  voicing: Voicing,
  left: { screen: Point[] } | null,
  right: { screen: Point[] } | null,
  pick: Point | null,
  mode: Mode,
  major: boolean,
  pmUi: PmUi,
  aim: number,
) {
  g.clearRect(0, 0, W, H)
  if (video.videoWidth) {
    const c = coverCrop()
    g.save()
    g.translate(W, 0)
    g.scale(-1, 1)
    g.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H)
    g.restore()
  }
  g.fillStyle = 'rgba(16, 10, 6, 0.58)'
  g.fillRect(0, 0, W, H)

  g.save()
  g.globalAlpha = 0.82
  g.drawImage(art.canvas, 0, 0, W, H)
  g.restore()

  drawZones(major, mode === 'chord', pmUi, aim)
  drawFingering(voicing, mode)
  drawStrings(now, voicing)
  drawPalm(now, pmUi)

  if (left) drawHand(left.screen, 'rgba(230, 198, 119, 0.9)')
  if (right) drawHand(right.screen, 'rgba(239, 228, 200, 0.7)')
  if (pick) drawPick(g, pick.x, pick.y, 13, pickPattern)
}

function drawHand(pts: Point[], color: string) {
  g.strokeStyle = color
  g.lineWidth = 2
  g.lineCap = 'round'
  g.beginPath()
  for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
    g.moveTo(pts[start].x, pts[start].y)
    g.lineTo(pts[end].x, pts[end].y)
  }
  g.stroke()
  g.fillStyle = color
  for (const p of pts) {
    g.beginPath()
    g.arc(p.x, p.y, 3, 0, Math.PI * 2)
    g.fill()
  }
}

/** `aim` is the zone the lesson wants strummed, outlined until it lights up. */
function drawZones(major: boolean, enabled: boolean, pmUi: PmUi, aim: number) {
  const edges = zoneEdges()
  const bounds = [layout.x0, ...edges, layout.x1]
  const top = layout.ys[0] - layout.spacing * 0.9
  const bottom = layout.ys[5] + layout.spacing * 0.9
  g.save()
  g.font = `700 ${Math.round(Math.max(11, layout.spacing * 0.42))}px 'Barlow Condensed', sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // Music mode strums the chosen chord anywhere on the body, so only the P.M. lane is left.
  if (musicOn()) {
    drawPmChip(top, bottom, -Infinity, pmUi)
    g.restore()
    return
  }
  g.strokeStyle = 'rgba(239,228,200,0.35)'
  g.lineWidth = 1
  g.setLineDash([3, 5])
  for (const x of edges) {
    g.beginPath()
    g.moveTo(x, top)
    g.lineTo(x, bottom)
    g.stroke()
  }
  g.setLineDash([])
  let invRight = 0
  ZONE_QUALITIES.forEach((q, i) => {
    const x = (bounds[i] + bounds[i + 1]) / 2
    const label = zoneLabel(q, major).toUpperCase()
    const on = enabled && i === activeZone
    const aimed = !on && i === aim
    const w = g.measureText(label).width + 12
    const h = layout.spacing * 0.62
    g.fillStyle = on ? '#e6c677' : 'rgba(20,12,6,0.6)'
    g.beginPath()
    g.roundRect(x - w / 2, top - h, w, h, 3)
    g.fill()
    if (aimed) {
      g.strokeStyle = '#e6c677'
      g.lineWidth = 1.5
      g.stroke()
    }
    g.fillStyle = on ? '#2a1d0c' : aimed ? '#efe4c8' : 'rgba(239,228,200,0.8)'
    g.fillText(label, x, top - h / 2 + 1)
    invRight = x + w / 2
  })
  drawPmChip(top, bottom, invRight, pmUi)
  g.restore()
}

function drawPmChip(top: number, bottom: number, invRight: number, ui: PmUi) {
  const label = 'P.M.'
  const w = g.measureText(label).width + 12
  const h = layout.spacing * 0.62
  const x = Math.min((pm.enter + pm.outer) / 2, W - w / 2 - 4)
  const y = x - w / 2 < invRight + 4 ? bottom + h + 4 : top
  g.globalAlpha = ui.live ? 1 : 0.4
  g.beginPath()
  g.roundRect(x - w / 2, y - h, w, h, 3)
  g.fillStyle = ui.lit ? '#e6c677' : 'rgba(20,12,6,0.6)'
  g.fill()
  if (ui.armed) {
    g.strokeStyle = '#e6c677'
    g.lineWidth = 1.5
    g.stroke()
  }
  g.fillStyle = ui.lit ? '#2a1d0c' : ui.armed ? '#efe4c8' : 'rgba(239,228,200,0.8)'
  g.fillText(label, x, y - h / 2 + 1)
  g.globalAlpha = 1
}

/** A soft shadow over saddle and pins, like the heel of the hand resting there. */
function drawPalm(now: number, ui: PmUi) {
  const flash = Math.max(0, 1 - (now - pmFlashAt) / PM_FLASH_MS)
  const target = ui.live ? Math.max(ui.forced || ui.armed ? 0.45 : 0, flash) : 0
  palmShade += (target - palmShade) * 0.3
  if (palmShade < 0.02) return
  const { x1, ys, spacing: sp } = layout
  const ry = (ys[5] - ys[0]) / 2 + sp * 0.8
  g.save()
  g.globalAlpha = palmShade
  g.translate(x1 + sp * 0.6, (ys[0] + ys[5]) / 2)
  g.scale((sp * 1.7) / ry, 1)
  const shade = g.createRadialGradient(0, 0, 0, 0, 0, ry)
  shade.addColorStop(0, 'rgba(16,9,4,0.6)')
  shade.addColorStop(0.65, 'rgba(16,9,4,0.32)')
  shade.addColorStop(1, 'rgba(16,9,4,0)')
  g.fillStyle = shade
  g.beginPath()
  g.arc(0, 0, ry, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

/** Chord-chart dots on the fretboard, with open/muted marks behind the nut. */
function drawFingering(voicing: Voicing, mode: Mode) {
  const { fretX } = art.geo
  const r = layout.spacing * 0.3
  g.save()
  g.font = `700 ${Math.round(r * 1.2)}px 'Barlow Condensed', sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  layout.ys.forEach((y, i) => {
    const f = voicing[i]
    const mx = layout.nut - r * 1.5
    if (mode === 'muted' || f === null) {
      g.strokeStyle = mode === 'muted' ? 'rgba(239,228,200,0.85)' : 'rgba(239,228,200,0.55)'
      g.lineWidth = 2
      const s = r * 0.55
      g.beginPath()
      g.moveTo(mx - s, y - s)
      g.lineTo(mx + s, y + s)
      g.moveTo(mx + s, y - s)
      g.lineTo(mx - s, y + s)
      g.stroke()
      return
    }
    if (f === 0) {
      g.strokeStyle = 'rgba(239,228,200,0.9)'
      g.lineWidth = 2
      g.beginPath()
      g.arc(mx, y, r * 0.6, 0, Math.PI * 2)
      g.stroke()
      return
    }
    const x = (fretX(f - 1) + fretX(f)) / 2
    g.shadowColor = 'rgba(0,0,0,0.6)'
    g.shadowBlur = 6
    g.shadowOffsetY = 2
    const dot = g.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r)
    dot.addColorStop(0, '#fff6d8')
    dot.addColorStop(0.55, '#e6c677')
    dot.addColorStop(1, '#a67c34')
    g.fillStyle = dot
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
    g.shadowColor = 'transparent'
    g.fillStyle = '#2a1d0c'
    g.fillText(String(f), x, y + 1)
  })
  g.restore()
}

function drawStrings(now: number, voicing: Voicing) {
  const { nut, x1, ys } = layout
  const len = x1 - nut
  g.save()
  g.lineCap = 'round'
  ys.forEach((y, i) => {
    const v = vibration[i]
    v.amp *= v.decay
    const phase = now * 0.06 * (1 + (5 - i) * 0.18)
    const wound = i < 4
    const muted = voicing[i] === null
    const thick = 3.2 - i * 0.42
    g.strokeStyle = 'rgba(0,0,0,0.35)'
    g.lineWidth = thick + 1
    g.beginPath()
    g.moveTo(nut, y + 3)
    g.lineTo(x1, y + 3)
    g.stroke()

    const idle = muted ? 'rgba(150,130,100,0.55)' : wound ? '#c99a5c' : '#d8d8d4'
    g.strokeStyle = idle
    g.lineWidth = thick * 0.9
    g.beginPath()
    g.moveTo(x1, y)
    g.lineTo(x1 + layout.spacing * 0.75, y)
    g.stroke()

    const ringing = v.amp > 0.4
    g.strokeStyle = muted ? idle : !ringing ? idle : wound ? '#f2cf8e' : '#fbfaf5'
    g.lineWidth = thick
    g.beginPath()
    for (let s = 0; s <= 56; s++) {
      const t = s / 56
      const dy = Math.sin(Math.PI * t) * Math.sin(phase) * v.amp
      const x = nut + t * len
      s === 0 ? g.moveTo(x, y + dy) : g.lineTo(x, y + dy)
    }
    g.stroke()
    if (wound) {
      g.strokeStyle = 'rgba(255,240,210,0.35)'
      g.lineWidth = 0.8
      g.beginPath()
      g.moveTo(nut, y - thick * 0.25)
      g.lineTo(x1, y - thick * 0.25)
      g.stroke()
    }
  })
  g.restore()
}

// ---------- HUD ----------

let lastLabel = ''
let lastRoman = ''

function updateHud(
  chord: Chord | null,
  slot: number | null,
  mode: Mode,
  live: Chord | null,
  variation: Variation,
  handsIn: boolean,
  now: number,
  pmOn: boolean,
) {
  const music = musicOn()
  const songChord = music && slot !== null ? song.slots[slot] : null
  const label = songChord ? songChordName(songChord) : chord ? chordName(chord, key) : mode === 'muted' ? '✕' : '—'
  if (label !== lastLabel) {
    chordDisplay.textContent = label
    lastLabel = label
  }
  const tag = pmOn ? ' · P.M.' : ''
  const tempo = autoOn() ? `${song.bpm} BPM` : ''
  const roman =
    music && slot !== null
      ? songChord
        ? `música · ${slot + 1}${tempo && ` · ${tempo}`}${tag}`
        : `${slot + 1} · sem acorde`
      : chord
        ? `${romanName(chord)}${chord.high ? ' · alto' : ''}${tag}`
        : mode === 'muted'
          ? 'abafado'
          : tempo
            ? `${tempo} · mostre um acorde`
            : handsIn
              ? `cordas soltas${tag}`
              : 'mostre as mãos'
  if (roman !== lastRoman) {
    romanDisplay.textContent = roman
    lastRoman = roman
  }

  led.classList.toggle('on', handsIn || !!chord || !!songChord)
  led.classList.toggle('hit', now - lastHitAt < 90)

  if (guide.classList.contains('hidden')) return
  const rows = degreeRows.children as HTMLCollectionOf<HTMLElement>
  if (music) {
    const shownSlot = live ? slotOf(live.degree) : slot
    for (let i = 0; i < rows.length; i++) {
      const c = song.slots[i]
      rows[i].classList.toggle('active', i === shownSlot)
      rows[i].querySelector('.roman')!.textContent = ''
      rows[i].querySelector('.chord')!.textContent = c ? songChordName(c) : '—'
    }
  } else {
    const shown = live ?? chord
    // Preview what each finger count would play with the current tilt/quality.
    const preview = { major: shown?.major ?? true, shift: shown?.shift ?? 'off', ...variation }
    for (let i = 0; i < rows.length; i++) {
      const c: Chord = { degree: DEGREES[i], ...preview }
      rows[i].classList.toggle('active', !!shown && c.degree === shown.degree)
      rows[i].querySelector('.roman')!.textContent = romanName(c)
      rows[i].querySelector('.chord')!.textContent = chordName(c, key)
    }
    $('tiltMajor').classList.toggle('active', !!shown && shown.major)
    $('tiltMinor').classList.toggle('active', !!shown && !shown.major)
  }
  $('fistChip').classList.toggle('active', mode === 'muted')
  pmChip.classList.toggle('active', pmOn)
}

requestAnimationFrame(frame)
