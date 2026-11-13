import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__work-brief__set'
const STALE_AFTER = 15

const BAND = {
  plugin: 'work-brief',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const TURN = {
  answer: 'Done.',
  durationMs: 1000,
  isAborted: false,
  turnId: 'turn-1',
  reason: 'answer',
} as const

const PLAN = {
  tool: TOOL,
  goal: 'Fix the login bug',
  steps: ['Reproduce it', 'Patch the handler', 'Run the suite'],
  current: 1,
} as const

test('a brief the model sets is drawn above the prompt', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('clock.every', () => ({ value: undefined }))
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call(PLAN)
  expect(ran.deny).toBe(undefined)

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Working on/ }))?.text).toBe(
    'Working on: Fix the login bug',
  )
  expect((await ui.find({ type: 'Text', text: /Reproduce/ }))?.text).toBe(
    '[x] Reproduce it',
  )
  expect((await ui.find({ type: 'Text', text: /suite/ }))?.text).toBe(
    '[ ] Run the suite',
  )
  await ui.unmount()
})

test('the border, the current step and done steps are colored', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  await $.tool.call(PLAN)

  const ui = await $.ui.mount(BAND)
  const color = async (text: RegExp) =>
    (await ui.find({ type: 'Text', text }))?.props.color

  expect((await ui.find({ type: 'Box' }))?.props.borderColor).toBe('suggestion')
  expect(await color(/Working on/)).toBe(undefined)
  expect(await color(/Reproduce/)).toBe('success')
  expect(await color(/\[>\] Patch/)).toBe('suggestion')
  expect(await color(/suite/)).toBe(undefined)
  await ui.unmount()
})

test('the current step shows how long it has run', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call(PLAN)
  now += 125_000

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /\[>\] Patch/ }))?.text).toBe(
    '[>] Patch the handler  2m 05s',
  )
  await ui.unmount()
})

test('an update on the same step keeps its clock running', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call(PLAN)
  now += 30_000
  await $.tool.call({ ...PLAN, steps: [...PLAN.steps, 'Write it up'] })
  now += 12_000

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /\[>\] Patch/ }))?.text).toBe(
    '[>] Patch the handler  42s',
  )
  await ui.unmount()
})

test('replacing the current step restarts the clock', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call(PLAN)
  now += 30_000
  await $.tool.call({
    ...PLAN,
    steps: ['Reproduce it', 'Rewrite the handler', 'Run the suite'],
  })
  now += 4_000

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /\[>\] Rewrite/ }))?.text).toBe(
    '[>] Rewrite the handler  4s',
  )
  await ui.unmount()
})

test('moving to the next step restarts the clock', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call(PLAN)
  now += 30_000
  await $.tool.call({ ...PLAN, current: 2 })
  now += 7_000

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /\[>\] Run/ }))?.text).toBe(
    '[>] Run the suite  7s',
  )
  await ui.unmount()
})

test('a finished step keeps the time it took', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call({ ...PLAN, current: 0 })
  now += 72_000
  await $.tool.call(PLAN)
  now += 9_000
  await $.tool.call({ ...PLAN, current: 2 })
  now += 3_000

  const ui = await $.ui.mount(BAND)
  const line = async (text: RegExp) =>
    (await ui.find({ type: 'Text', text }))?.text

  expect(await line(/Reproduce/)).toBe('[x] Reproduce it  1m 12s')
  expect(await line(/Patch/)).toBe('[x] Patch the handler  9s')
  expect(await line(/\[>\] Run/)).toBe('[>] Run the suite  3s')
  await ui.unmount()
})

test('steps with the same words keep their own times', async ($, on) => {
  const plan = {
    tool: TOOL,
    goal: 'Get the suite green',
    steps: ['Run tests', 'Fix failures', 'Run tests'],
  } as const
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call({ ...plan, current: 0 })
  now += 10_000
  await $.tool.call({ ...plan, current: 1 })
  now += 20_000
  await $.tool.call({ ...plan, current: 2 })
  now += 30_000
  await $.tool.call({ ...plan, current: 3 })
  now += 40_000
  await $.tool.call({ ...plan, current: 3 })

  const ui = await $.ui.mount(BAND)
  const lines = (await ui.findAll({ type: 'Text', text: /\[x\]/ })).map(
    found => found.text,
  )

  expect(lines).toEqual([
    '[x] Run tests  10s',
    '[x] Fix failures  20s',
    '[x] Run tests  30s',
  ])
  await ui.unmount()
})

