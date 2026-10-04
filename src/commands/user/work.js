const dynamoHandler = require("../../utils/dynamoHandler");
const { Work, regularWorkMobs, largePotato, poisonPotato, goldenPotato, sweetPotato, taroTrader, metalPotatoSuccess, metalPotatoFailure, ancientPotato, mimicPotato, goldenYam, awsConfigurations } = require("../../utils/constants");
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval } = require("../../utils/helperCommands")
const { WorkFactory, getEffectiveScenarioChances } = require("../../utils/workFactory");
const companionFactory = require("../../utils/companionFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { QuestFactory } = require("../../utils/questFactory");
const { GuildContractFactory } = require("../../utils/guildContractFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const { WORK_SCENARIO_INDICES } = require("../../utils/eventFactory");
const bigEventsChannel = require("../../utils/bigEventsChannel");
const festivalFactory = require("../../utils/festivalFactory");
const embedFactory = new EmbedFactory();
const workFactory = new WorkFactory();
const achievementFactory = new AchievementFactory();
const questFactory = new QuestFactory();
const guildContractFactory = new GuildContractFactory();

// Scenario types whose return value is a genuine potato gain, used to scope the
// "biggest single /work payout" personal record — see the comment at its write site
// below for why Poison/Taro/Sweet Potato are excluded.
const POTATO_PAYOUT_SCENARIO_TYPES = [
    WORK_SCENARIO_INDICES.GOLDEN,
    WORK_SCENARIO_INDICES.LARGE,
    WORK_SCENARIO_INDICES.METAL,
    WORK_SCENARIO_INDICES.REGULAR
];

function chooseMobFromList(mobList) {
    let random = Math.floor(Math.random() * mobList.length);
    const reward = mobList[random];
    return reward
}

// Every scenario's reply used to be fire-and-forget (no await, no catch) — if it ever
// threw (rate limit, network blip, stale interaction token), the DB write for that
// /work call (potatoes gained, cooldown consumed) still happened, but nothing downstream
// depends on this call succeeding, so the failure was silently swallowed and the player
// saw no result at all despite the action having gone through. Falls back to a followUp
// with the same embed so a failed edit still reaches the player instead of vanishing.
//
// isChainedReply distinguishes the original /work invocation (still edits the deferred
// reply, same as always) from an auto-chained extra work triggered by a companion's
// workCooldownSkipChance (see performWork below) — a chained result is always a brand
// new message via followUp, since editReply would just overwrite the previous link in
// the chain instead of appending another one.
async function sendWorkResult(interaction, embed, isChainedReply = false) {
    if (isChainedReply) {
        try {
            await interaction.followUp({ embeds: [embed] });
        } catch (e) {
            console.log(`work.js chained followUp failed: ${e}`);
        }
        return;
    }
    try {
        await interaction.editReply({ embeds: [embed] });
    } catch (e) {
        console.log(`work.js editReply failed, falling back to followUp: ${e}`);
        try {
            await interaction.followUp({ embeds: [embed] });
        } catch (fallbackError) {
            console.log(`work.js followUp fallback also failed: ${fallbackError}`);
        }
    }
}

function setWorkScenarios(workChances) {
    for (var scenario of workScenarios) {
        if (scenario.type != WORK_SCENARIO_INDICES.REGULAR) {
            scenario.chance = workChances[scenario.type]
        }
    }
}

// cachedSkipSources (new, 2026-10-03 /work chain write-count rewrite) — mirrors the SAME
// param workFactory.js's own handlers now accept, see dynamoHandler.calculateWorkTimerValue's
// comment on cachedSources for the full reasoning. Metal Potato's own 10%-sub-roll failure
// branch is written directly in this file (not inside a workFactory.js handler), so it
// needs its own tiny copy of the same "reproduce the exact original 2-or-3-arg call shape
// unless a real cache was supplied" logic workFactory.js's resolveWorkTimer already uses —
// mirrored here rather than shared, same "mirrored, not shared" convention this codebase's
// other small cross-file-duplicated helpers already follow (see workFactory.js's own
// getNextShopTier/getCurrentWeekTag comments).
function resolveWorkTimerForMetalFailure(userDetails, cooldownTime, cachedSkipSources) {
    return cachedSkipSources
        ? dynamoHandler.calculateWorkTimerValue(userDetails, cooldownTime, true, cachedSkipSources)
        : dynamoHandler.calculateWorkTimerValue(userDetails, cooldownTime);
}

// makeAction (new, 2026-10-03 /work chain write-count rewrite) wraps a scenario's own
// `resolve` (below) into the externally-visible, SELF-CONTAINED single-resolution contract
// every scenario's `action` has always offered — reused unchanged, still writing and
// sending immediately, by admin.js's /admin-work (which calls `scenario.action` directly,
// once, with no concept of a chain at all) and by this file's own exported `workScenarios`
// for anything else that might reuse it the same way. `resolve` itself (what performWork's
// own chain loop below calls instead) does the SAME computation but returns its write as a
// delta instead of performing it, and returns its embed/big-event payloads instead of
// sending them — see each scenario's own `resolve` for why this split exists at all.
function makeAction(resolve) {
    return async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId, isChainedReply = false) => {
        const { potatoesGained, embed, bigEvents = [], delta } = await resolve(userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, {});
        if (delta) {
            await dynamoHandler.updateUserFields(userDetails.userId, delta.setFields || {}, delta.addFields || {});
            if (delta.houseTax) {
                await dynamoHandler.addUserDatabase(awsConfigurations.clientId, 'potatoes', delta.houseTax);
            }
            if (delta.mimicHoardDelta) {
                await dynamoHandler.addStatFields('mimic_hoard', { hoardPotatoes: delta.mimicHoardDelta });
            }
            if (delta.guildRaidTimerGuildId) {
                await dynamoHandler.updateGuildDatabase(delta.guildRaidTimerGuildId, 'raidTimer', Date.now());
            }
        }
        await sendWorkResult(interaction, embed, isChainedReply);
        for (const payload of bigEvents) {
            await bigEventsChannel.postBigEvent(payload);
        }
        return potatoesGained;
    };
}

const resolveGolden = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const potatoesGained = await workFactory.handleGoldenPotato(userDetails, workGainAmount, multiplier, catchUpBonus, chainContext.cachedSkipSources);
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, goldenPotato, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    const bigEvents = [{
        title: bigEventsChannel.BIG_EVENT_WORK_TITLES.golden,
        description: `**${userDisplayName}** hit ${bigEventsChannel.BIG_EVENT_WORK_LABELS.golden} while working!`,
        fields: [bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle), bigEventsChannel.rewardField(potatoesGained)],
        color: bigEventsChannel.SCENARIO_COLOR.golden,
    }];
    return { potatoesGained, embed, bigEvents, delta };
};

