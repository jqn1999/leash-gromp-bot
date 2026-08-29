const dynamoHandler = require("../utils/dynamoHandler");
const { getStatValue } = require("../utils/achievementFactory");
const { Quests, DailyQuest, WeeklyQuest, MercenaryQuest } = require("../utils/constants");

// Which activeQuests field holds a template's own rotation date — shared by
// checkAndClaimQuests/getProgress so the three categories' lookup stays in one place
// instead of a ternary chain duplicated in both.
function getRotationDate(template, activeQuests) {
    if (template.category === 'daily') return activeQuests.dailyRotationDate;
    if (template.category === 'mercenary') return activeQuests.mercenaryRotationDate;
    return activeQuests.weeklyRotationDate;
}

// "Day"/"week" boundaries computed in EST, matching every other day-based reset in this
// game (Tower, daily streak, the 4am cron itself).
function getDateStringEST(date) {
    return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function isMondayEST(date) {
    return date.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' }) === 'Monday';
}

function pickRandomIds(pool, count) {
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map(quest => quest.id);
}

// Maps each weekly reward's statType to that stat's own regrade track and absolute
// completion cap (see regrade.js's workRegradeTiers/passiveRegradeTiers/bankRegradeTiers
// — the cap is that ladder's final currentRegradeAmount + increase). Deliberately reads
// regrade depth on the SAME stat the quest rewards, not overall progress — a player deep
// into work-multi regrade but untouched on passive still gets a small passive weekly
// until they actually invest there.
const WEEKLY_REWARD_REGRADE_INFO = {
    workMultiplierAmount: { regradePath: 'regrades.workMulti.regradeAmount', cap: 500 },
    passiveAmount: { regradePath: 'regrades.passiveAmount.regradeAmount', cap: 600000000 },
    // No bankCapacity entry — see constants.js's 2026-08-22 comment on weekly_work_50/
    // weekly_poison_5 for why that quest reward type was retired (ramped toward its own
    // cap-triggered no-op).
};

// Ramps linearly from reward.min (no regrade progress yet — includes the entire time a
// player is still buying shop tiers, since regrade isn't even unlockable until then, so
// this reads 0 for that whole phase) up to reward.max once that stat's regrade track is
// fully maxed, then stays capped at reward.max forever — never keeps growing past that,
// unlike every other permanent-stat source in the game.
function calculateWeeklyStatReward(userDetails, reward) {
    const info = WEEKLY_REWARD_REGRADE_INFO[reward.statType];
    const regradeProgress = getStatValue(userDetails, info.regradePath) || 0;
    const t = Math.min(regradeProgress / info.cap, 1);
    const rawAmount = reward.min + (reward.max - reward.min) * t;
    // Work multiplier stays fractional (same precision as sweet/metal potato buffs);
    // potato-denominated stats round to whole numbers like every other reward source.
    return reward.statType === 'workMultiplierAmount' ? Math.round(rawAmount * 100) / 100 : Math.round(rawAmount);
}

class QuestFactory {
    // Refreshes the daily quest set every time this runs, and the weekly + mercenary sets
    // only on Mondays (otherwise keeps whatever's already active). Mercenary shares the
    // Monday cadence but rotates independently of Weekly — its own pool/active-count/
    // rotation-date so it can never collide with or crowd out the shared Weekly slots.
    // Returns the new active set, plus which categories actually rotated this call (for
    // the announcement).
    async rotateQuests() {
        const now = new Date();
        const today = getDateStringEST(now);
        const dailyPool = Quests.filter(quest => quest.category === 'daily');
        const weeklyPool = Quests.filter(quest => quest.category === 'weekly');
        const mercenaryPool = Quests.filter(quest => quest.category === 'mercenary');

        const current = await dynamoHandler.getActiveQuests();
        const weeklyDue = isMondayEST(now) || !current;

        const activeQuests = {
            dailyQuestIds: pickRandomIds(dailyPool, DailyQuest.ACTIVE_COUNT),
            dailyRotationDate: today,
            weeklyQuestIds: weeklyDue ? pickRandomIds(weeklyPool, WeeklyQuest.ACTIVE_COUNT) : current.weeklyQuestIds,
            weeklyRotationDate: weeklyDue ? today : current.weeklyRotationDate,
            mercenaryQuestIds: weeklyDue ? pickRandomIds(mercenaryPool, MercenaryQuest.ACTIVE_COUNT) : current.mercenaryQuestIds,
            mercenaryRotationDate: weeklyDue ? today : current.mercenaryRotationDate
        };

        await dynamoHandler.setActiveQuests(activeQuests);
        return { activeQuests, dailyRotated: true, weeklyRotated: weeklyDue, mercenaryRotated: weeklyDue };
    }

    // Checks userDetails (current, post-action stats) against every currently-active
    // quest. A quest's progress is a *delta* from a per-user baseline snapshotted the
    // first time this account is checked against that quest's current rotation — not a
    // lifetime total, since the same counters (workCount, workScenarioCounts.*) never
    // reset. If a quest's stored snapshot is from an older rotation (or doesn't exist
    // yet), a fresh baseline is taken instead of reusing a stale one — this is what
    // makes a quest ID safe to reuse across future rotations.
    //
    // previousUserDetails (pre-action state, e.g. userDetails fetched at the top of
    // /work before the scenario ran) is used specifically for that fresh-baseline value.
    // Using the post-action value instead would silently absorb whatever action just
    // revealed the quest into the baseline itself, rather than counting it as progress
    // — e.g. a Sweet Potato encounter that's also this account's first check against a
    // fresh "befriend a Sweet Potato" quest would otherwise need a *second* encounter
    // that same day to complete it. Falls back to userDetails if no pre-action state is
    // available (e.g. a caller outside /work), which just reproduces the old behavior
    // rather than crashing.
    async checkAndClaimQuests(userDetails, previousUserDetails = userDetails) {
        const activeQuests = await dynamoHandler.getActiveQuests();
        if (!activeQuests) return { completedQuests: [], totalPotatoReward: 0, statRewards: {}, additionalSafehouseStorageReward: 0 };

        // Mercenary Quest is a separate, mercenary-exclusive track (see MercenaryQuest's
        // own comment in constants.js) — its IDs are only folded into activeIds (and so
        // only ever get a baseline snapshotted or a reward granted) for a userDetails that
        // is CURRENTLY a mercenary. A non-mercenary (or a not-yet-mercenary account) never
        // sees or progresses it, same as it never appearing in /quests for them either
        // (see getProgress below).
        const activeIds = [
            ...activeQuests.dailyQuestIds,
            ...activeQuests.weeklyQuestIds,
            ...(userDetails.isMercenary ? (activeQuests.mercenaryQuestIds || []) : [])
        ];
        const activeTemplates = Quests.filter(quest => activeIds.includes(quest.id));

        const userQuestState = userDetails.quests || {};
        const updatedQuestState = { ...userQuestState };
        const completedQuests = [];
        let totalPotatoReward = 0;
        const statRewards = {};
        let additionalSafehouseStorageReward = 0;
        let stateChanged = false;

        for (const template of activeTemplates) {
            const rotationDate = getRotationDate(template, activeQuests);
            const existing = userQuestState[template.id];
            const currentValue = getStatValue(userDetails, template.statPath) || 0;

            let baseline = existing;
            if (!existing || existing.rotationDate !== rotationDate) {
                // New rotation (or never seen before) — snapshot using the PRE-action
                // value, so the action that just revealed this quest still counts as
                // progress toward it rather than being spent establishing the baseline.
                const startValue = getStatValue(previousUserDetails, template.statPath) || 0;
                baseline = { startValue, rotationDate, completed: false };
                updatedQuestState[template.id] = baseline;
                stateChanged = true;
            }

            if (baseline.completed) continue;

            const progress = currentValue - baseline.startValue;
            if (progress >= template.threshold) {
                updatedQuestState[template.id] = { ...baseline, completed: true };
                stateChanged = true;

                if (template.category === 'daily') {
                    completedQuests.push(template);
                    totalPotatoReward += Math.floor(DailyQuest.BASE_REWARD_PER_MULTIPLIER * userDetails.workMultiplierAmount);
                } else if (template.reward?.type === 'additionalSafehouseStorage') {
                    // Flat, non-ramping — deliberately NOT scaled by regrade progress the
                    // way weekly statType rewards are (see MercenaryQuest's own comment in
                    // constants.js for why: a flat reward has nothing else to scale it
                    // against, so it's sized directly per-template instead).
                    completedQuests.push(template);
                    additionalSafehouseStorageReward += template.reward.amount;
                } else if (template.reward) {
                    const grantedRewardAmount = calculateWeeklyStatReward(userDetails, template.reward);
                    completedQuests.push({ ...template, grantedRewardAmount });
                    statRewards[template.reward.statType] = (statRewards[template.reward.statType] || 0) + grantedRewardAmount;
                } else {
                    completedQuests.push(template);
                }
            }
        }

        if (stateChanged) {
            const setFields = { quests: updatedQuestState };

            if (totalPotatoReward > 0) {
                setFields.potatoes = userDetails.potatoes + totalPotatoReward;
                setFields.totalEarnings = userDetails.totalEarnings + totalPotatoReward;
            }

            if (Object.keys(statRewards).length > 0) {
                let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
                for (const [statType, amount] of Object.entries(statRewards)) {
                    setFields[statType] = userDetails[statType] + amount;
                    sweetPotatoBuffs[statType] += amount;
                }
                setFields.sweetPotatoBuffs = sweetPotatoBuffs;
            }

            if (additionalSafehouseStorageReward > 0) {
                setFields.additionalSafehouseStorage = (userDetails.additionalSafehouseStorage || 0) + additionalSafehouseStorageReward;
            }

            await dynamoHandler.updateUserFields(userDetails.userId, setFields);
        }

        return { completedQuests, totalPotatoReward, statRewards, additionalSafehouseStorageReward };
    }

    // Every currently-active quest alongside this user's progress toward it, for
    // display in /quests. Doesn't snapshot or persist anything — read-only.
    getProgress(userDetails, activeQuests) {
        if (!activeQuests) return [];

        // Mercenary Quest only ever shows up here for a userDetails that IS currently a
        // mercenary — see checkAndClaimQuests' own comment above for the same gate.
        const activeIds = [
            ...activeQuests.dailyQuestIds,
            ...activeQuests.weeklyQuestIds,
            ...(userDetails.isMercenary ? (activeQuests.mercenaryQuestIds || []) : [])
        ];
        const activeTemplates = Quests.filter(quest => activeIds.includes(quest.id));
        const userQuestState = userDetails.quests || {};

        return activeTemplates.map(template => {
            const rotationDate = getRotationDate(template, activeQuests);
            const existing = userQuestState[template.id];
            const hasFreshBaseline = existing && existing.rotationDate === rotationDate;
            const currentValue = getStatValue(userDetails, template.statPath) || 0;
            const progress = hasFreshBaseline ? Math.max(0, currentValue - existing.startValue) : 0;
            const isCompleted = Boolean(hasFreshBaseline && existing.completed);

            return {
                quest: template,
                isCompleted,
                progress: Math.min(progress, template.threshold)
            };
        });
    }
}

module.exports = {
    QuestFactory
}
