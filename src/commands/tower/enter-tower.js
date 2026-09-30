const dynamoHandler = require("../../utils/dynamoHandler");
var {towerFactory} = require("../../utils/towerFactory");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands");
const { EmbedBuilder } = require("discord.js")
const tC = require("../../utils/towerConstants.js");
const raidFactory = require("../../utils/raidFactory");
const companionFactory = require("../../utils/companionFactory");
const bigEventsChannel = require("../../utils/bigEventsChannel");
const { awsConfigurations } = require("../../utils/constants.js");

// Tower Pet (2026-09-13) — leveling grant + Bastion drop rolls both happen against the SAME
// freshly re-fetched userDetails processRewardPayouts already reads (not the stale
// pre-run snapshot), same "always credit against the latest state" precedent every other
// field in this function already follows. Returns the last-awarded companion info (if any)
// so the callback can show a separate drop-announcement followUp, mirroring takeBounty.js's
// own achievement/quest followUp precedent — companions is only written back once, at the
// end, so a run with neither a level-up nor a drop makes no extra write at all.
// Last-resort notification (2026-09-30, live report: "still getting random sporadic drops
// from tower with no messaging" — even after the 2026-09-29 crash-hardening pass added
// recovery messages for both failure points below). Root cause: Discord invalidates an
// interaction's own webhook token roughly 15 minutes after the interaction was created —
// a real limit that has nothing to do with this bot's own code, and Tower runs have no
// internal time budget at all (each floor's own `awaitMessageComponent` alone waits up to
// 30s, and a long, slow climb through many floors can realistically add up past 15 minutes).
// Once the token is dead, EVERY `interaction.editReply`/`followUp`/`reply` call fails — including
// the recovery message itself — so both catch blocks below used to just console.error and stop,
// leaving the player with nothing at all. `interaction.channel.send(...)` is a plain bot
// message, not tied to the interaction's own webhook token in any way, so it still works even
// once the token is fully dead — this is the one channel that survives that failure mode.
// Used ONLY as a last resort, after the interaction-based attempt has already failed, so a
// healthy interaction never gets a redundant second message.
async function sendFallbackChannelMessage(interaction, userId, content) {
    try {
        await interaction.channel.send({ content: `<@${userId}> ${content}` });
    } catch (channelError) {
        console.error(`Failed to send Tower fallback channel message to ${userId}:`, channelError);
    }
}

async function processTowerCompanionRewards(userId, userDetails, floor, elitesSurvivedCount, towerCompanionHits, wardUsed) {
    let companions = userDetails.companions;
    let bastionAward = null;

    const grant = companionFactory.getTowerWorkCountGrant(floor, elitesSurvivedCount);
    const leveled = companionFactory.levelActiveCompanion(companions, grant, null, "towerRewardBonus");
    if (leveled !== companions) {
        companions = leveled;
    }

    for (let i = 0; i < towerCompanionHits; i++) {
        bastionAward = companionFactory.resolveTowerCompanionAward({ ...userDetails, companions });
        companions = bastionAward.companions;
    }

    if (companions !== userDetails.companions) {
        await dynamoHandler.updateUserDatabase(userId, "companions", companions);
    }
    if (wardUsed) {
        await dynamoHandler.updateUserDatabase(userId, "towerWardUsedToday", true);
    }
    return bastionAward;
}

// A loud, impossible-to-mistake-for-success visual (2026-09-26, direct instruction: "have
// tower fail more obviously if any writes fail to go through") — the run's own results
// embed above already told the player they won stuff, in the same yellow/celebratory style
// every successful run gets, so a quiet text-only followUp right after it was easy to skim
// past as more of the same good news rather than the opposite. Red + a warning title + the
// numbers broken into real fields (not just buried in a JSON block) makes the failure state
// visually distinct from every other embed this command sends.
function createRewardFailureEmbed(failureReport) {
    return new EmbedBuilder()
        .setTitle('⚠️ Tower Reward NOT Saved')
        .setDescription("A database error stopped this run's reward from being credited to your account. Nothing below was actually saved — send the JSON block in the message above to an admin so they can manually credit you.")
        .setColor('Red')
        .setTimestamp(Date.now())
        .addFields(
            { name: 'Floor Reached', value: `${failureReport.floor}`, inline: true },
            { name: 'Outcome', value: failureReport.died ? 'Died' : 'Survived', inline: true },
            { name: '​', value: '​', inline: true },
            { name: 'Potatoes', value: `${failureReport.rewards.potatoes.toLocaleString()}`, inline: true },
            { name: 'Work Multiplier', value: `${failureReport.rewards.workMultiplier.toFixed(2)}`, inline: true },
            { name: 'Passive Income', value: `${failureReport.rewards.passiveIncome.toLocaleString()}`, inline: true },
            { name: 'Bank Capacity', value: `${failureReport.rewards.bankCapacity.toLocaleString()}`, inline: true },
        );
}

