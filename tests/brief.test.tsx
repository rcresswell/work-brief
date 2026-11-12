import { expect, test } from 'claude-code/testing'

const TOOL = 'mcp__work-brief__set'

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

test('a brief the model sets is drawn above the prompt', async ($, on) => {
  on('tool.register', () => ({ value: { tool: TOOL } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({
    tool: TOOL,
    goal: 'Fix the login bug',
    steps: ['Reproduce it', 'Patch the handler', 'Run the suite'],
    current: 1,
  })
  expect(ran.deny).toBe(undefined)

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Working on/ }))?.text).toBe(
    'Working on: Fix the login bug',
  )
  expect((await ui.find({ type: 'Text', text: /Reproduce/ }))?.text).toBe(
    '[x] Reproduce it',
  )
  expect((await ui.find({ type: 'Text', text: /Patch/ }))?.text).toBe(
    '[>] Patch the handler',
  )
  expect((await ui.find({ type: 'Text', text: /suite/ }))?.text).toBe(
    '[ ] Run the suite',
  )
  await ui.unmount()
})

test('the border, the current step and done steps are colored', async $ => {
  await $.tool.call({
    tool: TOOL,
    goal: 'Fix the login bug',
    steps: ['Reproduce it', 'Patch the handler', 'Run the suite'],
    current: 1,
  })

  const ui = await $.ui.mount(BAND)
  const color = async (text: RegExp) =>
    (await ui.find({ type: 'Text', text }))?.props.color

  expect((await ui.find({ type: 'Box' }))?.props.borderColor).toBe('suggestion')
  expect(await color(/Working on/)).toBe(undefined)
  expect(await color(/Reproduce/)).toBe('success')
  expect(await color(/Patch/)).toBe('suggestion')
  expect(await color(/suite/)).toBe(undefined)
  await ui.unmount()
})

const TURN = {
  answer: 'Done.',
  durationMs: 1000,
  isAborted: false,
  turnId: 'turn-1',
  reason: 'answer',
} as const

test('while no turn runs the band is left to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.tool.call({ tool: TOOL, goal: 'Tidy up', steps: ['Only step'] })

  const ui = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, isWorking: false },
  })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('a turn that ends with an answer takes the brief down', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  await $.tool.call({ tool: TOOL, goal: 'Tidy up', steps: ['Only step'] })
  await $.turn.complete(TURN)

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('an interrupted turn keeps its brief for the resumed work', async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call({ tool: TOOL, goal: 'Tidy up', steps: ['Only step'] })
  await $.turn.complete({ ...TURN, isAborted: true, reason: 'aborted' })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Only/ }))?.text).toBe(
    '[>] Only step',
  )
  await ui.unmount()
})

test("a subagent's answer leaves the brief up", async ($, on) => {
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call({ tool: TOOL, goal: 'Tidy up', steps: ['Only step'] })
  await $.turn.complete({ ...TURN, agentId: 'agent-1' })

  const ui = await $.ui.mount(BAND)

  expect((await ui.find({ type: 'Text', text: /Tidy/ }))?.text).toBe(
    'Working on: Tidy up',
  )
  await ui.unmount()
})

test('a current past the last step marks every step done', async $ => {
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