const resolvePoison = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    // Poison Potato is a loss — catch-up intentionally does not apply, see workFactory.js
    const poisonResult = await workFactory.handlePoisonPotato(userDetails, workGainAmount, multiplier, chainContext.cachedSkipSources);
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createPoisonPotatoEmbed(userDisplayName, newWorkCount, poisonResult, poisonPotato, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    return { potatoesGained: poisonResult.potatoesGained, embed, bigEvents: [], delta };
};

const resolveLarge = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const potatoesGained = await workFactory.handleLargePotato(userDetails, workGainAmount, multiplier, catchUpBonus, { cachedSkipSources: chainContext.cachedSkipSources });
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, largePotato, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    return { potatoesGained, embed, bigEvents: [], delta };
};

const resolveMetal = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const metalSuccessRoll = Math.random();
    if (metalSuccessRoll < Work.METAL_SUCCESS_CHANCE) {
        const metalResult = await workFactory.handleMetalPotato(userDetails, workGainAmount, multiplier, catchUpBonus, { cachedSkipSources: chainContext.cachedSkipSources });
        const potatoesGained = metalResult.potatoesGained;
        const delta = userDetails._workChainDelta;
        const embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, metalPotatoSuccess, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance, metalResult.statGrant);
        const bigEvents = [{
            title: bigEventsChannel.BIG_EVENT_WORK_TITLES.metalSuccess,
            description: `**${userDisplayName}** hit ${bigEventsChannel.BIG_EVENT_WORK_LABELS.metalSuccess} while working!`,
            fields: [bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle), bigEventsChannel.rewardField(potatoesGained)],
            color: bigEventsChannel.SCENARIO_COLOR.metalSuccess,
        }];
        return { potatoesGained, embed, bigEvents, delta };
    }

    const potatoesGained = 0;
    let workScenarioCounts = userDetails.workScenarioCounts;
    workScenarioCounts.metalFailure += 1;
    const workTimer = await resolveWorkTimerForMetalFailure(userDetails, Work.WORK_TIMER_SECONDS, chainContext.cachedSkipSources);
    const delta = { setFields: { workScenarioCounts, workTimer }, addFields: {} };
    const embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, metalPotatoFailure, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    return { potatoesGained, embed, bigEvents: [], delta };
};