// Shared by both reward-crediting failure paths below (the initial userDetails read
// coming back empty, and the batched stat/potato updateUserFields write itself failing) —
// same recovery UX either way, since in both cases the run's reward wasn't actually saved
// and there's no reliable server-side record for an admin to look up on their own. Hands
// the player a copy-pasteable JSON block with the exact numbers so nothing has to be
// reconstructed from memory, plus the loud embed above so the failure itself can't be
// missed the way a plain-text-only followUp could.
async function sendRewardFailureNotice(interaction, userDisplayName, userId, username, floor, died, rewards) {
    const failureReport = {
        userId,
        username,
        floor,
        died,
        rewards: {
            potatoes: rewards[tC.PAYOUT.POTATOES] || 0,
            workMultiplier: rewards[tC.PAYOUT.WORK_MULTIPLIER] || 0,
            passiveIncome: rewards[tC.PAYOUT.PASSIVE_INCOME] || 0,
            bankCapacity: rewards[tC.PAYOUT.BANK_CAPACITY] || 0
        },
        timestamp: new Date().toISOString()
    };
    await interaction.followUp({
        content: `${userDisplayName}, your tower run's rewards could not be saved due to a database error. Send this to an admin so they can manually credit you:\n\`\`\`json\n${JSON.stringify(failureReport, null, 2)}\n\`\`\``,
        embeds: [createRewardFailureEmbed(failureReport)],
        ephemeral: true
    });
}

async function processRewardPayouts(interaction, userId, rewards, username, userDisplayName, floor, died, elitesSurvivedCount, towerCompanionHits, wardUsed) {
    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        // The run's results embed has already been sent by this point (see the
        // followUp below in the callback) — this is a genuine DB error on crediting
        // the reward, not a "no reward earned" case, so the player needs to know their
        // run's reward didn't actually get saved rather than assuming it silently did.
        await sendRewardFailureNotice(interaction, userDisplayName, userId, username, floor, died, rewards);
        return;
    }
    // Batched into ONE updateUserFields call (2026-09-23, root-caused from a player's
    // base stats — raw minus sweetPotatoBuffs minus regradeAmount — silently drifting off
    // a valid shop tier, breaking /buy's and /regrade's exact-match tier lookups). This
    // used to be four SEPARATE, sequential, unconditional single-field updateUserDatabase
    // calls (workMultiplierAmount, passiveAmount, bankCapacity, then sweetPotatoBuffs) plus
    // two addUserDatabase calls for potatoes/totalEarnings — updateUserDatabase swallows
    // any DynamoDB error via a bare .catch (just console.debug, never thrown, never
    // checked by this caller), so if any ONE of those six calls failed transiently after
    // an earlier one had already landed, the raw stat total and sweetPotatoBuffs
    // permanently desynced — exactly the invariant every other reward handler in this
    // codebase protects by batching SET+ADD into a single UpdateItem call (see
    // handleMetalPotato/handleSweetPotato in workFactory.js, raidFactory.handleStatSplit,
    // questFactory's weekly reward write). One atomic call removes the partial-failure
    // window entirely — either the whole run's reward lands together, or none of it does.
    let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
    const setFields = {};
    const addFields = {};

    if (rewards[tC.PAYOUT.POTATOES]) {
        addFields.potatoes = rewards[tC.PAYOUT.POTATOES];
        addFields.totalEarnings = rewards[tC.PAYOUT.POTATOES];
    }
    if (rewards[tC.PAYOUT.WORK_MULTIPLIER]) {
        setFields.workMultiplierAmount = userDetails.workMultiplierAmount + rewards[tC.PAYOUT.WORK_MULTIPLIER];
        sweetPotatoBuffs.workMultiplierAmount += rewards[tC.PAYOUT.WORK_MULTIPLIER];
    }
    if (rewards[tC.PAYOUT.PASSIVE_INCOME]) {
        setFields.passiveAmount = userDetails.passiveAmount + rewards[tC.PAYOUT.PASSIVE_INCOME];
        sweetPotatoBuffs.passiveAmount += rewards[tC.PAYOUT.PASSIVE_INCOME];
    }
    if (rewards[tC.PAYOUT.BANK_CAPACITY]) {
        setFields.bankCapacity = userDetails.bankCapacity + rewards[tC.PAYOUT.BANK_CAPACITY];
        sweetPotatoBuffs.bankCapacity += rewards[tC.PAYOUT.BANK_CAPACITY];
    }
    if (rewards[tC.PAYOUT.WORK_MULTIPLIER] || rewards[tC.PAYOUT.PASSIVE_INCOME] || rewards[tC.PAYOUT.BANK_CAPACITY]) {
        setFields.sweetPotatoBuffs = sweetPotatoBuffs;
    }

    if (Object.keys(setFields).length > 0 || Object.keys(addFields).length > 0) {
        // dynamoHandler.updateUserFields swallows any DynamoDB error internally (a bare
        // .catch that only console.debugs it) and resolves to undefined on failure — this
        // is the ONE check that actually surfaces that failure to the player, so a run's
        // reward silently failing to save doesn't look identical to it succeeding. Skips
        // processTowerCompanionRewards below on failure too, same as the userDetails-missing
        // branch above — no point rolling companion leveling/drops against a stat credit
        // that didn't land.
        const writeResult = await dynamoHandler.updateUserFields(userId, setFields, addFields);
        if (!writeResult) {
            await sendRewardFailureNotice(interaction, userDisplayName, userId, username, floor, died, rewards);
            return;
        }
    }

    return processTowerCompanionRewards(userId, userDetails, floor, elitesSurvivedCount, towerCompanionHits, wardUsed);
}

