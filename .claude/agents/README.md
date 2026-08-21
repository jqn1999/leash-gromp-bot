# Leash Gromp Bot — Subagents

This folder defines the specialized subagents available when working on this repo (invoked via
Claude Code's `Agent` tool, or by name if your harness exposes `/agents`). Each is a `.md` file with
YAML frontmatter (`name`, `description`, `tools`, `model`) followed by its system prompt. The
`description` is what a calling agent matches against to decide *when* to reach for it — the tool
restrictions are what keep it in its lane once invoked (e.g. `product-owner` and `architect` can't
touch `src/`, only `developer` can).

## Current roster

| Agent | Role | Tools | Reads | Writes |
|---|---|---|---|---|
| [product-owner](product-owner.md) | Decides *what's* worth building and why — player-value, scope, open questions | `Read, Grep, Glob, Edit, WebSearch` | Whole `.claude/` knowledge base in full (deliberately not scoped to one feature) | `roadmap.md` only |
| [architect](architect.md) | Turns an agreed concept into a concrete technical design — data model, files touched, formulas | `Read, Grep, Glob, Edit` | Docs relevant to the feature at hand, spot-checked against `constants.js`/`dynamoHandler.js` | `.claude/` docs only, never `src/` |
| [developer](developer.md) | Implements a design the user has explicitly confirmed | `Read, Edit, Write, Grep, Glob, Bash` | Design + whichever `.claude/systems/*.md` and source files it extends | `src/`, then `.claude/` docs + `roadmap.md` to match |
| [release-reviewer](release-reviewer.md) | The merge gate — verifies the actual diff matches the original ask (nothing missing, nothing scope-creeped) and that tests/checks/docs actually got done | `Read, Grep, Glob, Bash` | The original ask (roadmap entry/design/plain request) + the diff being reviewed; runs the test suite itself rather than trusting a claim | Nothing — read-only, reports a verdict, never edits code |
| [balance-auditor](balance-auditor.md) | Standing health-check over already-shipped numbers — shop/regrades/rebirth/companions/guilds/raids/world raids, across early/mid/late game specifically | `Read, Grep, Glob, Bash, Edit` | `constants.js` + every relevant factory file, spot-checked with `Bash`/`node -e` rather than trusted from docs | `.claude/balance-audit.md` only — a running dated log of findings |

### The intended pipeline

```
idea → product-owner (scopes it, flags open questions)
     → architect (designs it — data model, formulas, files touched)
     → [ user confirms ]
     → developer (implements, tests, updates docs)
     → release-reviewer (verifies the diff matches the ask + checks actually ran)
     → [ only release-reviewer's approval authorizes merging to main ]
```

Each stage is a strict read/write fence: `product-owner` and `architect` can never write to `src/`
even by accident, `developer` won't start until a design has been explicitly confirmed by the user —
not just handed off by the other two agents — and `release-reviewer` can't touch code at all, only
verify it. None of them "decide to build" on their own initiative; a human says go. The separation
between `developer` (built it) and `release-reviewer` (verified it) is deliberate — the agent that
wrote a change is the worst-positioned to catch its own scope creep or a check it forgot to run.

`balance-auditor` sits outside that pipeline — it isn't triggered by a diff or an ask at all, it's a
standing pass invoked on its own to re-check things that already shipped. This project has
repeatedly needed exactly this kind of check: the companion balance rework (Fieldmouse's flat
cooldown-reduction beating same-tier work% picks once framed in real "income power" terms), the
bank regrade tier audit that caught `bankRegradeTiers`' final tier breaking an otherwise exact
20,000,000x scaling factor against `workRegradeTiers`, and the starch capacity redesign
(`starchCapacityPercent` → `starchSellBonusPercent`) once the old perk was shown not to gate free
Taro/Golden Yam starches the way it was assumed to — all found by manually doing exactly the kind of
audit this agent now owns.

Note: nothing in this session actually invoked these agents as subagents — every feature this
session (NPC companion sale, market floor cuts, Poison Potato mitigation, the admin event trigger)
was done inline, with one continuous session playing every role itself, including the merge decision
`release-reviewer` is meant to own and the audits `balance-auditor` is meant to own. The roster above
documents what *exists* in `.claude/agents/`, not what got used.

## Generic agents (not project-specific)

These come from the harness itself, not this repo, so they have no `.claude/agents/*.md` file here.
Worth knowing about since they're available in the same `Agent` tool:

- **Explore** — fast, read-only code search ("where is X defined," "which files reference Y"). Use
  for lookups, not for design or review work.
- **general-purpose** — catch-all for multi-step research/execution that doesn't fit a specialized
  role.
- **Plan** — drafts a step-by-step implementation plan without executing it.
