const dynamoHandler = require("../utils/dynamoHandler");
const guildBuffFactory = require("../utils/guildBuffFactory");
const { getStatValue } = require("../utils/achievementFactory");
const { Titles } = require("../utils/constants");

// Titles (systems/titles.md) — a display/selection layer on top of Achievements/Rebirth/
// Mercenary Rank/Guild Level/Tower milestones. Deliberately never reads
// userDetails.achievements (that array only updates lazily at specific hook points — see
// achievements.md's own documented lag) — every Title resolves its own statPath/threshold
// straight off current userDetails instead, same "computed live off a static table, never
// stored" precedent MercenaryRank/RaidLevel already use for rank/level display.
//
// The one exception is Guild Level (`type: "guildLevel"`), the one v1 condition that ISN'T
// backed by a lifetime, never-reset counter — leaving the guild that earned it would make a
// live check go false again. Per the product owner's explicit 2026-09-20 instruction ("keep
// the title forever even if they leave guild life"), isTitleUnlocked persists that ONE
// condition type into userDetails.permanentTitles the first time it's ever seen true, and
// short-circuits on that array (no DB call at all) on every later check — see the function
// itself for the exact order of operations.
//
// `type: "festivalCosmetic"` (systems/seasonal-festivals.md's own forward reference to this
// file) needs none of that machinery — festivalCosmetics is itself an append-only owned-items
// array (a purchased cosmetic is never un-purchased), so checking it live is already
// permanent by construction, same as every `type: "stat"` condition below.
class TitleFactory {
    // Resolves whether a single title is currently unlocked. For `type: "stat"` titles this
    // is a pure, synchronous-shaped (but still async for a uniform call signature) live
    // check with no DB access. For `type: "guildLevel"` titles, checks the permanent grant
    // first (no DB call), then falls back to a live guild fetch that opportunistically
    // persists the grant if it comes back true — see class comment above.
    async isTitleUnlocked(userDetails, titleId) {
        const title = Titles.find(t => t.id === titleId);
        if (!title) return false;

        const { condition } = title;
        if (condition.type === "stat") {
            const value = getStatValue(userDetails, condition.statPath);
            return typeof value === 'number' && value >= condition.threshold;
        }

        if (condition.type === "guildLevel") {
            const permanentTitles = userDetails.permanentTitles || [];
            if (permanentTitles.includes(titleId)) return true;

            if (!userDetails.guildId) return false;
            const guild = await dynamoHandler.findGuildById(userDetails.guildId);
            if (!guild) return false;

            const level = guildBuffFactory.getGuildLevel(guild.raidCount);
            const unlocked = level >= condition.minLevel;
            if (unlocked) {
                // Opportunistic one-time write — every subsequent caller (/titles,
                // /set-title, createUserEmbed) short-circuits on permanentTitles above from
                // here on, even if this player later leaves the guild that earned it.
                await dynamoHandler.updateUserFields(userDetails.userId, { permanentTitles: [...permanentTitles, titleId] });
            }
            return unlocked;
        }

        if (condition.type === "festivalCosmetic") {
            return (userDetails.festivalCosmetics || []).includes(condition.cosmeticId);
        }

        return false;
    }

    // Every title alongside whether it's unlocked and the user's current progress toward its
    // threshold, for /titles. Mirrors AchievementFactory.getProgress's shape exactly.
    // currentValue for a `type: "guildLevel"` title is the player's current live guild level
    // (0 if unguilded) rather than a stat count, so /titles can still show a "X / minLevel"
    // progress line for it — a second, independent guild fetch from isTitleUnlocked's own
    // internal one, only paid on a not-yet-permanent player's render, same one-time-cost
    // tradeoff createUserEmbed's own guild lookup already accepts (see systems/titles.md
    // section 3).
    async getTitleProgress(userDetails) {
        const results = [];
        for (const title of Titles) {
            const isUnlocked = await this.isTitleUnlocked(userDetails, title.id);
            let currentValue = 0;
            if (title.condition.type === "stat") {
                currentValue = getStatValue(userDetails, title.condition.statPath) || 0;
            } else if (title.condition.type === "guildLevel") {
                currentValue = isUnlocked ? title.condition.minLevel : await this.getCurrentGuildLevel(userDetails);
            } else if (title.condition.type === "festivalCosmetic") {
                // Binary, not a countable stat — "0 / 1" until purchased, same as a
                // guildLevel title reads "0 / minLevel" before it's ever been reached.
                currentValue = isUnlocked ? 1 : 0;
            }
            results.push({ title, isUnlocked, currentValue });
        }
        return results;
    }

    // Current live guild level (0 if unguilded/guild lookup fails) — pulled out of
    // getTitleProgress above so a locked guildLevel title can still show real "X / minLevel"
    // progress instead of a flat 0.
    async getCurrentGuildLevel(userDetails) {
        if (!userDetails.guildId) return 0;
        const guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (!guild) return 0;
        return guildBuffFactory.getGuildLevel(guild.raidCount);
    }

    // Filtered to unlocked only, for /set-title's autocomplete and its server-side
    // revalidation.
    async getUnlockedTitles(userDetails) {
        const progress = await this.getTitleProgress(userDetails);
        return progress.filter(entry => entry.isUnlocked).map(entry => entry.title);
    }

    // Pure lookup, no async — createUserEmbed's display line. Returns null if equippedTitle
    // doesn't match any current Title (defensive only; a title once equipped is never
    // supposed to disappear from the Titles table).
    getEquippedTitleLabel(titleId) {
        const title = Titles.find(t => t.id === titleId);
        if (!title) return null;
        return `${title.label} — ${title.description}`;
    }
}

module.exports = {
    TitleFactory
}
