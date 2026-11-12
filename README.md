# work-brief

A Claude Code mod. Before Claude starts work that takes more than a couple of tool calls, it states
what it is up to, and that brief stays pinned in a box above the prompt while the transcript scrolls.

```
╭──────────────────────────────────────────╮
│ Working on: Fix the login bug            │
│ [x] Reproduce it  1m 12s                 │
│ [>] Patch the handler  2m 05s            │
│ [ ] Run the suite                        │
╰──────────────────────────────────────────╯
```

## How it works

- Registers a tool, `mcp__work-brief__set`, taking a `goal`, up to 8 `steps`, and the index of the
  `current` step. Each call replaces the brief shown.
- Adds a section to the system prompt telling Claude when to call it.
- Shows how long the current step has been running. An update that stays on the same step keeps
  its clock; moving to another step restarts it. A finished step keeps the time it took.
- After 15 tool calls with no brief update, reminds Claude to refresh it. The reminder rides beside
  a tool result, where Claude reads it and the person never sees it.
- Draws the brief in the band above the prompt while a turn is running. A turn that ends with an
  answer takes the brief down. An interrupted turn hides it and brings it back, with its step
  still in progress, when work resumes.

The band is drawn on the terminal and desktop surfaces. Collapse it with ctrl+x ctrl+a.

## Installing

At the prompt of a Claude Code terminal session:

```
/plugin install work-brief --marketplace rcresswell/work-brief
```

Answer `y` to add the marketplace, then pick a scope.

To run it from a checkout instead:

```
claude --plugin-dir ~/code/work-brief
```

## Developing

```
claude plugin validate .
claude plugin test .
```

Claude Code lays its API types in `.claude-plugin/types/` when it loads the mod; `tsc -p .`
type-checks against them.

## License

MIT