// Full command kill switch (2026-09-29, direct instruction — live player crash reports tied
// to this command, root cause not yet pinned down with a real stack trace; see tower.md's
// own dated section for the investigation). Checked first, before any DB read or state
// change, so a disabled run has zero chance of hitting whatever is actually crashing —
// unlike marking this command `deleted: true` (which would deregister it from Discord
// entirely and re-registering later risks the same command-count-cap fragility
// 01registerCommands.js's own comments already document), this keeps the command visibly
// registered and just declines every invocation with an honest, temporary-sounding message.
// `/leaderboard tower-leaderboard` and `/tower-settings` are both untouched — neither goes
// through this file at all.
//
// Admin bypass (2026-09-29, same-day follow-up, direct instruction: "Allow admins to enter
// tower") — reuses `awsConfigurations.devs`, the exact same dev/admin id list
// `handleCommands.js`'s own `devOnly` gate checks elsewhere in this codebase, rather than
// inventing a separate admin list. Lets the team keep testing/reproducing the crash live
// while the command stays closed to everyone else.
//
// Live-toggled, not hardcoded (2026-09-30, direct instruction: "make an admin toggle for me
// to allow enter tower or not") — was a bare `const TOWER_DISABLED = true` needing a code
// edit + redeploy to ever flip; now read live from the `tower_access` stats doc, toggled via
// `/admin tower-access enabled:<bool>` (admin.js), same DB-backed no-deploy pattern
// `bot_maintenance_mode` already established. `enabled` here means "entry is ALLOWED" (the
// opposite polarity from maintenance-mode's "enabled = blocked") — a missing doc (nobody has
// touched this yet) resolves to blocked, preserving the exact default the old hardcoded
// `true` already had.
module.exports = {
    name: "enter-tower",
    description: "Enter the tater tower once a day",
    callback: async (client, interaction) => {
        await interaction.deferReply();

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const towerAccess = await dynamoHandler.getStatDatabase('tower_access');
        if (towerAccess?.enabled !== true && !awsConfigurations.devs.includes(userId)) {
            await interaction.editReply("🚧 The Tater Tower is temporarily disabled while we investigate a stability issue — sorry for the interruption! Check back soon.");
            return;
        }

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;
        // Full effective power (raw stat + live rebirth/companion workMultiplierPercent
        // bonuses), same formula raidFactory.js already uses for a solo raider's own
        // contribution — see tower.md's "Entry Gate Uses Effective Power" section for why
        // guild/world buffs are deliberately excluded here.
        let userMultiplier = raidFactory.getMemberRaidPower(userDetails);

        if (userMultiplier < tC.ENTRY_GATE_MULTI) {
            interaction.editReply(`${userDisplayName} you are barred entry due to being too weak, reach ${tC.ENTRY_GATE_MULTI}x multiplier before you can enter!`)
            return;
        }

        const canEnterTower = userDetails.canEnterTower;
        if (!canEnterTower) {
            interaction.editReply(`${userDisplayName} you have already entered the tower today!`);
            return;
        }

        await dynamoHandler.updateUserDatabase(userId, "canEnterTower", false);
        // Bastion, the Tower Warden (2026-09-13) — both resolved from the player's CURRENT
        // equipped companion before the run starts (towerFactory itself has no companion/DB
        // knowledge of its own — see its constructor's own comment). towerWardUsedToday is
        // read from this same pre-run userDetails snapshot deliberately (a run started before
        // the daily reset stays ward-eligible for its own duration even if the reset fires
        // mid-run — the same "snapshot taken once, used for the whole run" precedent this.multi
        // already sets).
        const rewardBonus = companionFactory.getActivePerkValue(userDetails, 'towerRewardBonus');
        const hasWard = companionFactory.hasTowerDeathWard(userDetails) && !userDetails.towerWardUsedToday;

        // True resume (2026-09-30, direct instruction: "I want a crashed run to do exactly
        // that. Crash, and the user can continue after a crashed run from their existing DB
        // record for the day if it hasnt resulted in a leave from tower, death from elite, or
        // death by elite but save by bastion") — supersedes the SAME-DAY earlier "implement #1"
        // pass, which credited whatever was banked and made the player start a brand new floor-1
        // run. `towerRunCheckpoint` (a field on the user's own record) is the resume point: if
        // one exists, THIS invocation continues that exact run (see towerFactory's own
        // resumeFrom constructor param) instead of starting fresh. It's null/absent for a
        // genuinely new day's first attempt, or after any run that actually concluded (cleared
        // below on a normal finish; also bulk-cleared server-wide by the same 8pm ET cron that
        // resets canEnterTower — see dynamoHandler.resetAllTowerEntries's own comment — so a
        // never-resumed crash from a PRIOR day can never be mistaken for today's progress).
        const resumeFrom = userDetails.towerRunCheckpoint || null;

        // Seeded with resumeFrom (not null) — if THIS attempt crashes again before completing
        // even one more floor, latestCheckpoint must still reflect the run's true last-known
        // state (from before this attempt), not "nothing exists," so the recovery message and
        // the next resume both still work correctly off the right floor.
        let latestCheckpoint = resumeFrom;
        const checkpointTowerRun = async (snapshot) => {
            latestCheckpoint = snapshot;
            await dynamoHandler.updateUserDatabase(userId, "towerRunCheckpoint", snapshot);
        };

        let tF = new towerFactory(interaction, username, userMultiplier, userDetails.autoTowerContinue, rewardBonus, hasWard, checkpointTowerRun, resumeFrom)
        let tower_out;
        try {
            tower_out = await tF.startRun()
        } catch (e) {
            // Auto-recovery (2026-09-11) — startRun() keeps the whole climb in memory and
            // only ever restores canEnterTower via a full, successful completion (see
            // tower.md's "/admin-reset-tower" section), so ANY uncaught exception mid-run
            // used to strand the player until the next day's 8pm ET reset with no way to
            // recover on their own. Restoring the flag here means a crash costs the player
            // this run's progress, not their whole day. Logging e (not just its message —
            // see the matching fix in handleCommands.js) finally captures a real stack trace
            // to root-cause the crash itself, which static reading alone couldn't pin down.
            //
            // A deliberate TowerTimeoutError (2026-09-30 — a player not responding to the
            // Continue/Leave or Elite Fight/Leave screen within 30s, see towerFactory.js's own
            // comment on that class) is NOT a bug — it's an expected, everyday occurrence, so
            // it's logged at a lower level and given its own honest message below instead of
            // "hit an unexpected error." The RECOVERY MECHANICS are identical either way —
            // that's the whole point of routing both through this one catch block. Checked by
            // `e?.name` (not `instanceof TowerTimeoutError`) deliberately — a bare name check
            // needs no import of the real class here (towerFactory.js's exports are mocked out
            // entirely in this file's own test suite, which would otherwise make instanceof
            // fragile against a jest-automocked class identity).
            const isTimeout = e?.name === 'TowerTimeoutError';
            if (isTimeout) {
                console.log(`Tower run stopped for ${username} (${userId}) at floor ${tF.floor} — no response in time:`, e.message);
            } else {
                console.error(`Tower run crashed for ${username} (${userId}) at floor ${tF.floor}:`, e);
            }
            await dynamoHandler.updateUserDatabase(userId, "canEnterTower", true);

            // Deliberately NOT crediting anything and NOT clearing towerRunCheckpoint here
            // (both were this same day's earlier "implement #1" behavior) — the run hasn't
            // CONCLUDED (no voluntary leave, no Elite death, no Elite death saved by Bastion's
            // ward), so nothing should be credited toward potatoes/stats/highestTowerFloor/the
            // daily leaderboard yet. `latestCheckpoint` (kept up to date through this attempt's
            // own checkpoint calls, same as before) stays in the DB exactly as-is, ready for the
            // next `/enter-tower` call to resume from — that's the entire recovery path now,
            // nothing else needs to happen in this catch block beyond restoring canEnterTower so
            // the player is actually allowed to call it again.
            let recoveryMessage;
            if (isTimeout) {
                recoveryMessage = latestCheckpoint
                    ? `${userDisplayName}, you didn't respond in time, so your tower run stopped around floor ${tF.floor} — no worries, nothing was lost! Your progress through floor ${latestCheckpoint.floor} is safely saved. Run /enter-tower again to pick up right where you left off.`
                    : `${userDisplayName}, you didn't respond in time, so your tower run stopped around floor ${tF.floor} — nothing from that attempt was saved yet, but your entry has been restored, so you can run /enter-tower again right away.`;
            } else {
                recoveryMessage = latestCheckpoint
                    ? `${userDisplayName}, your tower run hit an unexpected error around floor ${tF.floor} and had to stop — sorry about that! Good news: your progress through floor ${latestCheckpoint.floor} is safely saved, nothing was lost. Run /enter-tower again to pick up right where you left off.`
                    : `${userDisplayName}, your tower run hit an unexpected error around floor ${tF.floor} and had to stop — sorry about that! Nothing from that attempt was saved yet, but your entry has been restored, so you can run /enter-tower again right away.`;
            }
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: recoveryMessage, embeds: [], components: [] });
                } else {
                    await interaction.reply({ content: recoveryMessage });
                }
            } catch (replyError) {
                // Last-resort fallback (2026-09-30) — see sendFallbackChannelMessage's own
                // comment. Most commonly a dead interaction webhook token (~15 min limit) on
                // a long, slow climb — the interaction-based reply above fails, so this is
                // the only remaining way the player finds out anything happened at all.
                console.error(`Failed to notify ${username} of their tower run crash:`, replyError);
                await sendFallbackChannelMessage(interaction, userId, recoveryMessage);
            }
            return;
        }
        // The run finished for real (survived, died to an Elite, or died but saved by Bastion's
        // ward — died stays false in that last case, see towerFactory.js's own comment) — this
        // is the ONE place a run's progress is actually credited now, whether it took one
        // attempt or several resumes to get here. Whatever the checkpoint held is fully
        // superseded by tower_out's own complete, cumulative final state, so clear it now
        // rather than let a concluded run's stale checkpoint sit around.
        await dynamoHandler.updateUserDatabase(userId, "towerRunCheckpoint", null);
        let rewards = tower_out[0];
        let floor = tower_out[1];
        let died = tower_out[2];
        // Defaulted (|| 0 / || false) so an older or test-mocked startRun() return that only
        // has the original 3 elements can't turn into a NaN/undefined leveling grant or a
        // crash on the drop-award loop below.
        let elitesSurvivedCount = tower_out[3] || 0;
        let towerCompanionHits = tower_out[4] || 0;
        let wardUsed = tower_out[5] || false;

        // embed for final results
        let embed = createResult(rewards, floor, username)
        try {
            await interaction.followUp({
                embeds: [embed]
            })
        } catch (resultsEmbedError) {
            // Crash-hardening (2026-09-29 — see tower.md): a transient Discord API failure
            // showing this confirmation must not stop the reward from being credited below —
            // the climb itself already finished successfully by this point (startRun()
            // returned), so the player earned this regardless of whether we can immediately
            // confirm it to them. Logged, not re-thrown; the rest of the tail still runs.
            console.error(`Failed to send Tower results embed to ${username} (${userId}) at floor ${floor}:`, resultsEmbedError);
            // Last-resort fallback (2026-09-30) — most commonly a dead interaction webhook
            // token on a long, slow climb (see sendFallbackChannelMessage's own comment) —
            // the player still deserves to know their run finished and what it earned, even
            // as a plain text summary rather than the real embed.
            await sendFallbackChannelMessage(interaction, userId,
                `your tower run finished at floor ${floor}! Rewards: ${rewards[tC.PAYOUT.POTATOES].toLocaleString()} potatoes, ${rewards[tC.PAYOUT.WORK_MULTIPLIER].toFixed(2)} work multiplier, ${rewards[tC.PAYOUT.PASSIVE_INCOME].toLocaleString()} passive income, ${rewards[tC.PAYOUT.BANK_CAPACITY].toLocaleString()} bank capacity. (Sent as plain text — Discord wouldn't let me show the usual results screen.)`);
        }

        // Everything from here down is post-run BOOKKEEPING on top of a climb that already
        // finished for real — crediting the reward, personal-best tracking, and the daily
        // leaderboard entry. Unlike the startRun() try/catch above, a failure here must NOT
        // restore canEnterTower: the run legitimately happened and (by the time
        // processRewardPayouts returns) the player's stats/potatoes were very likely already
        // credited, so re-opening today's entry would risk a second free run/payout on top of
        // one that already landed. Wrapped as one unit (2026-09-29, crash-hardening pass — see
        // tower.md) since these steps are a single sequential conclusion to one run, not
        // independent daily-cron-style steps — any exception here is logged and the player is
        // told their climb finished and to flag it if something looks off, rather than the
        // whole interaction dying uncaught with no explanation at all.
        try {
            const bastionAward = await processRewardPayouts(interaction, userId, rewards, username, userDisplayName, floor, died, elitesSurvivedCount, towerCompanionHits, wardUsed);
            if (bastionAward) {
                // Mirrors takeBounty.js's own achievement/quest followUp precedent — a separate
                // embed after the main result, not folded into it.
                await interaction.followUp({
                    embeds: [createBastionDropEmbed(bastionAward, userDisplayName)]
                });
                if (bigEventsChannel.isBigEventCompanion(bastionAward.companion)) {
                    await bigEventsChannel.postBigEvent({
                        title: '🎉 Rare Companion!',
                        description: `**${userDisplayName}** earned a rare companion in the Tower!`,
                        fields: [
                            bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle),
                            bigEventsChannel.companionField(bastionAward.companion),
                            bigEventsChannel.sourceField('Tower Reward'),
                        ],
                        color: bigEventsChannel.RARE_COMPANION_COLOR,
                    });
                }
            }

            // "Highest floor ever reached" is a broader personal-best than the daily
            // leaderboard's survival-only eligibility below — floor already reflects the
            // last floor actually reached either way (towerFactory decrements it back by
            // one on a lost Elite fight, since dying happens on the way to the next
            // floor), so a died run still legitimately counts toward this record.
            await dynamoHandler.updateIfNewRecord(userId, 'highestTowerFloor', floor);

            // Only a survived run (voluntarily left, not lost to an Elite) counts for the
            // daily leaderboard — see towerLeaderboardFactory.js for how it's ranked/paid out.
            if (!died) {
                await dynamoHandler.recordTowerLeaderboardEntry({
                    userId,
                    username,
                    floor,
                    // Ranking tiebreaker chain (2026-09-23, direct instruction): floor, then
                    // elitesKilled, then potatoes — see towerLeaderboardFactory.js's
                    // sortTowerLeaderboardEntries for where that's actually applied.
                    elitesKilled: elitesSurvivedCount,
                    potatoes: rewards[tC.PAYOUT.POTATOES] || 0,
                    workMultiplier: rewards[tC.PAYOUT.WORK_MULTIPLIER] || 0,
                    passiveIncome: rewards[tC.PAYOUT.PASSIVE_INCOME] || 0,
                    bankCapacity: rewards[tC.PAYOUT.BANK_CAPACITY] || 0,
                    // The run's TEMPORARY (this-run-only) work modifier (2026-09-30, direct
                    // instruction) — distinct from workMultiplier above (the PERMANENT reward
                    // banked to the player's account at run end). This one only ever affects
                    // floor success chance DURING the climb and is normally restored for free
                    // by true-resume's own live towerRunCheckpoint. It's recorded here purely
                    // so /admin reset-tower's leaderboard-based reconstruction (the last-resort
                    // path for a run with no live checkpoint left to resume from) can restore
                    // it too, instead of silently defaulting it to 0 — see
                    // buildResumeCheckpointFromLeaderboardEntry in admin.js.
                    tempWorkMultiplier: rewards[tC.MODIFIER.WORK_MULTIPLIER] || 0
                });
            }
        } catch (tailError) {
            console.error(`Tower post-run bookkeeping failed for ${username} (${userId}) at floor ${floor}:`, tailError);
            const bookkeepingMessage = `your tower run at floor ${floor} finished, but something went wrong saving part of it afterward (leaderboard entry or companion bookkeeping). If your rewards or companions look off, let an admin know — timestamp: ${new Date().toISOString()}.`;
            try {
                await interaction.followUp({
                    content: `${userDisplayName}, ${bookkeepingMessage}`,
                    ephemeral: true,
                });
            } catch (notifyError) {
                // Last-resort fallback (2026-09-30) — see sendFallbackChannelMessage's own
                // comment (most commonly a dead interaction webhook token on a long, slow
                // climb). Not ephemeral once it falls back to a plain channel message — that
                // property only exists for interaction replies, there's no private-to-one-user
                // equivalent for a normal channel send.
                console.error(`Failed to notify ${username} of the Tower post-run bookkeeping failure:`, notifyError);
                await sendFallbackChannelMessage(interaction, userId, bookkeepingMessage);
            }
        }
    }
}

