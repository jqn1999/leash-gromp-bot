const dynamoHandler = require("../utils/dynamoHandler");
const { TowerLeaderboard } = require("../utils/constants");

function roundToIncrement(value, increment) {
    return Math.round(value / increment) * increment;
}

// Ranking order (2026-09-23, direct instruction): floor reached first, then elites killed,
// then potatoes earned as the final tiebreaker — a deeper run always outranks a shallower
// one regardless of the other two, and a tie on floor is broken by whoever killed more
// Elites on the way, before potatoes ever come into it. Shared by both the in-progress
// standings view (leaderboard.js's runTowerLeaderboard) and the actual payout ranking
// below, so the two can never drift onto different orderings of the same data.
//
// Old-leaderboard compatibility (same-day follow-up, direct instruction: "if theres no
// elites killed count for any user, we're still on the old tower leaderboard and to still
// rank that one in order of floor and time it came in ... going forward it would work on
// the new system") — this field ships mid-day, so a leaderboard that's already
// accumulated entries from earlier today has zero of them carrying `elitesKilled` at all
// (not 0 — genuinely `undefined`, never recorded). Treating that as "0 kills" and running
// it through the new 3-key sort would silently rewrite today's still-in-progress ranking
// using a tiebreaker nobody's entry actually has real data for. Instead: if NOT ONE entry
// in this batch has `elitesKilled` recorded yet, fall back to the exact old comparator
// (floor only) — `Array.prototype.sort` has been stable since ES2019, so ties on floor
// naturally keep `entries`' own push order, which is chronological arrival order
// (`recordTowerLeaderboardEntry` always appends), satisfying "time it came in" with no
// extra bookkeeping. The moment even one entry has the field (the first entry recorded
// after this shipped, same day or any later day), the whole batch switches to the new
// floor -> elitesKilled -> potatoes chain — `|| 0` on the other (still-old) entries in that
// mixed batch is a deliberate, temporary same-day-transition compromise, not a bug: every
// leaderboard is wiped clean at the next daily reset anyway, so this mixed state can only
// ever exist for the remainder of today.
function sortTowerLeaderboardEntries(entries) {
    const anyElitesKilledRecorded = entries.some(e => e.elitesKilled !== undefined);
    if (!anyElitesKilledRecorded) {
        return [...entries].sort((a, b) => b.floor - a.floor);
    }
    return [...entries].sort((a, b) =>
        b.floor - a.floor
        || (b.elitesKilled || 0) - (a.elitesKilled || 0)
        || (b.potatoes || 0) - (a.potatoes || 0)
    );
}

// A "prize" should never come out negative even if a run's net total for some reward
// type ended up negative (e.g. an unlucky string of Encounter-floor penalties) — a
// leaderboard bonus only ever adds.
function calculateTierBonus(entry, tierPercent) {
    return {
        potatoes: Math.max(0, Math.floor(entry.potatoes * tierPercent)),
        workMultiplier: Math.max(0, roundToIncrement(entry.workMultiplier * tierPercent, TowerLeaderboard.WORK_MULTIPLIER_ROUND)),
        passiveIncome: Math.max(0, roundToIncrement(entry.passiveIncome * tierPercent, TowerLeaderboard.PASSIVE_INCOME_ROUND)),
        bankCapacity: Math.max(0, roundToIncrement(entry.bankCapacity * tierPercent, TowerLeaderboard.BANK_CAPACITY_ROUND))
    };
}

class TowerLeaderboardFactory {
    // Ranks today's survived Tater Tower runs by floor reached, pays the top finishers
    // a bonus scaled off what THAT run itself earned, marks the #1 finisher's champion
    // count (feeds the Tater Tower Titan achievement), and clears the leaderboard for
    // the next day. Returns a summary per winner for the daily announcement — empty
    // array if nobody survived a run today.
    async payoutWinners() {
        const entries = await dynamoHandler.getTowerLeaderboard();
        if (entries.length === 0) return [];

        const ranked = sortTowerLeaderboardEntries(entries);
        const winners = ranked.slice(0, TowerLeaderboard.TIER_PERCENTAGES.length);

        const results = [];
        for (const [index, entry] of winners.entries()) {
            const tierPercent = TowerLeaderboard.TIER_PERCENTAGES[index];
            const bonus = calculateTierBonus(entry, tierPercent);

            const userDetails = await dynamoHandler.findUser(entry.userId, entry.username);
            if (!userDetails) continue;

            const setFields = {};
            const addFields = index === 0 ? { towerChampionCount: 1 } : {};
            const sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
            let earnedAnyStatBonus = false;

            // Potato bonus goes into the same pending-balance holding pen Spud Keep's
            // own pot payout uses (2026-09-22, direct instruction), collected only via
            // /collect-potatoes — see dynamoHandler.collectPendingPotatoes and
            // towerPendingPotatoes's own comment in getDefaultUserFields. Stat bonuses
            // below stay immediate.
            if (bonus.potatoes > 0) {
                addFields.towerPendingPotatoes = bonus.potatoes;
            }

            if (bonus.workMultiplier > 0) {
                setFields.workMultiplierAmount = userDetails.workMultiplierAmount + bonus.workMultiplier;
                sweetPotatoBuffs.workMultiplierAmount += bonus.workMultiplier;
                earnedAnyStatBonus = true;
            }
            if (bonus.passiveIncome > 0) {
                setFields.passiveAmount = userDetails.passiveAmount + bonus.passiveIncome;
                sweetPotatoBuffs.passiveAmount += bonus.passiveIncome;
                earnedAnyStatBonus = true;
            }
            if (bonus.bankCapacity > 0) {
                setFields.bankCapacity = userDetails.bankCapacity + bonus.bankCapacity;
                sweetPotatoBuffs.bankCapacity += bonus.bankCapacity;
                earnedAnyStatBonus = true;
            }
            if (earnedAnyStatBonus) {
                setFields.sweetPotatoBuffs = sweetPotatoBuffs;
            }

            await dynamoHandler.updateUserFields(entry.userId, setFields, addFields);

            results.push({
                place: index + 1,
                username: entry.username,
                floor: entry.floor,
                elitesKilled: entry.elitesKilled || 0,
                bonus
            });
        }

        await dynamoHandler.clearTowerLeaderboard();
        return results;
    }
}

module.exports = {
    TowerLeaderboardFactory,
    sortTowerLeaderboardEntries
}
