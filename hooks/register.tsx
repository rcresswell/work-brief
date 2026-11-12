import { atom, read, update } from 'claude-code'
import type { Register, ThemeKey } from 'claude-code'

import type { Brief } from '../types'

const TOOL = 'mcp__work-brief__set'
const MAX_STEPS = 8
const ACCENT: ThemeKey = 'suggestion'
const DONE: ThemeKey = 'success'
// Tool calls on the main loop without a brief update before Claude is reminded.
const STALE_AFTER = 15

// Change the tag when a brief's fields change: it declines what an earlier
// version stored, which outlives a reload.
const brief = atom({ plugin: 'work-brief', key: 'brief' } as const, null, {
  shape: 'brief-3',
})

const NUDGE = `${STALE_AFTER} tool calls have run since the work brief was last set. If the work has moved on, or no brief is shown, call ${TOOL} now with the goal, the steps and the current step. If it is still accurate, carry on. Do not mention this reminder.`

const INSTRUCTIONS = `# Work brief

Before starting any work that will take more than a couple of tool calls, call ${TOOL} to state what you are about to do. The person sees it pinned above the prompt for the whole turn, while the transcript scrolls past, so write it for someone glancing up to check what is going on.

- goal: one short line saying what this work achieves.
- steps: up to ${MAX_STEPS} short lines, the plan in order. Leave out for single-step work.
- current: the index (from 0) of the step you are on; the number of steps once all are done.

Call it again whenever you move to the next step or the plan changes. The brief is taken down by itself when your turn ends with an answer. Pass the whole brief each time; it replaces the one shown. Skip it for a quick answer or a one-off lookup.`

type Plan = Omit<Brief, 'since' | 'took'>

// The brief to show once Claude sets `plan` over the brief `shown`. The clock
// keeps running through an update that stays on the same step; a step that
// work moves off keeps the time it ran, for as long as the goal stands.
function advance(shown: Brief | null, plan: Plan, now: number): Brief {
  if (shown === null || shown.goal !== plan.goal) {
    return { ...plan, since: now, took: plan.steps.map(() => null) }
  }

  const active = shown.steps[shown.current]
  const isSameStep =
    shown.current === plan.current && active === plan.steps[plan.current]
  // A time belongs to a step at its place in the list, so two steps with the
  // same words keep their own.
  const known = [...shown.took]

  if (!isSameStep && active !== undefined) {
    known[shown.current] = now - shown.since
  }

  return {
    ...plan,
    since: isSameStep ? shown.since : now,
    took: plan.steps.map((step, index) =>
      index < plan.current && step === shown.steps[index]
        ? (known[index] ?? null)
        : null,
    ),
  }
}

function parse(input: Record<string, unknown>): Plan | string {
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

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)

  return minutes === 0
    ? `${seconds}s`
    : `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

// Theme keys, so the colors follow the person's theme. Steps still to come
// keep the plain text color.
function stepColor(index: number, current: number): ThemeKey | undefined {
  if (index < current) {
    return DONE
  }

  return index === current ? ACCENT : undefined
}

export const register: Register = on => {
  // True while the band shows a brief, so the clock redraws only then.
  let isShown = false
  let callsSinceSet = 0

  on('session.start', async ($, e, next) => {
    $.clock.every(1000, () => {
      if (isShown) {
        $.ui.invalidate('ui.render')
      }
    })

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

    const now = await $.clock.now()
    await update($, brief, shown => advance(shown, parsed, now))
    callsSinceSet = 0

    return { result: 'Brief pinned above the prompt.' }
  }).catch(() => ({ deny: 'work-brief: the brief could not be stored.' }))

  // After a run of main-loop tool calls with no brief update, Claude reads a
  // reminder beside the tool's result. The person never sees it.
  on('tool.call', async ($, e, next) => {
    if (e.tool === TOOL || e.agentId !== undefined) {
      return next(e)
    }

    const ran = await next(e)
    callsSinceSet += 1

    if (callsSinceSet < STALE_AFTER || ran.deny !== undefined) {
      return ran
    }

    callsSinceSet = 0

    return { ...ran, context: [...(ran.context ?? []), NUDGE] }
  }).catch(($, e, next) => next(e))

  // A turn that ends with an answer finished its work. One that was
  // interrupted or errored keeps its brief for when the work resumes.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.reason === 'answer') {
      await update($, brief, () => null)
      callsSinceSet = 0
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, brief)
    isShown = !e.props.hasSurvey && e.props.isWorking && shown !== null

    if (e.props.hasSurvey || !e.props.isWorking || shown === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const clock = <Text dimColor>  {elapsed((await $.clock.now()) - shown.since)}</Text>

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={ACCENT}
        paddingX={1}
      >
        <Text bold>
          Working on: {shown.goal}
          {shown.steps.length === 0 && clock}
        </Text>
        {shown.steps.map((step, index) => {
          const took = shown.took[index]

          return (
            <Text
              bold={index === shown.current}
              dimColor={index < shown.current}
              color={stepColor(index, shown.current)}
            >
              {mark(index, shown.current)} {step}
              {index === shown.current && clock}
              {typeof took === 'number' && `  ${elapsed(took)}`}
            </Text>
          )
        })}
      </Box>
    )
  })
}