function createResult(rewards, floor, username){
    const embed = new EmbedBuilder()
        .setTitle(`Tower Run: ${username.toLocaleString()}\nAchieved Floor ${floor.toLocaleString()}!`)
        .setColor('Yellow')
        .setTimestamp(Date.now())
        .setFooter({text: `Tater Tower: ${username}`})
        .setThumbnail("https://cdn.discordapp.com/attachments/1146091052781011026/1207562794057203752/cute-brown-cartoon-potato-character-laughing-and-waving-hands-on-a-white-background-food-and.png?ex=65e0197d&is=65cda47d&hm=57e5b7985e414688367a7318cb3a5b3128cc8affa1d16a25b21c739549269e85&")
        .addFields(
            {
                name: "Potatoes:",
                value: `${rewards[0].toLocaleString()} potatoes`,
                inline: false,
            },
            {
                name: "Work Multiplier:",
                value: `${rewards[1].toFixed(2)} work multiplier`,
                inline: false,
            },
            {
                name: "Passive Income:",
                value: `${rewards[2].toLocaleString()} passive`,
                inline: false,
            },
            {
                name: "Bank Capacity:",
                value: `${rewards[3].toLocaleString()} capacity`,
                inline: false,
            }
        );
        return embed
}

// Bastion, the Tower Warden's drop announcement (2026-09-13) — mirrors createBountyResultEmbed's
// own isNew-branched wording for Yukon exactly (see embedFactory.js), just as a standalone
// followUp embed instead of a field on the main result, matching how this file has no
// EmbedFactory-class embeds of its own to fold it into.
function createBastionDropEmbed(bastionAward, userDisplayName){
    const { isNew, companion } = bastionAward;
    return new EmbedBuilder()
        .setTitle(isNew ? '🗿 A new companion joins you!' : '🗿 Bastion, the Tower Warden (already owned)')
        .setDescription(isNew
            ? `${companion.dropFlavor}`
            : `${userDisplayName} already has Bastion's loyalty — instead, this climb turns up a separate Bastion starting fresh at level 1. Check /companion to see and equip it individually, or sell it with /companion-sell or /companion-sell-npc.`)
        .setColor('Gold')
        .setTimestamp(Date.now())
        .setFooter({text: `Tater Tower: ${userDisplayName}`});
}