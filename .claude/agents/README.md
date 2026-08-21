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

### The intended pipeline

```
idea → product-owner (scopes it, flags open questions)
     → architect (designs it — data model, formulas, files touched)
     → [ user confirms ]
     → developer (implements, tests, updates docs)
```

Each stage is a strict read/write fence: `product-owner` and `architect` can never write to `src/`
even by accident, and `developer` won't start until a design has been explicitly confirmed by the
user — not just handed off by the other two agents. None of them "decide to build" on their own
initiative; a human says go.

Note: nothing in this session actually invoked these three as subagents — every feature this session
(NPC companion sale, market floor cuts, Poison Potato mitigation, the admin event trigger) was done
inline, with one continuous session playing all three roles itself. The roster above documents what
*exists* in `.claude/agents/`, not what got used.

## Generic agents (not project-specific)

These come from the harness itself, not this repo, so they have no `.claude/agents/*.md` file here.
Worth knowing about since they're available in the same `Agent` tool:

- **Explore** — fast, read-only code search ("where is X defined," "which files reference Y"). Use
  for lookups, not for design or review work.
- **general-purpose** — catch-all for multi-step research/execution that doesn't fit a specialized
  role.
- **Plan** — drafts a step-by-step implementation plan without executing it.

## Suggested additions, based on this project's actual history

The three-agent pipeline above covers *building new things*. Looking back at what's actually been
asked for in this repo, two recurring kinds of work don't fit cleanly into any of the three roles —
both surfaced real bugs when done ad hoc that a dedicated pass might have caught sooner:

### 1. `balance-auditor` (proposed)

A read-only agent whose job is periodically re-checking *already-shipped* numeric systems for drift
or inconsistency — distinct from `architect`, which grounds numbers only at the moment a *new*
feature is designed and has no reason to revisit old ones afterward. This project has repeatedly
needed exactly this kind of pass:

- The companion balance rework (Fieldmouse's flat cooldown-reduction beating same-tier work%
  picks once framed in real "income power" terms).
- The bank regrade tier audit that caught `bankRegradeTiers`' final tier breaking an otherwise
  exact 20,000,000x scaling factor against `workRegradeTiers` — a likely data-entry anomaly that had
  shipped and sat undetected.
- The starch capacity redesign (`starchCapacityPercent` → `starchSellBonusPercent`) once the old
  perk was shown not to gate free Taro/Golden Yam starches the way it was assumed to.
- This session's Poison Potato pain-point fix — user-reported "too punishing," not something a
  formula-level check would have caught, but the kind of finding a periodic audit could surface
  proactively instead of waiting on a complaint.

Would read `constants.js` + `.claude/systems/*.md` and report inversions, stale comments, or
numbers that no longer hold their intended relationship — output a punch list for `product-owner`/
`architect` to act on, not fix anything itself.

### 2. `release-checker` (proposed)

A read-only, fast pre-ship gate — not a design reviewer, just a mechanical constraints check before
a new/changed command goes live. Directly motivated by today's incident: `/companion-sell-npc`
shipped with a 123-character description against Discord's hard 100-character cap, which crashed
command registration at bot startup (`DiscordAPIError[50035]`). That's exactly the kind of thing a
five-second automated check catches every time, instead of relying on remembering to check it by
hand after the fact (which is what happened here — audited retroactively, not proactively).

Would check every command/option/choice against Discord's actual API limits (name/description
length, option count, choice count, etc.) and anything else mechanical worth gating on (e.g. `node
--check` across changed files) before a `developer` hand-off is considered done.

---

Want me to actually create `balance-auditor.md` and/or `release-checker.md` (same frontmatter/prompt
format as the three above), or hold this as a proposal for now?
