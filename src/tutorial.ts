import { GESTURES } from './gestures'
import { chordName, type Chord, type Degree, type Key, type Quality } from './theory'

const STORAGE_KEY = 'gesture-guitar:lesson'
/** Strings one stroke has to cross, so a hand brushing a string on its way in doesn't count. */
const STRUM = 3
const NEXT_MS = 1600
const END_MS = 4500

interface Target {
  degree: Degree
  major: boolean
  quality: Quality
}

interface Step {
  /** `null` takes any strum, open strings included */
  target: Target | null
  cue: string
  /** defaults to the target's name in the current key */
  title?: string
  left?: string
  right: string
  text: string
  keys: string
  done: string
}

const PICK = '☝️'

const STEPS: Step[] = [
  {
    target: null,
    cue: 'Com a mão direita',
    title: 'Palhete',
    right: PICK,
    text: 'A ponta do indicador é a <b>palheta</b>. Passe ela pelas cordas, em cima da boca do violão.',
    keys: 'Sem câmera: arraste o mouse pelas cordas.',
    done: 'Isso! Essas são as cordas soltas.',
  },
  {
    target: { degree: 'I', major: true, quality: 1 },
    cue: 'Toque',
    left: GESTURES[0],
    right: PICK,
    text: 'A mão esquerda escolhe o acorde pelo <b>número de dedos</b>. Levante 1 e palhete.',
    keys: 'Sem câmera: aperte 1 e arraste.',
    done: 'Seu primeiro acorde!',
  },
  {
    target: { degree: 'IV', major: true, quality: 1 },
    cue: 'Toque',
    left: GESTURES[3],
    right: PICK,
    text: 'Agora levante <b>4&nbsp;dedos</b>: é o quarto acorde do tom.',
    keys: 'Sem câmera: aperte 4 e arraste.',
    done: 'Trocou de acorde!',
  },
  {
    target: { degree: 'IV', major: false, quality: 1 },
    cue: 'Toque',
    left: `${GESTURES[3]}↖`,
    right: PICK,
    text: 'Mantenha os 4&nbsp;dedos e incline a mão <b>pra fora</b>: o&nbsp;acorde fica menor.',
    keys: 'Sem câmera: Shift + 4 e arraste.',
    done: 'Menor soa mais triste, né?',
  },
  {
    target: { degree: 'I', major: true, quality: 4 },
    cue: 'Toque',
    left: GESTURES[0],
    right: `${PICK}<b class="zone-tag">7</b>`,
    text: 'Volte pro 1&nbsp;dedo e palhete <b>em cima do&nbsp;7</b>: o lugar onde você palheta também muda o&nbsp;acorde.',
    keys: 'Sem câmera: aperte 1 e arraste em cima do 7.',
    done: 'A sétima dá um tempero de blues.',
  },
]

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

export function tutorialSeen() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'seen'
  } catch {
    return false
  }
}

const matches = (c: Chord | null, t: Target) => !!c && c.degree === t.degree && c.major === t.major
const spot = (t: Target) => (t.quality === 1 ? 'em cima da boca' : 'em cima do 7')

interface TutorialHooks {
  /** the lesson started or ended */
  changed(): void
  key(): Key
}

export function tutorial(hooks: TutorialHooks) {
  const card = $('tutorial')
  const body = $('tutorialBody')
  const leds = $('tutorialLeds')
  const cue = $('tutorialCue')
  const title = $('tutorialTitle')
  const left = $('tutorialLeft')
  const right = $('tutorialRight')
  const text = $('tutorialText')
  const keys = $('tutorialKeys')
  const led = $('tutorialLed')
  const status = $('tutorialStatus')

  leds.innerHTML = STEPS.map(() => '<i></i>').join('')

  let active = false
  let step = 0
  let passed = false
  /** strummed the right chord, but in the wrong zone */
  let missed = false
  let key = hooks.key()
  let timer = 0
  let said = ''

  const nameOf = (t: Target) => chordName({ ...t, shift: 'off', high: false }, key)
  const chip = (t: Target) => `<b>${nameOf(t)}</b>`

  function say(line: string) {
    if (line === said) return
    said = line
    status.innerHTML = line
  }

  function lights() {
    Array.from(leds.children).forEach((el, i) => {
      el.classList.toggle('on', i < step || (i === step && passed))
      el.classList.toggle('now', i === step && !passed)
    })
    leds.setAttribute('aria-label', step < STEPS.length ? `Passo ${step + 1} de ${STEPS.length}` : 'Aula completa')
  }

  function enter(state: string) {
    card.dataset.state = state
    lights()
    body.classList.remove('enter')
    void body.offsetWidth
    body.classList.add('enter')
  }

  function paint() {
    key = hooks.key()
    const s = STEPS[step]
    cue.textContent = s.cue
    title.textContent = s.title ?? nameOf(s.target!)
    left.classList.toggle('hidden', !s.left)
    left.firstElementChild!.innerHTML = s.left ?? ''
    right.firstElementChild!.innerHTML = s.right
    text.innerHTML = s.text
    keys.textContent = s.keys
    say(s.target ? `Esperando o ${chip(s.target)}…` : 'Esperando a palhetada…')
    enter('playing')
  }

  function pass() {
    passed = true
    missed = false
    led.classList.add('on')
    say(STEPS[step].done)
    card.dataset.state = 'passed'
    lights()
    timer = window.setTimeout(next, NEXT_MS)
  }

  function next() {
    step++
    passed = false
    led.classList.remove('on')
    if (step < STEPS.length) return paint()
    active = false
    hooks.changed()
    cue.textContent = 'Aula completa'
    title.textContent = 'Pronto!'
    text.innerHTML = 'Agora é com você. Os outros acordes estão no <b>Guia</b>.'
    enter('end')
    timer = window.setTimeout(close, END_MS)
  }

  function close() {
    clearTimeout(timer)
    card.classList.add('hidden')
    if (!active) return
    active = false
    hooks.changed()
  }

  function start() {
    clearTimeout(timer)
    active = true
    step = 0
    passed = false
    missed = false
    led.classList.remove('on')
    try {
      localStorage.setItem(STORAGE_KEY, 'seen')
    } catch {}
    card.classList.remove('hidden')
    paint()
    hooks.changed()
  }

  /** Once per frame: `stroke` is how many strings the current strum has crossed, 0 when nothing was hit. */
  function update(played: Chord | null, held: Chord | null, stroke: number) {
    if (!active || passed) return
    if (hooks.key() !== key) paint()
    const t = STEPS[step].target
    if (stroke >= STRUM) {
      if (!t || (matches(played, t) && played!.quality === t.quality)) return pass()
      missed ||= matches(played, t)
    }
    const holding = !!t && matches(held, t)
    if (!holding) missed = false
    if (!t) return
    say(
      missed
        ? `Quase: palhete ${spot(t)}`
        : holding
          ? `Isso, agora palhete${t.quality === 1 ? '' : ` ${spot(t)}`}!`
          : `Esperando o ${chip(t)}…`,
    )
  }

  $('tutorialExit').addEventListener('click', close)

  return {
    start,
    close,
    update,
    get active() {
      return active
    },
    /** zone quality the canvas points the player at; open strings are taught over the soundhole */
    get aim(): Quality | null {
      return active && !passed ? (STEPS[step].target?.quality ?? 1) : null
    },
  }
}