const resolveSweet = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const sweetResult = await workFactory.handleSweetPotato(userDetails, { cachedSkipSources: chainContext.cachedSkipSources });
    const potatoesGained = 0;
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, sweetPotato, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance, sweetResult.statGrant);
    return { potatoesGained, embed, bigEvents: [], delta };
};

// forcedCompanionId lets /admin-work skip the roll and test a specific companion directly
// — every real /work call (chained or not) omits it, leaving it undefined and falling
// through to the normal roll inside handleCompanionEncounter.
const resolveCompanion = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const companionResult = await workFactory.handleCompanionEncounter(userDetails, forcedCompanionId, chainContext.cachedSkipSources);
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createCompanionEncounterEmbed(userDisplayName, newWorkCount, companionResult, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    const bigEvents = bigEventsChannel.isBigEventCompanion(companionResult.companion) ? [{
        title: '🎉 Rare Companion!',
        description: `**${userDisplayName}** crossed paths with a rare companion while working!`,
        fields: [
            bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle),
            bigEventsChannel.companionField(companionResult.companion),
            bigEventsChannel.sourceField('Found while Working'),
        ],
        color: bigEventsChannel.RARE_COMPANION_COLOR,
    }] : [];
    // A companion encounter (new or duplicate) never pays potatoes anymore — a duplicate
    // grants a spare instead (see handleCompanionEncounter) — so this always returns 0
    // rather than an undefined companionResult.potatoesGained, which would otherwise
    // poison the chain's totalPayout accumulation with NaN.
    return { potatoesGained: 0, embed, bigEvents, delta };
};

const resolveTaro = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const starchesGained = await workFactory.handleTaroTrader(userDetails, catchUpBonus, chainContext.cachedSkipSources);
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, starchesGained, taroTrader, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    return { potatoesGained: starchesGained, embed, bigEvents: [], delta };
};

const resolveAncient = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const ancientResult = await workFactory.handleAncientPotato(userDetails, workGainAmount, multiplier, catchUpBonus, chainContext.cachedSkipSources);
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createAncientPotatoEmbed(userDisplayName, newWorkCount, ancientResult, ancientPotato, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    // Ancient Potato has 3 mutually-exclusive outcomes (regrade / shop upgrade / straight
    // potato payout, see handleAncientPotato) — the Reward field branches the same way
    // rather than always quoting a potato amount.
    const ancientRewardFieldValue = ancientResult.regradedStatName
        ? `Free ${ancientResult.regradedStatName} Regrade`
        : ancientResult.shopUpgradedStatName
            ? `Free ${ancientResult.shopUpgradedStatName} Shop Upgrade`
            : `${ancientResult.potatoesGained.toLocaleString()} potatoes`;
    const bigEvents = [{
        title: bigEventsChannel.BIG_EVENT_WORK_TITLES.ancient,
        description: `**${userDisplayName}** hit ${bigEventsChannel.BIG_EVENT_WORK_LABELS.ancient} while working!`,
        fields: [bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle), { name: 'Reward', value: ancientRewardFieldValue, inline: true }],
        color: bigEventsChannel.SCENARIO_COLOR.ancient,
    }];
    return { potatoesGained: ancientResult.potatoesGained, embed, bigEvents, delta };
};