test('a step that was skipped shows no time', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call({ ...PLAN, current: 0 })
  now += 5_000
  await $.tool.call({ ...PLAN, current: 2 })

  const ui = await $.ui.mount(BAND)
  const line = async (text: RegExp) =>
    (await ui.find({ type: 'Text', text }))?.text

  expect(await line(/Reproduce/)).toBe('[x] Reproduce it  5s')
  expect(await line(/Patch/)).toBe('[x] Patch the handler')
  await ui.unmount()
})

test('a new goal drops the times of the last one', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call({ ...PLAN, current: 0 })
  now += 5_000
  await $.tool.call({ ...PLAN, goal: 'Something else' })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Reproduce/ }))?.text).toBe(
    '[x] Reproduce it',
  )
  await ui.unmount()
})

test('a brief with no steps shows its time on the goal', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  await $.tool.call({ tool: TOOL, goal: 'Tidy up' })
  now += 61_000

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Working on/ }))?.text).toBe(
    'Working on: Tidy up  1m 01s',
  )
  await ui.unmount()
})

const IDLE = { ...BAND, props: { ...BAND.props, isWorking: false } } as const
const TIDY = { tool: TOOL, goal: 'Tidy up', steps: ['Only step'] } as const
const NEXT = { text: 'next thing', turnId: 'turn-2' } as const

test('finished work stays up after its turn, dimmed, its times kept', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call(TIDY)
  now += 20_000
  await $.tool.call({ ...TIDY, current: 1 })
  await $.turn.complete(TURN)
  now += 60_000

  const ui = await $.ui.mount(IDLE)
  const goal = await ui.find({ type: 'Text', text: /Tidy/ })

  expect(goal?.text).toBe('Worked on: Tidy up')
  expect(goal?.props.dimColor).toBe(true)
  expect((await ui.find({ type: 'Text', text: /Only/ }))?.text).toBe(
    '[x] Only step  20s',
  )
  expect((await ui.find({ type: 'Box' }))?.props.borderColor).toBe('inactive')
  await ui.unmount()
})

test('the next turn takes a finished brief down', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.tool.call({ ...TIDY, current: 1 })
  await $.turn.complete(TURN)
  await $.turn.start(NEXT)

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test("a subagent's turn starting leaves a finished brief up", async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.tool.call({ ...TIDY, current: 1 })
  await $.turn.complete(TURN)
  await $.turn.start({ ...NEXT, agentId: 'agent-1' })

  const ui = await $.ui.mount(IDLE)

  expect((await ui.find({ type: 'Text', text: /Tidy/ }))?.text).toBe(
    'Worked on: Tidy up',
  )
  await ui.unmount()
})

test('a turn that ends with steps left is waiting on the person', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call({ ...PLAN, steps: ['Reproduce it', 'Waiting for a go-ahead'] })
  now += 6_000
  await $.turn.complete(TURN)
  now += 60_000

  const ui = await $.ui.mount(IDLE)
  const goal = await ui.find({ type: 'Text', text: /login/ })
  const step = await ui.find({ type: 'Text', text: /\[>\]/ })

  expect(goal?.text).toBe('Waiting on you: Fix the login bug')
  expect(goal?.props.dimColor).toBe(false)
  expect(step?.text).toBe('[>] Waiting for a go-ahead  6s')
  expect(step?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Box' }))?.props.borderColor).toBe('warning')
  await ui.unmount()
})

test('the next turn resumes work that was waiting, not counting the wait', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.tool.call(TIDY)
  now += 6_000
  await $.turn.complete(TURN)
  now += 60_000
  await $.turn.start(NEXT)
  now += 2_000

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Tidy/ }))?.text).toBe(
    'Working on: Tidy up',
  )
  expect((await ui.find({ type: 'Text', text: /\[>\] Only/ }))?.text).toBe(
    '[>] Only step  8s',
  )
  await ui.unmount()
})

