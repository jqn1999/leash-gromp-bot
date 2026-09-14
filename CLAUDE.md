# Working conventions for this repo

These are standing rules for every change made in this codebase, not just this session's. See
`.claude/README.md` for the actual knowledge base (game formulas, data model, system docs).

## Sibling repo: jqn1999/financial-project

`financial-project` is a web UI implementing the SAME game as this Discord bot (its `/gromp`
page) — not a separate product. It reads/writes the same DynamoDB tables through its own Lambdas,
with business logic re-implemented server-side there rather than proxied. Any change here that
touches game logic, balance numbers, formulas, or data shapes that the web version also
implements needs the equivalent change made there too, and vice versa.

`financial-project/NOTES_GROMP_WEB_INTEGRATION.md` is the living record of this sync — a numbered
`## Bot caught up #N` entry per audit pass, stating what drifted and what was (or was deliberately
wasn't) ported. When a change in this repo is the kind that would affect what `/gromp` shows or
computes (new mechanic, changed formula, renamed/reshaped data, a rebalance), say so explicitly
and offer to audit + port it into `financial-project` in the same session — appending a new
numbered entry to that file — rather than leaving the two to drift apart silently. See that
repo's own `CLAUDE.md` for the fuller version of this same rule.

## Before calling any change complete

1. **Run the full test suite** (`npx jest`) and confirm it passes. Don't stop at the new/touched
   test file alone — run everything, since this codebase's systems interconnect (guild raids,
   Spud Keep, companions, Tower, etc. all read/write shared state).
2. **Update the docs to match.** For every shipped change:
   - Add a dated entry to `.claude/roadmap.md` describing what was asked, what was found (root
     cause, not just symptom), and what changed — in the same detailed prose style as existing
     entries, not a one-line changelog bullet.
   - Update the relevant `.claude/systems/*.md` file(s) so the system doc still matches the code.
     If a fix invalidates an existing explanation elsewhere in that doc (e.g. a comment describing
     old behavior), fix that too rather than leaving stale docs next to the new truth.
3. **Verify with `node -c`** on any file with nontrivial edits before running tests, to catch
   syntax errors early.

## Before implementing a nontrivial change

- **Flag invariant-breaking side effects to the user before implementing**, rather than silently
  picking a resolution. If a fix or feature could change behavior beyond what was explicitly
  asked (e.g. resetting stored player data, changing a payout formula's edge case), say so and
  confirm before writing code.
- **Investigate root cause before proposing a fix**, especially for bug reports. Trace the actual
  code path with the reported symptom in mind rather than guessing from the description alone —
  this repo's history has repeatedly found the real bug one layer away from the first hypothesis
  (see `.claude/roadmap.md` for examples: the Spud Keep dual-write race, the `/work`
  auto-recovery gap, the raid bank-overflow payout bug).
- For exploratory/design questions ("should X work like Y?"), give a recommendation with the
  main tradeoff — don't implement until asked to.

## Git workflow

- Develop on the session's assigned branch; push there first.
- Push to `main` directly (no PR) only once explicitly requested — this repo doesn't gate merges
  through pull requests for routine changes.
- Before pushing to `main`, fetch it and confirm there's no unexpected divergence.
- Commit messages: describe the *why*, not just the *what*; keep the required attribution
  trailer(s) from the active session's system instructions.

## Style

- No comments explaining WHAT code does — only WHY, when it's non-obvious (a hidden constraint, a
  workaround, an invariant a future reader could easily break). This repo's existing comments are
  unusually dense with rationale/history — match that density and reasoning style, not just the
  brevity default.
- Naming/flavor text for anything player-facing goes through `.claude/lore.md` first (medieval
  potato-kingdom fantasy — no modern-world language).