const resolveMimic = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    // mimicHoardDelta — see handleMimicPotato's own comment on hoardAdjustment for why this
    // chain-accumulated, not-yet-written running total has to be fed back into every
    // further Mimic link of the SAME chain.
    const mimicResult = await workFactory.handleMimicPotato(userDetails, chainContext.cachedSkipSources, chainContext.mimicHoardDelta || 0);
    const potatoesGained = mimicResult.potatoesLost;
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createMimicPotatoEmbed(userDisplayName, newWorkCount, mimicResult, mimicPotato, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    return { potatoesGained, embed, bigEvents: [], delta };
};

const resolveGoldenYam = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const starchesGained = await workFactory.handleGoldenYam(userDetails, catchUpBonus, chainContext.cachedSkipSources);
    const delta = userDetails._workChainDelta;
    const embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, starchesGained, goldenYam, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    const bigEvents = [{
        title: bigEventsChannel.BIG_EVENT_WORK_TITLES.goldenYam,
        description: `**${userDisplayName}** hit ${bigEventsChannel.BIG_EVENT_WORK_LABELS.goldenYam} while working!`,
        fields: [bigEventsChannel.playerField(userDisplayName, userDetails.equippedTitle), bigEventsChannel.rewardField(starchesGained, 'starches')],
        color: bigEventsChannel.SCENARIO_COLOR.goldenYam,
    }];
    return { potatoesGained: starchesGained, embed, bigEvents, delta };
};

const resolveRegular = async (userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, forcedCompanionId, chainContext = {}) => {
    const potatoesGained = await workFactory.handleRegularWork(userDetails, workGainAmount, multiplier, catchUpBonus, chainContext.cachedSkipSources);
    const delta = userDetails._workChainDelta;
    const regularMob = chooseMobFromList(regularWorkMobs);
    const embed = embedFactory.createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, regularMob, userDetails._cooldownSkippedByCompanion, userDetails._companionXpGained, companionFactory.getActiveCompanion(userDetails)?.name, userDetails._cooldownSkipChance);
    return { potatoesGained, embed, bigEvents: [], delta };
};

var workScenarios = [
    { resolve: resolveGolden, action: makeAction(resolveGolden), chance: .001, type: WORK_SCENARIO_INDICES.GOLDEN },
    { resolve: resolvePoison, action: makeAction(resolvePoison), chance: .011, type: WORK_SCENARIO_INDICES.POISON },
    { resolve: resolveLarge, action: makeAction(resolveLarge), chance: .051, type: WORK_SCENARIO_INDICES.LARGE },
    { resolve: resolveMetal, action: makeAction(resolveMetal), chance: .061, type: WORK_SCENARIO_INDICES.METAL },
    { resolve: resolveSweet, action: makeAction(resolveSweet), chance: .081, type: WORK_SCENARIO_INDICES.SWEET },
    { resolve: resolveCompanion, action: makeAction(resolveCompanion), chance: .096, type: WORK_SCENARIO_INDICES.COMPANION },
    { resolve: resolveTaro, action: makeAction(resolveTaro), chance: .116, type: WORK_SCENARIO_INDICES.TARO },
    // Halved again 2026-08-29 — direct instruction ("lower ancient potato odds under
    // golden potato"), kept in lockstep with eventFactory.js's workProbability/
    // workChances (both the constructor's baseline arrays and setBaseWorkChances/
    // setBaseWorkProbability's post-event reset copies), which overwrite this value
    // via setWorkScenarios whenever a special event starts/ends.
    { resolve: resolveAncient, action: makeAction(resolveAncient), chance: .1165, type: WORK_SCENARIO_INDICES.ANCIENT },
    { resolve: resolveMimic, action: makeAction(resolveMimic), chance: .1265, type: WORK_SCENARIO_INDICES.MIMIC }, // shifted down to match Ancient's slice shrinking above — own slice width unchanged
    { resolve: resolveGoldenYam, action: makeAction(resolveGoldenYam), chance: .1275, type: WORK_SCENARIO_INDICES.GOLDEN_YAM }, // shifted down to match — own slice width unchanged
    { resolve: resolveRegular, action: makeAction(resolveRegular), chance: 1, type: WORK_SCENARIO_INDICES.REGULAR }
]