test('an interrupted turn says so and stops the clock', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call(TIDY)
  now += 10_000
  await $.turn.complete({ ...TURN, isAborted: true, reason: 'aborted' })
  now += 100_000

  const ui = await $.ui.mount(IDLE)

  expect((await ui.find({ type: 'Text', text: /Tidy/ }))?.text).toBe(
    'Interrupted: Tidy up',
  )
  expect((await ui.find({ type: 'Text', text: /\[>\] Only/ }))?.text).toBe(
    '[>] Only step  10s',
  )
  await ui.unmount()
})

test('the next turn resumes interrupted work, not counting the pause', async ($, on) => {
  let now = 1_000
  on('clock.now', () => ({ value: now }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.tool.call(TIDY)
  now += 10_000
  await $.turn.complete({ ...TURN, isAborted: true, reason: 'aborted' })
  now += 100_000
  await $.turn.start(NEXT)
  now += 5_000

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Tidy/ }))?.text).toBe(
    'Working on: Tidy up',
  )
  expect((await ui.find({ type: 'Text', text: /\[>\] Only/ }))?.text).toBe(
    '[>] Only step  15s',
  )
  await ui.unmount()
})

test("a subagent's answer leaves the brief up", async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call({ tool: TOOL, goal: 'Tidy up', steps: ['Only step'] })
  await $.turn.complete({ ...TURN, agentId: 'agent-1' })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Tidy/ }))?.text).toBe(
    'Working on: Tidy up',
  )
  await ui.unmount()
})

test('a current past the last step marks every step done', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  await $.tool.call({
    tool: TOOL,
    goal: 'Tidy up',
    steps: ['Only step'],
    current: 5,
  })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Only/ }))?.text).toBe(
    '[x] Only step',
  )
  await ui.unmount()
})

test('a brief without a goal is refused', async $ => {
  const ran = await $.tool.call({ tool: TOOL, goal: '  ' })

  expect(ran.deny).toBe('goal must be a non-empty string.')
})

test('with no brief the band is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})

test('the system prompt gains the instructions last', async ($, on) => {
  on('prompt.compose', () => ({
    sections: [{ id: 'intro', text: 'hi', scope: 'shared' }],
  }))

  const { sections } = await $.prompt.compose({
    model: 'claude-fable-5-2',
    promptModel: 'claude-fable-5-2',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  expect(sections.map(section => section.id)).toEqual([
    'intro',
    'work-brief:instructions',
  ])
})

test('a long run of tool calls with no brief update is nudged', async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  for (let call = 1; call < STALE_AFTER; call += 1) {
    const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(ran.context).toBe(undefined)
  }

  const stale = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(stale.context?.length).toBe(1)
  expect(stale.context?.[0]).toMatch(/15 tool calls have run/)

  const after = await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(after.context).toBe(undefined)
})

test('setting the brief restarts the count toward a nudge', async ($, on) => {
  on('clock.now', () => ({ value: 0 }))
  on('tool.call', () => ({ result: {} }))

  for (let call = 1; call < STALE_AFTER; call += 1) {
    await $.tool.call({ tool: 'Bash', command: 'ls' })
  }

  await $.tool.call(PLAN)
  const ran = await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(ran.context).toBe(undefined)
})

test("a subagent's tool calls do not count toward a nudge", async ($, on) => {
  on('tool.call', () => ({ result: {} }))

  for (let call = 1; call <= STALE_AFTER; call += 1) {
    const ran = await $.tool.call({
      tool: 'Bash',
      command: 'ls',
      agentId: 'agent-1',
    })
    expect(ran.context).toBe(undefined)
  }
})

test('a nudge keeps the context a tool already carries', async ($, on) => {
  on('tool.call', () => ({ result: {}, context: ['from the tool'] }))

  for (let call = 1; call < STALE_AFTER; call += 1) {
    await $.tool.call({ tool: 'Bash', command: 'ls' })
  }

  const stale = await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(stale.context?.[0]).toBe('from the tool')
  expect(stale.context?.length).toBe(2)
})
