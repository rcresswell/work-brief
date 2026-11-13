export type Brief = {
  goal: string
  steps: string[]
  // Index into steps of the one in progress; steps before it are done.
  // Equal to steps.length once every step is done.
  current: number
  // When the current step began, in milliseconds since the epoch.
  since: number
  // How long each finished step ran, in milliseconds, by its index in steps;
  // null for a step that is not finished or was never the current one.
  took: (number | null)[]
  // Set once the turn doing the work has ended: when, in milliseconds since
  // the epoch, and whether it ended with an answer and not an interrupt or
  // error. Null while the work is under way.
  ended: { at: number; isAnswered: boolean } | null
}

declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__work-brief__set': { goal: string; steps?: string[]; current?: number }
  }

  interface PluginState {
    'work-brief': { brief: Shaped<Brief | null> }
  }
}
