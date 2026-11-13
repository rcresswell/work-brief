import { atom, read, update } from 'claude-code'
import type { Register, ThemeKey } from 'claude-code'

import type { Brief } from '../types'

const TOOL = 'mcp__work-brief__set'
const MAX_STEPS = 8
const DONE: ThemeKey = 'success'
// Tool calls on the main loop without a brief update before Claude is reminded.
const STALE_AFTER = 15

// Change the tag when a brief's fields change: it declines what an earlier
// version stored, which outlives a reload.
const brief = atom({ plugin: 'work-brief', key: 'brief' } as const, null, {
  shape: 'brief-4',
})

const NUDGE = `${STALE_AFTER} tool calls have run since the work brief was last set. If the work has moved on, or no brief is shown, call ${TOOL} now with the goal, the steps and the current step. If it is still accurate, carry on. Do not mention this reminder.`

const INSTRUCTIONS = `# Work brief

Before starting any work that will take more than a couple of tool calls, call ${TOOL} to state what you are about to do. The person sees it pinned above the prompt for the whole turn, while the transcript scrolls past, so write it for someone glancing up to check what is going on.

- goal: one short line saying what this work achieves.
- steps: up to ${MAX_STEPS} short lines, the plan in order. Leave out for single-step work.
- current: the index (from 0) of the step you are on; the number of steps once all are done.

Call it again whenever you move to the next step or the plan changes. The brief stays up after your turn ends, and how you leave it matters:

- Work finished: before your final answer, set current to the number of steps. The brief then reads as done and comes down at the person's next prompt.
- Stopping to ask the person something, or for their go-ahead: make the current step say what you are waiting for, such as "Waiting for a choice between public and private", adding that step if the brief has none. The brief then reads "Waiting on you" and picks up again at their reply. Pass the whole brief each time; it replaces the one shown. Skip it for a quick answer or a one-off lookup.`

type Plan = Omit<Brief, 'since' | 'took' | 'ended'>

// The brief to show once Claude sets `plan` over the brief `shown`. The clock
// keeps running through an update that stays on the same step; a step that
// work moves off keeps the time it ran, for as long as the goal stands.
function advance(shown: Brief | null, plan: Plan, now: number): Brief {
  if (shown === null || shown.goal !== plan.goal) {
    return {
      ...plan,
      since: now,
      took: plan.steps.map(() => null),
      ended: null,
    }
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
    ended: null,
  }
}

type Phase = 'working' | 'waiting' | 'interrupted' | 'finished'

// Theme keys, so the colors follow the person's theme.
const LOOK: Record<Phase, { title: string; accent: ThemeKey; isDim: boolean }> = {
  working: { title: 'Working on', accent: 'suggestion', isDim: false },
  waiting: { title: 'Waiting on you', accent: 'warning', isDim: false },
  interrupted: { title: 'Interrupted', accent: 'inactive', isDim: true },
  finished: { title: 'Worked on', accent: 'inactive', isDim: true },
}

// A turn that ends with an answer while steps remain stopped to hear from
// the person; with none remaining, the work is finished.
function phaseOf(shown: Brief): Phase {
  if (shown.ended === null) {
    return 'working'
  }

  if (!shown.ended.isAnswered) {
    return 'interrupted'
  }

  return shown.current < shown.steps.length ? 'waiting' : 'finished'
}

// The brief once the next turn starts. Finished work is over, so its brief
// comes down. Work that was interrupted or waiting picks up again, its clock
// not counting the time it sat stopped.
function resume(shown: Brief | null, now: number): Brief | null {
  if (shown === null || shown.ended === null) {
    return shown
  }

  return phaseOf(shown) === 'finished'
    ? null
    : { ...shown, since: shown.since + now - shown.ended.at, ended: null }
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

// Steps still to come keep the plain text color.
function stepColor(
  index: number,
  current: number,
  accent: ThemeKey,
): ThemeKey | undefined {
  if (index < current) {
    return DONE
  }

  return index === current ? accent : undefined
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

  // The brief stays up when the main loop's turn ends, with its clock stopped,
  // so the person can read what was done.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const ended = { at: await $.clock.now(), isAnswered: e.reason === 'answer' }
      await update($, brief, shown =>
        shown === null || shown.ended !== null ? shown : { ...shown, ended },
      )
      callsSinceSet = 0
    }

    return next(e)
  })

  // The main loop's next turn starts on the person's next prompt, typed
  // while idle or queued behind the turn that just ended.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, brief, shown => resume(shown, now))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, brief)
    isShown = !e.props.hasSurvey && shown !== null && shown.ended === null

    if (e.props.hasSurvey || shown === null) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const { title, accent, isDim } = LOOK[phaseOf(shown)]
    const until = shown.ended?.at ?? (await $.clock.now())
    const clock = <Text dimColor>  {elapsed(until - shown.since)}</Text>

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
      >
        <Text bold={!isDim} dimColor={isDim}>
          {title}: {shown.goal}
          {shown.steps.length === 0 && clock}
        </Text>
        {shown.steps.map((step, index) => {
          const took = shown.took[index]

          return (
            <Text
              bold={!isDim && index === shown.current}
              dimColor={isDim || index < shown.current}
              color={stepColor(index, shown.current, accent)}
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
