export type Brief = {
  goal: string
  steps: string[]
  // Index into steps of the one in progress; steps before it are done.
  // Equal to steps.length once every step is done.
  current: number
}

declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__work-brief__set': { goal: string; steps?: string[]; current?: number }
  }

  interface PluginState {
    'work-brief': { brief: Shaped<Brief | null> }
  }
}
