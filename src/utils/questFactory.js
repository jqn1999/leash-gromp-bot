const dynamoHandler = require("../utils/dynamoHandler");
const { getStatValue } = require("../utils/achievementFactory");
const { Quests, DailyQuest, WeeklyQuest } = require("../utils/constants");

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

class QuestFactory {
    // Refreshes the daily quest set every time this runs, and the weekly set only on
    // Mondays (otherwise keeps whatever's already active). Returns the new active set,
    // plus which categories actually rotated this call (for the announcement).
    async rotateQuests() {
        const now = new Date();
        const today = getDateStringEST(now);
        const dailyPool = Quests.filter(quest => quest.category === 'daily');
        const weeklyPool = Quests.filter(quest => quest.category === 'weekly');

        const current = await dynamoHandler.getActiveQuests();
        const weeklyDue = isMondayEST(now) || !current;

        const activeQuests = {
            dailyQuestIds: pickRandomIds(dailyPool, DailyQuest.ACTIVE_COUNT),
            dailyRotationDate: today,
            weeklyQuestIds: weeklyDue ? pickRandomIds(weeklyPool, WeeklyQuest.ACTIVE_COUNT) : current.weeklyQuestIds,
            weeklyRotationDate: weeklyDue ? today : current.weeklyRotationDate
        };

        await dynamoHandler.setActiveQuests(activeQuests);
        return { activeQuests, dailyRotated: true, weeklyRotated: weeklyDue };
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
        if (!activeQuests) return { completedQuests: [], totalPotatoReward: 0, statRewards: {} };

        const activeIds = [...activeQuests.dailyQuestIds, ...activeQuests.weeklyQuestIds];
        const activeTemplates = Quests.filter(quest => activeIds.includes(quest.id));

        const userQuestState = userDetails.quests || {};
        const updatedQuestState = { ...userQuestState };
        const completedQuests = [];
        let totalPotatoReward = 0;
        const statRewards = {};
        let stateChanged = false;

        for (const template of activeTemplates) {
            const rotationDate = template.category === 'daily' ? activeQuests.dailyRotationDate : activeQuests.weeklyRotationDate;
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
                completedQuests.push(template);
                stateChanged = true;

                if (template.category === 'daily') {
                    totalPotatoReward += Math.floor(DailyQuest.BASE_REWARD_PER_MULTIPLIER * userDetails.workMultiplierAmount);
                } else if (template.reward) {
                    statRewards[template.reward.statType] = (statRewards[template.reward.statType] || 0) + template.reward.amount;
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

            await dynamoHandler.updateUserFields(userDetails.userId, setFields);
        }

        return { completedQuests, totalPotatoReward, statRewards };
    }

    // Every currently-active quest alongside this user's progress toward it, for
    // display in /quests. Doesn't snapshot or persist anything — read-only.
    getProgress(userDetails, activeQuests) {
        if (!activeQuests) return [];

        const activeIds = [...activeQuests.dailyQuestIds, ...activeQuests.weeklyQuestIds];
        const activeTemplates = Quests.filter(quest => activeIds.includes(quest.id));
        const userQuestState = userDetails.quests || {};

        return activeTemplates.map(template => {
            const rotationDate = template.category === 'daily' ? activeQuests.dailyRotationDate : activeQuests.weeklyRotationDate;
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