// One full /work resolution, covering the ENTIRE cooldown-skip chain (1 to
// Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH + 1 links) in one pass, rather than one performWork
// call per link recursing into the next. Rewritten 2026-10-03 (direct instruction — the
// full rewrite option, not the scoped-down safe win) to hit a specific target: this
// player's own dynamoHandler.updateUserFields gets called exactly ONCE no matter how deep
// the chain goes, instead of once per link. Every scenario handler in workFactory.js was
// rewritten alongside this to match — they compute their reward and return it as a DELTA
// (stamped onto userDetails._workChainDelta, see workFactory.js's own comment on that
// convention) instead of writing to the DB themselves, so this loop can accumulate every
// link's delta in memory and fire one real write at the very end.
//
// Two real, KNOWINGLY ACCEPTED correctness tradeoffs came out of this, not oversights:
//
// 1. Buff staleness within a chain — see dynamoHandler.calculateWorkTimerValue's own
//    comment on cachedSources, and .claude/roadmap.md's dated entry for this rewrite, for
//    the full writeup. In short: cachedSkipSources below is read ONCE at the top of this
//    function and handed to every link's own cooldown-skip roll for the rest of this same
//    chain, instead of each link re-fetching it fresh the way the 2026-09-20 architect pass
//    originally guaranteed. A companion swap, guild buff change, or Spud Keep holder change
//    mid-chain won't be picked up until this player's NEXT /work call.
// 2. Atomicity across the whole chain — a direct, unavoidable consequence of "exactly one
//    write," not a separate choice. Previously, each link wrote (and announced) its own
//    result immediately, so a crash on link 3 of a chain still left links 1-2's real
//    rewards persisted and their embeds already sent. Now, nothing is written OR announced
//    until the single end-of-chain write succeeds — a crash anywhere in the loop below
//    (before that write) discards the WHOLE chain's computed-but-unpersisted result, not
//    just the link that crashed. In practice this only ever matters for a genuine crash
//    (a thrown error, not a normal roll outcome) partway through an already-rare multi-link
//    chain, and the auto-recovery message below still tells the player plainly that
//    nothing was lost and /work is immediately available again — which is now actually
//    true for the ENTIRE chain, not just whichever link happened to crash.
async function performWork(interaction, userId, username, userDisplayName, workGainAmount) {
    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
        return;
    }

    const timeUntilWorkAvailableInMS = userDetails.workTimer - Date.now();
    if (timeUntilWorkAvailableInMS > 0) {
        interaction.editReply(`${userDisplayName}, you are unable to work and must wait ${convertSecondstoMinutes(Math.floor(timeUntilWorkAvailableInMS/1000))} before working again!`);
        return;
    };

    // Companion Hunt (systems/companions.md#companion-hunt) — a separate field from
    // workTimer entirely (see dynamoHandler.getDefaultUserFields' own comment on why), so
    // it can never tangle with workTimer's cooldown-skip/Poison-Potato-lockout machinery.
    const timeUntilHuntReturnsInMS = (userDetails.companionHunt?.returnsAt ?? 0) - Date.now();
    if (timeUntilHuntReturnsInMS > 0) {
        interaction.editReply(`${userDisplayName}, you're out on a companion expedition and can't work until you're back — ${convertSecondstoMinutes(Math.ceil(timeUntilHuntReturnsInMS/1000))} remaining. Run /companion-hunt action:cancel to come back early instead.`);
        return;
    };

    // preChainUserDetails — a genuine deep snapshot of this player's state before ANY link
    // of this chain ran, used as the "previous" baseline the once-per-chain quest/contract
    // checks below need (see their own call sites). userDetails itself gets mutated in
    // place as the chain progresses (see the loop below), so this has to be captured now,
    // before that starts, not derived from userDetails later.
    const preChainUserDetails = JSON.parse(JSON.stringify(userDetails));

    // Chain-start buff cache (2026-10-03 rewrite) — see this function's own top comment and
    // dynamoHandler.calculateWorkTimerValue's comment on cachedSources for the tradeoff.
    const cachedSkipSources = await dynamoHandler.getWorkCooldownSkipSources(userDetails);

    const work = await dynamoHandler.getStatDatabase('work');

    const aggregatedSetFields = {};
    let aggregatedWorkCount = 0;
    let houseTaxTotal = 0;
    let mimicHoardDelta = 0;
    let guildRaidTimerGuildId = null;
    let totalPayoutDelta = 0;
    let bestPayoutForRecord = 0;
    const pendingMessages = [];
    const pendingBigEvents = [];
    let chainDepth = 0;
    let cappedWithSkip = false;

    // Auto-recovery (2026-09-14, player-reported: "the embed didn't display" on a Mimic
    // kill) — mirrors enter-tower.js's own "Auto-recovery" fix exactly. If any scenario's
    // own resolve() throws for ANY reason, or the single end-of-chain write itself fails,
    // nothing from this chain has been written or announced yet (see this function's own
    // top comment, tradeoff #2) — the player is told plainly and can just run /work again.
    try {
        while (true) {
            // Reset BEFORE this link runs, not just read after — dynamoHandler.
            // calculateWorkTimerValue only ever SETS _cooldownSkippedByCompanion on a hit;
            // it never clears it on a miss (that was always safe before this rewrite, since
            // every link used to get a brand-new userDetails object off its own fresh
            // findUser). This loop now reuses the SAME userDetails object across every link
            // of the chain, so without this reset a miss on link N would silently inherit
            // link N-1's still-true flag from this same object and wrongly keep chaining
            // (and wrongly show "skipped!" on this link's own embed) forever.
            userDetails._cooldownSkippedByCompanion = null;

            // Companion XP display (roadmap's "Companion 'Work Count' -> 'XP' Rename"
            // entry) — recomputed fresh every link since a Companion Encounter earlier in
            // THIS SAME chain could change which companion is active's leveling grant
            // shows next. Mirrors this file's own existing _cooldownSkippedByCompanion
            // pattern: a non-persisted, in-memory-only flag read directly at each embed
            // call site instead of a formal parameter threaded through every scenario.
            const activeCompanionForXpDisplay = companionFactory.getActiveCompanion(userDetails);
            userDetails._companionXpGained = activeCompanionForXpDisplay ? companionFactory.getWorkLevelingGrant(activeCompanionForXpDisplay) : 0;

            const newWorkCount = work.workCount + chainDepth + 1;
            const workScenarioRoll = Math.random();
            let multiplier = getRandomFromInterval(.8, 1.2);
            const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);
            // Prospector/Festival odds — read fresh every link, same as before this
            // rewrite. Only the cooldown-SKIP sources (cachedSkipSources above) are
            // chain-cached; which scenario gets rolled is untouched by that tradeoff.
            const prospectorMultiplierBonus = companionFactory.getActivePerkValue(userDetails, "specialEncounterMultiplierBonus");
            const prospectorAdjustedChances = getEffectiveScenarioChances(workScenarios, prospectorMultiplierBonus);
            const activeFestival = await dynamoHandler.getActiveFestival();
            const festivalOddsOverride = festivalFactory.isFestivalLive(activeFestival) ? activeFestival.oddsOverride : null;
            const effectiveChances = festivalFactory.applyFestivalOddsOverride(prospectorAdjustedChances, festivalOddsOverride);

            let linkResult = null;
            let matchedScenarioType = null;
            for (let i = 0; i < workScenarios.length; i++) {
                const scenario = workScenarios[i];
                if (workScenarioRoll < effectiveChances[i].chance) {
                    linkResult = await scenario.resolve(userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, catchUpBonus, undefined, { cachedSkipSources, mimicHoardDelta });
                    matchedScenarioType = scenario.type;
                    break;
                }
            }

            const { potatoesGained, embed, bigEvents = [], delta } = linkResult;

            if (delta) {
                Object.assign(aggregatedSetFields, delta.setFields || {});
                if (delta.addFields?.workCount) {
                    aggregatedWorkCount += delta.addFields.workCount;
                }
                if (delta.houseTax) {
                    houseTaxTotal += delta.houseTax;
                }
                if (delta.mimicHoardDelta) {
                    mimicHoardDelta += delta.mimicHoardDelta;
                }
                if (delta.guildRaidTimerGuildId) {
                    guildRaidTimerGuildId = delta.guildRaidTimerGuildId;
                }
                // Mirrors this link's own write onto the in-memory userDetails immediately
                // — every later link (and the once-per-chain checks after the loop) needs
                // to see this link's real result, the same way a fresh re-fetch used to
                // give the old, per-link-write architecture.
                Object.assign(userDetails, delta.setFields || {});
            }

            pendingMessages.push({ embed, isChainedReply: chainDepth > 0 });
            pendingBigEvents.push(...bigEvents);

            totalPayoutDelta += potatoesGained;
            // Personal-best "biggest single /work payout" (see POTATO_PAYOUT_SCENARIO_TYPES'
            // own comment for why Poison/Taro/Sweet are excluded) — tracks the single
            // biggest qualifying link in this chain; checked once, after the loop, against
            // the stored record, same end state as checking it once per link would give.
            if (POTATO_PAYOUT_SCENARIO_TYPES.includes(matchedScenarioType) && potatoesGained > bestPayoutForRecord) {
                bestPayoutForRecord = potatoesGained;
            }

            // Companion leveling — every real /work resolution (including every link of an
            // auto-chained skip) counts toward the ACTIVE instance's workCount. Applied
            // in-memory on every link (the grant amount can change mid-chain if this very
            // link was itself a Companion Encounter swapping in a new unequipped companion
            // — though equipping still requires a deliberate /companion equip, so in
            // practice this only ever changes which existing companion keeps leveling), but
            // the actual write is folded into the one combined write below instead of one
            // per link (item 4 of this rewrite's consolidation list).
            if (userDetails.companions?.active) {
                const activeCompanionForLeveling = companionFactory.getActiveCompanion(userDetails);
                const workLevelingGrant = companionFactory.getWorkLevelingGrant(activeCompanionForLeveling);
                userDetails.companions = companionFactory.levelActiveCompanion(userDetails.companions, workLevelingGrant);
            }

            if (!userDetails._cooldownSkippedByCompanion) {
                break;
            }
            if (chainDepth < Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH) {
                chainDepth++;
                continue;
            }
            // Chain cap hit (2026-10-03 fix, preserved behavior — see this function's own
            // top comment) — this link's OWN roll also skipped, so its own delta.setFields
            // above already carries workTimer as "available now." Left alone, the player
            // could just run /work again themselves immediately for a free extra roll
            // beyond the chain cap — the result embed still says "skipped!" (that part of
            // this link was real), but workTimer gets overwritten back to a real, full
            // Work.WORK_TIMER_SECONDS cooldown below, as part of the single end-of-chain
            // write now, instead of a separate extra write.
            cappedWithSkip = true;
            break;
        }

        if (cappedWithSkip) {
            aggregatedSetFields.workTimer = Date.now() + Work.WORK_TIMER_SECONDS * 1000;
        }
        // companions — folds the in-memory leveling applied above into the SAME single
        // write as every other field, rather than companionFactory's usual callers' own
        // separate dynamoHandler.updateUserFields call for it (see this function's own top
        // comment, item 4: this consolidation was explicitly pre-approved).
        if (userDetails.companions) {
            aggregatedSetFields.companions = userDetails.companions;
        }

        // The ONE write this entire chain (1 to MAX_COOLDOWN_SKIP_CHAIN_LENGTH + 1 links)
        // produces for this player's own record — the literal target of this rewrite.
        await dynamoHandler.updateUserFields(userId, aggregatedSetFields, { workCount: aggregatedWorkCount });
        // workCount is an ADD expression, not a value this loop ever folded into
        // aggregatedSetFields/userDetails directly — mirrored onto userDetails here so the
        // once-per-chain achievement/quest/contract checks below see this chain's REAL final
        // workCount (the same value a post-write re-fetch would have given the old,
        // per-link architecture), not whatever stale value findUser returned at the top of
        // this whole chain.
        userDetails.workCount = (userDetails.workCount || 0) + aggregatedWorkCount;
    } catch (e) {
        console.error(`/work chain crashed for ${username} (${userId}), chainDepth ${chainDepth}:`, e);
        const recoveryMessage = `${userDisplayName}, your /work attempt hit an unexpected error and had to stop — sorry about that! Nothing was lost, so you can run /work again right away.`;
        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: recoveryMessage, embeds: [], components: [] });
            } else {
                await interaction.reply({ content: recoveryMessage });
            }
        } catch (replyError) {
            console.error(`Failed to notify ${username} of their /work crash:`, replyError);
        }
        return;
    }

    // Every write below this point only runs once the chain's own write above has
    // actually succeeded — see tradeoff #2 in this function's own top comment.
    if (houseTaxTotal > 0) {
        await dynamoHandler.addUserDatabase(awsConfigurations.clientId, 'potatoes', houseTaxTotal);
    }
    if (mimicHoardDelta !== 0) {
        await dynamoHandler.addStatFields('mimic_hoard', { hoardPotatoes: mimicHoardDelta });
    }
    if (guildRaidTimerGuildId) {
        await dynamoHandler.updateGuildDatabase(guildRaidTimerGuildId, 'raidTimer', Date.now());
    }

    for (const { embed, isChainedReply } of pendingMessages) {
        await sendWorkResult(interaction, embed, isChainedReply);
    }
    for (const payload of pendingBigEvents) {
        await bigEventsChannel.postBigEvent(payload);
    }

    const linksRun = chainDepth + 1;
    await dynamoHandler.updateStatDatabase('work', 'workCount', work.workCount + linksRun);
    await dynamoHandler.updateStatDatabase('work', 'totalPayout', work.totalPayout + totalPayoutDelta);

    if (bestPayoutForRecord > 0) {
        await dynamoHandler.updateIfNewRecord(userId, 'biggestWorkPayout', bestPayoutForRecord);
    }

    // Achievements/Quests/Festival Quests/Guild Contract — consolidated to run ONCE for
    // the whole chain (item 4 of this rewrite) rather than once per link, using userDetails'
    // final post-chain state against preChainUserDetails' real pre-chain baseline. This is
    // a non-write-count-affecting consolidation confirmed safe before this rewrite started:
    // every one of these checks is itself a monotonic "did we newly cross a threshold"
    // check, so running it once against the chain's full before/after span gives the exact
    // same end state as running it once per link would have.
    const newlyUnlocked = await achievementFactory.checkAndUnlock(userDetails);
    if (newlyUnlocked.length > 0) {
        const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
        interaction.followUp({ embeds: achievementEmbeds });
        userDetails.achievements = [
            ...(userDetails.achievements || []),
            ...newlyUnlocked.map(achievement => achievement.id)
        ];
    }

    const questResult = await questFactory.checkAndClaimQuests(userDetails, preChainUserDetails);
    if (questResult.completedQuests.length > 0) {
        const questEmbed = embedFactory.createQuestCompleteEmbed(userDisplayName, questResult.completedQuests, userDetails.workMultiplierAmount);
        interaction.followUp({ embeds: [questEmbed] });
    }

    const festivalQuestResult = await festivalFactory.checkAndClaimFestivalQuests(userDetails, preChainUserDetails);
    if (festivalQuestResult.completedObjectives.length > 0) {
        const festivalQuestEmbed = embedFactory.createFestivalQuestCompleteEmbed(userDisplayName, festivalQuestResult.completedObjectives, festivalQuestResult.festivalId);
        interaction.followUp({ embeds: [festivalQuestEmbed] });
    }

    if (userDetails.guildId) {
        const guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (guild) {
            const contractResult = await guildContractFactory.checkAndClaimContract(guild, userDetails, preChainUserDetails);
            if (contractResult.completedNow) {
                const contractEmbed = embedFactory.createGuildContractCompleteEmbed(guild.guildName, contractResult.template, contractResult.bankCapacityReward);
                interaction.followUp({ embeds: [contractEmbed] });
            }
        }
    }
}

module.exports = {
    name: "work",
    description: "Allows member to work and gain potatoes",
    devOnly: false,
    deleted: false,
    setWorkScenarios, //adding this so we can see it in backgroundEvents
    workScenarios, // exposed so /admin-work can force a specific scenario's real action/embed
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const total = await dynamoHandler.getCachedServerTotal();
        const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL)
        const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        await performWork(interaction, userId, username, userDisplayName, workGainAmount);
    }
}
