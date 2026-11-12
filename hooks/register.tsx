import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Brief } from '../types'

const TOOL = 'mcp__work-brief__set'
const MAX_STEPS = 8

// Change the tag when a brief's fields change: it declines what an earlier
// version stored, which outlives a reload.
const brief = atom({ plugin: 'work-brief', key: 'brief' } as const, null, {
  shape: 'brief-1',
})

const INSTRUCTIONS = `# Work brief

Before starting any work that will take more than a couple of tool calls, call ${TOOL} to state what you are about to do. The person sees it pinned above the prompt for the whole turn, while the transcript scrolls past, so write it for someone glancing up to check what is going on.

- goal: one short line saying what this work achieves.
- steps: up to ${MAX_STEPS} short lines, the plan in order. Leave out for single-step work.
- current: the index (from 0) of the step you are on; the number of steps once all are done.

Call it again whenever you move to the next step or the plan changes. The brief is taken down by itself when your turn ends with an answer. Pass the whole brief each time; it replaces the one shown. Skip it for a quick answer or a one-off lookup.`

function parse(input: Record<string, unknown>): Brief | string {
  const { goal, steps = [], current = 0 } = input

  if (typeof goal !== 'string' || goal.trim() === '') {
    return 'goal must be a non-empty string.'
  }

  if (!Array.isArray(steps) || steps.some(step => typeof step !== 'string')) {
    return 'steps must be a list of strings.'
  }

  if (steps.length > MAX_STEPS) {
    return `steps takes at most ${MAX_STEPS} lines; merge some.`
  }

  if (typeof current !== 'number' || !Number.isInteger(current)) {
    return 'current must be an integer index into steps.'
  }

  return {
    goal: goal.trim(),
    steps: steps as string[],
    current: Math.min(Math.max(current, 0), steps.length),
  }
}

function mark(index: number, current: number): string {
  if (index < current) {
    return '[x]'
  }

  return index === current ? '[>]' : '[ ]'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'set',
      description:
        'Pin a brief of the work in progress above the prompt: the goal, the steps, and which step is current. Replaces the brief shown.',
      inputSchema: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'One line: what this work achieves.' },
          steps: {
            type: 'array',
            items: { type: 'string' },
            maxItems: MAX_STEPS,
            description: 'The plan, in order, one short line each.',
          },
          current: {
            type: 'integer',
            minimum: 0,
            description:
              'Index from 0 of the step in progress; the number of steps once all are done.',
          },
        },
        required: ['goal'],
      },
      isDeferred: false,
    })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      sections: [
        ...composed.sections,
        { id: 'work-brief:instructions', text: INSTRUCTIONS, scope: 'session' },
      ],
    }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const parsed = parse(e as unknown as Record<string, unknown>)

    if (typeof parsed === 'string') {
      return { deny: parsed }
    }

    await update($, brief, () => parsed)

    return { result: 'Brief pinned above the prompt.' }
  }).catch(() => ({ deny: 'work-brief: the brief could not be stored.' }))

  // A turn that ends with an answer finished its work. One that was
  // interrupted or errored keeps its brief for when the work resumes.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      await update($, brief, () => null)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, brief)

    if (e.props.hasSurvey || !e.props.isWorking || shown === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>Working on: {shown.goal}</Text>
        {shown.steps.map((step, index) => (
          <Text
            bold={index === shown.current}
            dimColor={index < shown.current}
          >
            {mark(index, shown.current)} {step}
          </Text>
        ))}
      </Box>
    )
  })
}
