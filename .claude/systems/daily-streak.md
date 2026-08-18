# Daily Login Streak

[src/utils/dailyStreakFactory.js](../../src/utils/dailyStreakFactory.js) +
`DailyStreak` constants in [constants.js](../../src/utils/constants.js), auto-triggered from
[src/events/interactionCreate/handleCommands.js](../../src/events/interactionCreate/handleCommands.js) —
**no dedicated command**. Rewards a player for showing up on consecutive calendar days, separate
from the `/work` cooldown.

## Trigger point

There is no `/daily` command. `handleCommands.js` — the single chokepoint every slash command
already passes through — kicks off the streak check right before invoking the matched command's
own `callback`, once all the existing gates (devOnly, testOnly, permissions, channel whitelist)
have passed. This means it's checked at most once per interaction, only for interactions that were
actually going to run a real command — a rejected/blocked attempt doesn't count as "showing up."

The check runs concurrently with the command's own execution (`processDailyStreak(interaction)` is
started but not awaited until after `commandObject.callback(...)` resolves), so it adds no latency
to the command itself. Any failure inside the streak check or its follow-up notification is caught
and logged, never allowed to propagate — a bug in this side feature must never block the actual
command a player invoked.

## Day boundary & streak continuation

`DailyStreakFactory.processLogin(userDetails)`:

```
today = current date in EST (Intl handles the DST transition automatically)
if userDetails.lastLoginDate == today: already claimed, return null

yesterday = (now - 24h) formatted in EST
isConsecutive = userDetails.lastLoginDate == yesterday
newStreak = isConsecutive ? loginStreak + 1 : 1   // any gap of 2+ days resets to 1
```

EST is used to match the rest of the game's day-based resets (the Tower's midnight-EST /
4am-UTC reset). A brand-new account (`lastLoginDate: null` from `addUser`) or a pre-existing
account that predates this feature (missing the field entirely) both naturally fall into the
"not consecutive" branch and start a fresh streak at 1 on their next interaction — same
lazy-backfill philosophy as achievements, no migration script needed.

## Reward formula

```
scalingDay = min(streak, DailyStreak.MAX_SCALING_DAYS)               // 14
dayFactor = 1 + (MAX_DAY_MULTIPLIER - 1) * (scalingDay - 1) / (MAX_SCALING_DAYS - 1)   // 1.0 -> 28.5
reward = floor(DailyStreak.BASE_REWARD_PER_MULTIPLIER * userDetails.workMultiplierAmount * dayFactor)
```

Reward scales with the player's **own** `workMultiplierAmount`, not a flat number — same
philosophy as `/work`'s server-wealth-scaled base gain, so the reward stays proportionally
meaningful whether it's someone's first week or their hundredth. Day-based escalation ramps
linearly from 1x (day 1) to `MAX_DAY_MULTIPLIER` (28.5x) by day `MAX_SCALING_DAYS` (14), then stays
flat — a broken streak costs you the ramp-up, not a hard reset to zero reward.

The constants were tuned to hit a specific target: **day 14 ≈ 1.5x average Large Potato gain**,
with day 1 held at its original modest value (deliberately chosen over two other curve shapes that
would've hit the same day-14 target by inflating day 1 instead — see the roadmap entry for the
rejected alternatives). In work-call-equivalent terms (reward ÷ average regular `/work` gain, both
scale linearly with `workMultiplierAmount` so the ratio is multiplier-independent): day 1 ≈ 0.53
work-calls, day 7 ≈ 7.21, day 14 ≈ 15.00 (≈ 1.5 average Large Potato hits). Large Potato's gain is
always capped at exactly `Work.MAX_LARGE_POTATO` (10,000) regardless of server wealth — the
`workGainAmount*10` term that feeds it is always ≥ 10,000 once floored at ≥1,000 — so this
comparison holds regardless of how developed the server's economy is.

## Race safety

Two near-simultaneous interactions on the same day would otherwise both read "not claimed yet" and
both grant the reward. `dynamoHandler.claimDailyStreak` closes this with a DynamoDB
`ConditionExpression` (`attribute_not_exists(lastLoginDate) OR lastLoginDate <> :today`) on the
write itself — whichever request's write lands first wins; the loser's write fails with
`ConditionalCheckFailedException`, which `processLogin` treats as "already claimed" (returns
`null`) rather than an error.

## Notification & achievement hook

If a reward was granted, `handleCommands.js` sends a follow-up (`embedFactory.createDailyStreakEmbed`)
**after** the original command's own reply — guarded on `interaction.replied || interaction.deferred`
so it can't throw if the command somehow never replied. It then re-fetches the user and runs
`AchievementFactory.checkAndUnlock` a second time (the first check, if any, already happened inside
`/work` itself) — this is what catches the two streak-specific achievements (`weekly_regular` at 7
days, `monthly_regular` at 30 days) promptly rather than waiting for the player's next `/work` call.
Checking twice is harmless: `checkAndUnlock` is idempotent, already-unlocked achievements are
filtered out immediately.

If the command's own callback throws an error after the streak was already claimed, the reward is
still safely persisted (the write isn't gated on the command's success) but the notification never
fires for that instance. `/profile` shows the current `loginStreak` count as a fallback so this
never becomes invisible.

## Where to look if you want a `/daily` command later

None of this logic is tied to auto-triggering — `DailyStreakFactory.processLogin(userDetails)` is a
plain function that takes a user record and returns `{ streak, reward } | null`. A dedicated command
would just call the same function directly instead of going through `handleCommands.js`.
