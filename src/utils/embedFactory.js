const { EmbedBuilder } = require("discord.js");
const { GuildRoles, sweetPotato, taroTrader, goldenYam, Raid, shops, DailyQuest, Quests, GuildContract, CompanionRarity, Companions, HelpTopics, Work, REGRADE_CAPS, MercenaryRank, Safehouse } = require("../utils/constants")
const { convertSecondstoMinutes } = require("../utils/helperCommands")
const dynamoHandler = require("../utils/dynamoHandler");
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");
const guildBuffFactory = require("../utils/guildBuffFactory");
const { EventFactory } = require("../utils/eventFactory");
const { getRaidLevelInfo } = require("../utils/raidFactory");
const mercenaryFactory = require("../utils/mercenaryFactory");
const safehouseFactory = require("../utils/safehouseFactory");
const shopFactory = require("../utils/shopFactory");
const eventFactory = new EventFactory();

// Shared across every leaderboard embed so 1st/2nd/3rd read the same way everywhere —
// matches the medal convention createTowerLeaderboardResultsEmbed already established.
const LEADERBOARD_MEDALS = ['🥇', '🥈', '🥉'];
function rankLabel(index) {
    return LEADERBOARD_MEDALS[index] || `${index + 1}.`;
}

// Used by the bank embeds to show capacity fill at a glance instead of just raw numbers.
function buildProgressBar(current, max, length = 10) {
    const ratio = max > 0 ? Math.min(Math.max(current / max, 0), 1) : 0;
    const filled = Math.round(ratio * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
}

// Same check bank.js itself makes before treating capacity as Infinity — duplicated here
// (rather than threading a computed Infinity through) since createUserEmbed/
// createUserStatsEmbed only receive the raw userDetails, not bank.js's own derived value,
// and both need this same maxed check to stop showing a "Live: +Y%" bank-capacity bonus
// that's actually a no-op once the real cap is already Infinity.
function isBankCapacityMaxed(userDetails) {
    return userDetails.regrades.bankCapacity.regradeAmount >= REGRADE_CAPS.bankCapacity;
}

// bank.js passes Infinity for a fully bankCapacity-regrade-maxed player — the whole
// point of that milestone is "never worry about bank space again," so a 0%-filled
// progress bar (current / Infinity = 0) or a literal ∞ in the raw number would both
// undersell it. Shown as a full bar and "Unlimited" instead.
function formatBankCapacityField(current, capacity) {
    if (capacity === Infinity) {
        return `${'█'.repeat(10)} Unlimited\n${current.toLocaleString()} / Unlimited potatoes`;
    }
    const bar = buildProgressBar(current, capacity);
    const fillPercent = capacity > 0 ? (current / capacity * 100) : 0;
    return `${bar} ${fillPercent.toFixed(1)}%\n${current.toLocaleString()} / ${capacity.toLocaleString()} potatoes`;
}

// Shared across every companion embed so rarity reads the same way everywhere.
const COMPANION_RARITY_COLOR = {
    [CompanionRarity.COMMON]: 'Grey',
    [CompanionRarity.RARE]: 'Blue',
    [CompanionRarity.LEGENDARY]: 'Orange',
    [CompanionRarity.MYTHIC]: 'Gold'
};
const COMPANION_RARITY_LABEL = {
    [CompanionRarity.COMMON]: 'Common',
    [CompanionRarity.RARE]: 'Rare',
    [CompanionRarity.LEGENDARY]: 'Legendary',
    [CompanionRarity.MYTHIC]: 'Mythic'
};

const PERK_LABELS = {
    workMultiplierPercent: value => `+${(value * 100).toFixed(1)}% Work Multiplier`,
    workCooldownSkipChance: value => `${(value * 100).toFixed(1)}% chance to skip /work cooldown entirely`,
    passiveIncomePercent: value => `+${(value * 100).toFixed(1)}% Passive Income`,
    // Shared by real /rob (rob.js) and /rob-npc (mercenaryFactory.js's resolveNpcRob) — see
    // that function's own comment on why this used to be two separate perk types.
    robChanceFlat: value => `+${(value * 100).toFixed(1)}% Rob Success Chance`,
    // No companion currently grants this — Mole and Elder Rootbeard both moved to
    // starchSellBonusPercent in a balance pass (it only gated /buy-starch, not the free
    // starches Taro Trader/Golden Yam hand out). Wiring (this label, buyStarch.js's
    // lookup) stays in place for a future companion, same as guildRaidMultiplierPercent
    // below.
    starchCapacityPercent: value => `+${(value * 100).toFixed(1)}% Starch Capacity`,
    starchSellBonusPercent: value => `+${(value * 100).toFixed(1)}% Starch Sell Value`,
    guildRaidMultiplierPercent: value => `+${(value * 100).toFixed(1)}% Guild Raid Success Chance`,
    bankCapacityPercent: value => `+${(value * 100).toFixed(1)}% Bank Capacity`,
    regradeChanceFlat: value => `+${(value * 100).toFixed(1)}% Regrade Success Chance`,
    rebirthBonusPercent: value => `+${(value * 100).toFixed(1)}% Rebirth Bonus`,
    // The one perk that doesn't scale as a single multiplied-up value (see
    // companionFactory.getGuineaPigRebate) — takes { rebatePercent } instead of a plain
    // number, computed by formatCompanionPerks below. Used to also carry a taxPercent
    // clause (a yield tax on every other gain) — removed 2026-08-25 by direct
    // instruction, so this is now pure upside like every other perk's description.
    poisonImmunity: ({ rebatePercent }) => `On Poison Potato: gain ${(rebatePercent * 100).toFixed(1)}% of what you'd have lost instead, no cooldown lockout`,
    metalSuccessChanceFlat: value => `+${(value * 100).toFixed(1)}% chance to beat Metal Potato`,
    metalEncounterChanceFlat: value => `+${(value * 100).toFixed(1)}% chance to find Metal Potato`,
    bountyRewardPercent: value => `+${(value * 100).toFixed(1)}% Bounty Reward`,
    rivalSuccessChanceFlat: value => `+${(value * 100).toFixed(1)}% Rival Confrontation Success Chance`
};

// Mercenary Rank titles — potato-punned, same non-load-bearing flavor status
// Achievements' names already have (naming exercise, not mechanically meaningful). Rank 1
// and Rank 6 are pinned by the design doc ("Spud Recruit" -> ... -> "The Iron Tuber");
// the middle four fill in the same escalating-outlaw theme.
const MERCENARY_RANK_TITLES = {
    1: "Spud Recruit",
    2: "Tater Tracker",
    3: "Root Ranger",
    4: "Tuber Marauder",
    5: "Tater Highwayman",
    6: "The Iron Tuber"
};

// level defaults to 1 (unscaled) for roster-reference displays (createHelpCompanionsEmbed)
// that aren't showing a specific owned instance. Callers that ARE showing one (the
// companion list, market listings) pass the real level so the value shown matches what
// the perk actually resolves to in play — companionFactory.getActivePerkValue applies
// the exact same scaling at the real usage site, so this never overstates it.
function formatCompanionPerks(companion, level = 1) {
    const multiplier = companionFactory.getLevelMultiplier(level);
    return companion.perks.map(perk => {
        // poisonImmunity doesn't fit the "one value multiplied up" shape every other perk
        // uses — see companionFactory.getGuineaPigRebate.
        if (perk.type === 'poisonImmunity') {
            return PERK_LABELS.poisonImmunity({
                rebatePercent: Work.GUINEA_PIG_POISON_REBATE_PERCENT * multiplier
            });
        }
        return PERK_LABELS[perk.type](perk.value * multiplier);
    }).join(', ');
}

// Every companion carrying workCooldownSkipChance (Fieldmouse/Spudsprite/Mochi) gets its
// own emoji + in-character line here instead of one shared "Fieldmouse" field regardless
// of which one actually triggered — see dynamoHandler.calculateWorkTimerValue, which
// stashes the id of whichever companion rolled the skip.
const COOLDOWN_SKIP_FLAVOR = {
    fieldmouse: { emoji: '🐭', text: 'Scouted ahead — your /work cooldown never started, go again right away!' },
    spudsprite: { emoji: '✨', text: 'Bent time around your cooldown — it never even started, go again right away!' },
    mochi: { emoji: '🐈‍⬛', text: 'Kept pace with you the whole way — your cooldown never started, go again right away!' }
};

// companionId: the active companion's id that rolled the skip, or a falsy value if it
// didn't happen this call — callers just do `if (cooldownSkippedByCompanion) fields.push(...)`.
function buildCooldownSkipField(companionId) {
    const companion = Companions.find(c => c.id === companionId);
    const flavor = COOLDOWN_SKIP_FLAVOR[companionId];
    return {
        name: `${flavor.emoji} ${companion.name}:`,
        value: flavor.text,
        inline: false,
    };
}

class EmbedFactory {
    // Paginated 2 pages — Overview (economy stats) and Activity & Records — same
    // Previous/Next button mechanics as /quests, just over a fixed field set instead of
    // a variable-length list, since streaks + personal records made the single-embed
    // version too tall to read comfortably. pageIndex defaults to 0 so every existing
    // non-paginating caller (if any) still gets the overview page unchanged.
    async createUserEmbed(userId, currentName, userAvatarHash, userDetails, pageIndex = 0) {
        const avatarUrl = getUserAvatar(userId, userAvatarHash);
        let title = `${currentName}`;
        // Only shown once there's something to show — a fresh account that has never
        // rebirthed doesn't get a "Rebirth 0" tag cluttering every profile.
        if (userDetails.rebirthCount > 0) {
            title += ` 🌱Rebirth ${userDetails.rebirthCount}`;
        }
        // Loose `!= 0` treats a genuinely unset guildId (undefined) as "has a guild" —
        // undefined != 0 is true — calling findGuildById(undefined) and crashing on
        // guild.guildName once findGuildById's own error handling returns nothing.
        // Truthy check treats 0 and undefined/null the same, both correctly "no guild".
        if (userDetails.guildId) {
            const guild = await dynamoHandler.findGuildById(userDetails.guildId);
            if (guild) title += ` (${guild.guildName})`
        }

        const totalPages = 2;
        let fields = [];
        let description;

        if (pageIndex === 0) {
            description = `This is your profile where\nyou can view your potatoes\nPage 1 / ${totalPages}`;
            const potatoes = userDetails.potatoes;
            fields.push({
                name: "Current Potatoes:",
                value: `${potatoes.toLocaleString()} potatoes`,
                inline: false,
            });
            fields.push({
                name: "Banked Potatoes:",
                value: `${userDetails.bankStored.toLocaleString()} potatoes`,
                inline: false,
            });
            fields.push({
                name: "Starches:",
                value: `${userDetails.starches.toLocaleString()} starches`,
                inline: false,
            });
            // Every live modifier (guild buff, companion perk, rebirth's live %) gets
            // folded into these three display lines the same way — otherwise the number
            // shown would understate what /work, the passive tick, and /bank actually use.
            const rebirthPercent = rebirthFactory.getLiveRebirthPercent(userDetails);

            const additionalWorkMulti = await getGuildWorkMulti(userDetails, userDetails.workMultiplierAmount);
            const companionWorkMulti = userDetails.workMultiplierAmount * companionFactory.getActivePerkValue(userDetails, "workMultiplierPercent");
            const rebirthWorkMulti = userDetails.workMultiplierAmount * rebirthPercent;
            const totalWorkBonus = additionalWorkMulti + companionWorkMulti + rebirthWorkMulti;
            const workMultiLabel = totalWorkBonus > 0
                ? `${(userDetails.workMultiplierAmount + totalWorkBonus).toFixed(2)}x (+${totalWorkBonus.toFixed(2)}x)`
                : `${(userDetails.workMultiplierAmount).toFixed(2)}x`;
            fields.push({
                name: "Current Work Multiplier:",
                value: workMultiLabel,
                inline: false,
            });

            const totalPassivePercent = companionFactory.getActivePerkValue(userDetails, "passiveIncomePercent") + rebirthPercent;
            const passiveBonus = Math.round(userDetails.passiveAmount * totalPassivePercent);
            const passiveLabel = passiveBonus > 0
                ? `${(userDetails.passiveAmount + passiveBonus).toLocaleString()} potatoes per day (+${passiveBonus.toLocaleString()})`
                : `${userDetails.passiveAmount.toLocaleString()} potatoes per day`;
            fields.push({
                name: "Current Passive Income:",
                value: passiveLabel,
                inline: false,
            });

            let bankLabel;
            if (isBankCapacityMaxed(userDetails)) {
                bankLabel = `Unlimited (bank capacity regrade fully maxed)`;
            } else {
                const totalBankPercent = companionFactory.getActivePerkValue(userDetails, "bankCapacityPercent") + rebirthPercent;
                const bankBonus = Math.round(userDetails.bankCapacity * totalBankPercent);
                bankLabel = bankBonus > 0
                    ? `${(userDetails.bankCapacity + bankBonus).toLocaleString()} potatoes (+${bankBonus.toLocaleString()})`
                    : `${userDetails.bankCapacity.toLocaleString()} potatoes`;
            }
            fields.push({
                name: "Current Bank Capacity:",
                value: bankLabel,
                inline: false,
            });
            fields.push({
                name: "Current Starch Capacity:",
                value: `${userDetails.maxStarches.toLocaleString()} starches`,
                inline: false,
            });
            const activeCompanion = companionFactory.getActiveCompanion(userDetails);
            // Same level lookup getActivePerkValue used just above for the actual Work
            // Multiplier/Passive Income/Bank Capacity numbers — without it this line would
            // show the base (level 1) perk text while the bonuses folded in above it are
            // already the real leveled amount, understating what's actually being applied.
            const activeCompanionLevel = activeCompanion
                ? companionFactory.getCompanionLevel(companionFactory.getOwnedEntry(userDetails, activeCompanion.id)?.workCount)
                : 1;
            fields.push({
                name: "Active Companion:",
                value: activeCompanion ? `${activeCompanion.name} (${formatCompanionPerks(activeCompanion, activeCompanionLevel)})` : "None equipped",
                inline: false,
            });

            // Mercenary Bounties — mutually exclusive with guild membership, so this only
            // ever shows for a non-guilded mercenary. Rank is computed live off
            // mercenaryBountyWinCount, same "never stored" precedent Guild Level already
            // sets — see mercenaryFactory.getMercenaryRankInfo.
            if (userDetails.isMercenary) {
                const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
                const title = MERCENARY_RANK_TITLES[rankInfo.rank] || `Rank ${rankInfo.rank}`;
                const highestTier = ['I', 'II', 'III'][rankInfo.unlocksTier - 1];
                fields.push({
                    name: "Mercenary Rank:",
                    value: `Rank ${rankInfo.rank} — ${title} (Tier ${highestTier} unlocked, ${(userDetails.mercenaryBountyWinCount || 0).toLocaleString()} wins)`,
                    inline: false,
                });
            }
        } else {
            description = `Activity & Records\nPage 2 / ${totalPages}`;
            fields.push({
                name: "Work Count:",
                value: `${userDetails.workCount.toLocaleString()} works`,
                inline: false,
            });
            fields.push({
                name: "Daily Login Streak:",
                value: `${(userDetails.loginStreak || 0).toLocaleString()} days`,
                inline: false,
            });
            // records is backfilled by findUser's self-healing for any account that
            // existed before this field was added, but guard with `|| {}`/`|| 0` anyway
            // rather than assume every caller of createUserEmbed went through findUser.
            const records = userDetails.records || {};
            fields.push({
                name: "Personal Records:",
                value: `Highest Tower floor: ${(records.highestTowerFloor || 0).toLocaleString()}\n`
                    + `Biggest /work payout: ${(records.biggestWorkPayout || 0).toLocaleString()} potatoes\n`
                    + `Largest raid contribution: ${(records.largestRaidContribution || 0).toLocaleString()} potatoes`,
                inline: false,
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields);
        return embed;
    }

    // Async as of the live-data update — matches createUserEmbed's shape exactly (same
    // three live modifiers: guild buff, active companion perk, rebirth's live %) so
    // /user-stats and /profile can no longer show two different "current" numbers for
    // the same account. The base+buff+regrade breakdown stays (useful on its own — it's
    // the only place that shows where the stored number actually comes from), with the
    // live effective total appended alongside it rather than replacing it.
    async createUserStatsEmbed(userId, currentName, userAvatarHash, userDetails) {
        const avatarUrl = getUserAvatar(userId, userAvatarHash);

        const userBaseWorkMultiplier = userDetails.workMultiplierAmount - userDetails.sweetPotatoBuffs.workMultiplierAmount - userDetails.regrades.workMulti.regradeAmount;
        const userBasePassiveIncome = userDetails.passiveAmount - userDetails.sweetPotatoBuffs.passiveAmount - userDetails.regrades.passiveAmount.regradeAmount;
        const userBaseBankCapacity = userDetails.bankCapacity - userDetails.sweetPotatoBuffs.bankCapacity - userDetails.regrades.bankCapacity.regradeAmount;
        const userBaseMaxStarches = userDetails.maxStarches;
        let multiplierName = findShopItemName(userBaseWorkMultiplier, shops[0].items);
        let passiveName = findShopItemName(userBasePassiveIncome, shops[1].items);
        let bankName = findShopItemName(userBaseBankCapacity, shops[2].items);
        let starchName = findShopItemName(userBaseMaxStarches, shops[3].items);

        const rebirthPercent = rebirthFactory.getLiveRebirthPercent(userDetails);
        const guildWorkMulti = await getGuildWorkMulti(userDetails, userDetails.workMultiplierAmount);
        const companionWorkMulti = userDetails.workMultiplierAmount * companionFactory.getActivePerkValue(userDetails, "workMultiplierPercent");
        const rebirthWorkMulti = userDetails.workMultiplierAmount * rebirthPercent;
        const liveWorkBonus = guildWorkMulti + companionWorkMulti + rebirthWorkMulti;

        const totalPassivePercent = companionFactory.getActivePerkValue(userDetails, "passiveIncomePercent") + rebirthPercent;
        const livePassiveBonus = Math.round(userDetails.passiveAmount * totalPassivePercent);

        const bankCapacityMaxed = isBankCapacityMaxed(userDetails);
        const totalBankPercent = companionFactory.getActivePerkValue(userDetails, "bankCapacityPercent") + rebirthPercent;
        const liveBankBonus = bankCapacityMaxed ? 0 : Math.round(userDetails.bankCapacity * totalBankPercent);

        const embed = new EmbedBuilder()
            .setTitle(`${currentName}`)
            .setDescription("This is your stats profile where\nyou can view your total gains and losses")
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .addFields(
                {
                    name: "Current Work Multiplier Upgrade:\n(Base + Bonus + Regrade)",
                    value: `${multiplierName}\n(${userBaseWorkMultiplier.toFixed(2)} + ${userDetails.sweetPotatoBuffs.workMultiplierAmount.toFixed(2)} + ${userDetails.regrades.workMulti.regradeAmount.toFixed(2)})x = ${userDetails.workMultiplierAmount.toFixed(2)}x`
                        + (liveWorkBonus > 0 ? `\nLive: ${(userDetails.workMultiplierAmount + liveWorkBonus).toFixed(2)}x (+${liveWorkBonus.toFixed(2)}x guild/companion/rebirth)` : ''),
                    inline: false,
                },
                {
                    name: "Current Passive Income Upgrade:",
                    value: `${passiveName}\n(${userBasePassiveIncome.toLocaleString()} + ${userDetails.sweetPotatoBuffs.passiveAmount.toLocaleString()} + ${userDetails.regrades.passiveAmount.regradeAmount.toLocaleString()}) potatoes = ${userDetails.passiveAmount.toLocaleString()}`
                        + (livePassiveBonus > 0 ? `\nLive: ${(userDetails.passiveAmount + livePassiveBonus).toLocaleString()} potatoes per day (+${livePassiveBonus.toLocaleString()})` : ''),
                    inline: false,
                },
                {
                    name: "Current Bank Capacity Upgrade:",
                    value: `${bankName}\n(${userBaseBankCapacity.toLocaleString()} + ${userDetails.sweetPotatoBuffs.bankCapacity.toLocaleString()} + ${userDetails.regrades.bankCapacity.regradeAmount.toLocaleString()}) potatoes = `
                        + (bankCapacityMaxed ? `Unlimited (regrade maxed)` : `${userDetails.bankCapacity.toLocaleString()}`)
                        + (liveBankBonus > 0 ? `\nLive: ${(userDetails.bankCapacity + liveBankBonus).toLocaleString()} potatoes (+${liveBankBonus.toLocaleString()})` : ''),
                    inline: false,
                },
                {
                    name: "Current Starch Capacity Upgrade:",
                    value: `${starchName}\n(${userBaseMaxStarches.toLocaleString()} + 0 + 0) starches`,
                    inline: false,
                },
                {
                    name: "Total Earnings:",
                    value: `${userDetails.totalEarnings.toLocaleString()} potatoes`,
                    inline: false,
                },
                {
                    name: "Total Losses:",
                    value: `${userDetails.totalLosses.toLocaleString()} potatoes`,
                    inline: false,
                }
            );
        return embed;
    }

    createUserLeaderboardEmbed(sortedUsers, total, userIndex) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        const topCount = Math.min(5, sortedUsers.length);
        const formatEntry = (element, index) => {
            const totalWealth = element.potatoes + element.bankStored;
            const isYou = index === userIndex;
            return {
                name: `${rankLabel(index)} ${element.username}${isYou ? ' (You)' : ''}`,
                value: `${totalWealth.toLocaleString()} potatoes total (${(totalWealth / total * 100).toFixed(2)}% of server)\n${element.potatoes.toLocaleString()} liquid • ${element.bankStored.toLocaleString()} banked`,
                inline: false,
            };
        };

        let userList = [];
        for (let index = 0; index < topCount; index++) {
            userList.push(formatEntry(sortedUsers[index], index));
        }

        // Only break out a separate "Your Rank" entry if you're not already visible in
        // the top 5 — otherwise this used to duplicate you at the bottom of your own list.
        if (userIndex >= topCount) {
            userList.push({ name: '​', value: '​', inline: false });
            const youEntry = formatEntry(sortedUsers[userIndex], userIndex);
            userList.push({ name: `Your Rank — ${youEntry.name}`, value: youEntry.value, inline: false });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Server Leaderboard`)
            .setDescription(`${total.toLocaleString()} potatoes across ${sortedUsers.length.toLocaleString()} players`)
            .setColor("Gold")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createUserStarchLeaderboardEmbed(sortedUsers, total, userIndex) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        const topCount = Math.min(5, sortedUsers.length);
        const formatEntry = (element, index) => {
            const isYou = index === userIndex;
            return {
                name: `${rankLabel(index)} ${element.username}${isYou ? ' (You)' : ''}`,
                value: `${element.starches.toLocaleString()} starches (${(element.starches / total * 100).toFixed(2)}% of server)`,
                inline: false,
            };
        };

        let userList = [];
        for (let index = 0; index < topCount; index++) {
            userList.push(formatEntry(sortedUsers[index], index));
        }

        if (userIndex >= topCount) {
            userList.push({ name: '​', value: '​', inline: false });
            const youEntry = formatEntry(sortedUsers[userIndex], userIndex);
            userList.push({ name: `Your Rank — ${youEntry.name}`, value: youEntry.value, inline: false });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🥔 Starch Leaderboard`)
            .setDescription(`${total.toLocaleString()} starches across ${sortedUsers.length.toLocaleString()} players`)
            .setColor("Gold")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createGuildLeaderboardEmbed(sortedGuilds) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        const topCount = Math.min(5, sortedGuilds.length);
        let guildList = []

        for (let index = 0; index < topCount; index++) {
            const element = sortedGuilds[index];
            // A guild with a data anomaly (no member holding LEADER) shouldn't take the
            // whole leaderboard down with it — show it as "Unknown" instead of crashing.
            const leader = element.memberList.find((currentMember) => currentMember.role == GuildRoles.LEADER)
            const leaderName = leader ? leader.username : 'Unknown';
            const { level } = getRaidLevelInfo(element.raidCount);

            guildList.push({
                name: `${rankLabel(index)} ${element.guildName} — Level ${level}`,
                value: `👑 ${leaderName} • 👥 ${element.memberList.length}/${element.memberCap} members • ⚔️ ${element.raidCount.toLocaleString()} raids`,
                inline: false,
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏰 Guild Leaderboard`)
            .setDescription(`${sortedGuilds.length.toLocaleString()} guilds, ranked by raid wins (level is a readout of that, see /guild)`)
            .setColor("Gold")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(guildList)
        return embed;
    }

    // Paginated exactly like createAchievementsPageEmbed/createQuestsPageEmbed — shop
    // item lists (up to 10 entries) made for a very long single embed otherwise.
    // `progress`, when passed, is { shopId, baseValue, potatoes } — the user's own tier
    // progress in this shop. Without it (no logged-in user context available) the embed
    // falls back to the old plain listing. With it, every item gets a ✅/➡️/🔒 marker (owned /
    // buyable next / needs earlier tiers first) so a player can tell where they stand without
    // cross-referencing /buy separately, and the description calls out the actual next
    // purchase (which may not even be on the current page) plus whether they can afford it.
    createShopPageEmbed(shopDetails, pageItems, pageIndex, totalPages, progress = null) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';

        let numericBaseValue, nextItem;
        if (progress) {
            numericBaseValue = Number(progress.baseValue);
            nextItem = shopFactory.getNextItemFromShop(shopDetails, progress.baseValue);
        }

        const shopList = pageItems.map(element => {
            let marker = '';
            if (progress) {
                const status = shopFactory.getShopTierStatus(element, numericBaseValue);
                marker = status === shopFactory.SHOP_TIER_STATUS.OWNED ? '✅ '
                    : status === shopFactory.SHOP_TIER_STATUS.NEXT ? '➡️ '
                    : '🔒 ';
            }
            return {
                name: `${marker}${element.id}) ${element.name} (${element.amount.toLocaleString()})`,
                value: `${element.description}\nId: ${element.id} | Cost: ${element.cost.toLocaleString()}`,
                inline: false,
            };
        });

        let description = `${shopDetails.description}`;
        if (progress) {
            description += `\nYour current tier: ${shopFactory.formatShopValue(progress.shopId, progress.baseValue)}`;
            if (nextItem === -1) {
                description += `\n✅ Fully maxed out!`;
            } else {
                const afford = progress.potatoes >= nextItem.cost ? '✅ you can afford this' : `❌ need ${(nextItem.cost - progress.potatoes).toLocaleString()} more`;
                description += `\n➡️ Next up: **${nextItem.name}** — ${nextItem.cost.toLocaleString()} potatoes (${afford})`;
            }
        }
        description += `\nPage ${pageIndex + 1} / ${totalPages}`;

        const embed = new EmbedBuilder()
            .setTitle(`${shopDetails.title}`)
            .setDescription(description)
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(shopList)
        return embed;
    }

    async createBetEmbed(betDetails, interaction) {
        let odds, ratio;
        let fields = [];
        if (betDetails.optionOneTotal > betDetails.optionTwoTotal) {
            odds = (betDetails.optionOneTotal / betDetails.optionTwoTotal).toFixed(2);
            ratio = `${odds} : 1.00`
        } else {
            odds = (betDetails.optionTwoTotal / betDetails.optionOneTotal).toFixed(2);
            ratio = `1.00 : ${odds}`
        }

        if (!betDetails.thumbnailUrl) {
            betDetails.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        fields.push({
            name: `1) ${betDetails.optionOne}`,
            value: `${betDetails.optionOneTotal.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `2) ${betDetails.optionTwo}`,
            value: `${betDetails.optionTwoTotal.toLocaleString()} potatoes`,
            inline: true,
        })

        if (betDetails.optionOneTotal != betDetails.baseAmount) {
            let largestVoterOptionOne = { userId: "", bet: 0, displayName: "" };
            let optionOneSplit, optionOnePercentage;
            betDetails.optionOneVoters.forEach(voter => {
                if (voter.bet > largestVoterOptionOne.bet) {
                    largestVoterOptionOne.userId = voter.userId;
                    largestVoterOptionOne.bet = voter.bet;
                    largestVoterOptionOne.displayName = voter.userDisplayName;
                }
            })
            const targetUserOne = await interaction.guild.members.fetch(largestVoterOptionOne.userId);
            if (!targetUserOne) {
                await interaction.editReply("That user doesn't exist in this server.");
                return;
            }
            largestVoterOptionOne.displayName = targetUserOne.user.displayName;
            optionOneSplit = largestVoterOptionOne.bet / (betDetails.optionOneTotal - betDetails.baseAmount);
            optionOnePercentage = (optionOneSplit * 100).toFixed(2);
            fields.push({
                name: `${betDetails.optionOne} Largest Bet: ${largestVoterOptionOne.bet.toLocaleString()}`,
                value: `${largestVoterOptionOne.displayName} wins ${(Math.floor(optionOneSplit * betDetails.optionTwoTotal)).toLocaleString()} potatoes (${optionOnePercentage}%)`,
                inline: false,
            })
        }

        if (betDetails.optionTwoTotal != betDetails.baseAmount) {
            let largestVoterOptionTwo = { userId: "", bet: 0, displayName: "" };
            let optionTwoSplit, optionTwoPercentage;
            betDetails.optionTwoVoters.forEach(voter => {
                if (voter.bet > largestVoterOptionTwo.bet) {
                    largestVoterOptionTwo.userId = voter.userId;
                    largestVoterOptionTwo.bet = voter.bet;
                    largestVoterOptionTwo.displayName = voter.userDisplayName;
                }
            })
            optionTwoSplit = largestVoterOptionTwo.bet / (betDetails.optionTwoTotal - betDetails.baseAmount);
            optionTwoPercentage = (optionTwoSplit * 100).toFixed(2)
            fields.push({
                name: `${betDetails.optionTwo} Largest Bet: ${largestVoterOptionTwo.bet.toLocaleString()}`,
                value: `${largestVoterOptionTwo.displayName} wins ${(Math.floor(optionTwoSplit * betDetails.optionOneTotal)).toLocaleString()} potatoes (${optionTwoPercentage}%)`,
                inline: false,
            })
        }
        fields.push({
            name: `Base Bet Amount (per side):`,
            value: `${betDetails.baseAmount.toLocaleString()} potatoes)`,
            inline: false,
        })

        const embed = new EmbedBuilder()
            .setTitle(`(1) ${betDetails.optionOne} vs (2) ${betDetails.optionTwo} (${ratio})`)
            .setDescription(`${betDetails.description}\nBelow are the current bets and their respective totals: `)
            .setColor("Orange")
            .setThumbnail(betDetails.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields);
        return embed;
    }

    createBetEndEmbed(betDetails, winningOption) {
        if (!betDetails.thumbnailUrl) {
            betDetails.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        const embed = new EmbedBuilder()
            .setTitle(`${winningOption} has won the bet!`)
            .setDescription(`Potatoes have been distributed!\nBelow are the final bet amounts and their respective totals: `)
            .setColor("Orange")
            .setThumbnail(betDetails.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .addFields(
                {
                    name: `1: ${betDetails.optionOne}`,
                    value: `${betDetails.optionOneTotal.toLocaleString()} potatoes`,
                    inline: true,
                },
                {
                    name: `2: ${betDetails.optionTwo}`,
                    value: `${betDetails.optionTwoTotal.toLocaleString()} potatoes`,
                    inline: true,
                }
            );
        return embed;
    }

    createGuildEmbed(guild) {
        let fields = [];

        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        const leader = guild.memberList.find((currentMember) => currentMember.role == GuildRoles.LEADER)
        // Computed live from raidCount (wins only) rather than a stored field — see
        // raidFactory.js's getRaidLevelInfo and constants.js's RaidLevel.
        const raidLevelInfo = getRaidLevelInfo(guild.raidCount);

        fields.push({
            name: `Leader:`,
            value: leader ? `${leader.username}` : 'Unknown',
            inline: true
        })
        fields.push({
            name: `Members:`,
            value: `${guild.memberList.length}/${guild.memberCap}`,
            inline: true
        })
        fields.push({
            name: `Guild Level:`,
            value: raidLevelInfo.winsToNextLevel !== null
                ? `${raidLevelInfo.level} (${raidLevelInfo.winsToNextLevel.toLocaleString()} raid wins to next level)`
                : `${raidLevelInfo.level} (max)`,
            inline: true
        })
        fields.push({
            name: `Bank Stored:`,
            value: `${guild.bankStored.toLocaleString()}`,
            inline: true
        })
        fields.push({
            name: `Bank Capacity:`,
            value: `${guild.bankCapacity.toLocaleString()}`,
            inline: true
        })
        fields.push({
            name: `Total Earnings:`,
            value: `${guild.totalEarnings.toLocaleString()}`,
            inline: true
        })
        fields.push({
            name: `Raid Count:`,
            value: `${guild.raidCount.toLocaleString()}`,
            inline: true
        })
        fields.push({
            name: `Reward Multiplier:`,
            value: `${raidLevelInfo.multiplier.toFixed(2)}x (raid wins only)`,
            inline: true
        })
        fields.push({
            name: `Guild Buff:`,
            value: guildBuffFactory.getGuildBuffLabel(guild.guildBuff, raidLevelInfo.level) || `${guild.guildBuff}`,
            inline: false
        })

        const embed = new EmbedBuilder()
            .setTitle(`${guild.guildName}`)
            .setDescription(`Below is guild information for guild '${guild.guildName}'`)
            .setColor("Orange")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields);
        return embed;
    }

    createGuildMemberListEmbed(guild, interaction) {
        let userList = [];
        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        let memberList = guild.memberList;
        const leader = memberList.find((currentMember) => currentMember.role == GuildRoles.LEADER);
        if (!leader) {
            interaction.editReply(`${userDisplayName} there was an error retrieving the guild leader of your guild. Let an admin know!`);
            return;
        }
        userList.push({
            name: `${leader.role}`,
            value: `${leader.username}`,
            inline: false,
        })
        const coleaderList = memberList.filter((currentMember) => currentMember.role == GuildRoles.COLEADER)
        if (coleaderList.length > 0) {
            let stringListOfMembers = ``;
            for (const [index, element] of coleaderList.entries()) {
                stringListOfMembers += `${element.username}\n`
            }
            const listOfMembers = {
                name: `${GuildRoles.COLEADER}`,
                value: `${stringListOfMembers}`,
                inline: false,
            };
            userList.push(listOfMembers);
        }
        
        const elderList = memberList.filter((currentMember) => currentMember.role == GuildRoles.ELDER)
        if (elderList.length > 0) {
            let stringListOfMembers = ``;
            for (const [index, element] of elderList.entries()) {
                stringListOfMembers += `${element.username}\n`
            }
            const listOfMembers = {
                name: `${GuildRoles.ELDER}`,
                value: `${stringListOfMembers}`,
                inline: false,
            };
            userList.push(listOfMembers);
        }

        const regularMemberList = memberList.filter((currentMember) => currentMember.role == GuildRoles.MEMBER)
        if (regularMemberList.length > 0) {
            let stringListOfMembers = ``;
            for (const [index, element] of regularMemberList.entries()) {
                stringListOfMembers += `${element.username}\n`
            }
            const listOfMembers = {
                name: `${GuildRoles.MEMBER}`,
                value: `${stringListOfMembers}`,
                inline: false,
            };
            userList.push(listOfMembers);
        }

        const embed = new EmbedBuilder()
            .setTitle(`${guild.guildName}`)
            .setDescription(`Below is the list of members for guild '${guild.guildName}'`)
            .setColor("Orange")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList);
        return embed;
    }

    async createRaidMemberListEmbed(guild, raidList, totalMultiplier, timeUntilRaidAvailableInSeconds) {
        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        let raidTime = '';
        if (timeUntilRaidAvailableInSeconds > 0) {
            raidTime = convertSecondstoMinutes(timeUntilRaidAvailableInSeconds);
        } else {
            raidTime = 'Ready'
        }

        const embed = new EmbedBuilder()
            .setTitle(`${guild.guildName} (Total Multiplier: ${totalMultiplier.toFixed(2)}x)\nRaid Timer: ${raidTime}`)
            .setDescription(`Below is the list of the current raid members for '${guild.guildName}'`)
            .setColor("Orange")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(raidList);
        return embed;
    }

    // Shown before /start-raid actually rolls — a raid's difficulty bracket (Metal
    // King/T3/T2/T1) is picked randomly, so there's no single "success chance" to
    // preview like /rob has; instead this breaks down every bracket you could land in
    // along with its own odds, success chance, and stakes, so whoever's starting it (and
    // committing the whole roster's raid list) isn't picking blind.
    createRaidPreviewEmbed(guildName, raidSelection, raiderCount, totalMultiplier, brackets, guildLevel, raidRewardMultiplier) {
        const fields = brackets.map(bracket => ({
            name: `${bracket.name} (${(bracket.odds * 100).toFixed(0)}% odds of this bracket)`,
            value: `${(bracket.successChance * 100).toFixed(1)}% success chance\n✅ ${bracket.rewardText}\n❌ ${bracket.penaltyText}`,
            inline: false,
        }));

        // Reward numbers in each bracket above already have the level multiplier baked
        // in — this line just makes it visible why, instead of leaving players to infer
        // it from the raw numbers.
        const levelNote = guildLevel > 1 ? ` Guild Level ${guildLevel} (${raidRewardMultiplier.toFixed(2)}x reward multiplier) is already applied below.` : '';

        const embed = new EmbedBuilder()
            .setTitle(`${guildName}, start a ${raidSelection} raid?`)
            .setDescription(`${raiderCount} raider${raiderCount == 1 ? '' : 's'} joined, ${totalMultiplier.toFixed(2)}x effective raid power (average work multiplier + rebirth bonus across raiders, boosted by roster size).${levelNote} Confirm to roll — whichever bracket below you land in resolves immediately, no second chance to back out once rolled.`)
            .setColor("Yellow")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRaidCancelledEmbed(guildName) {
        const embed = new EmbedBuilder()
            .setTitle(`${guildName}'s raid was not started`)
            .setDescription(`No roll happened — the raid roster is untouched, start it again whenever ready.`)
            .setColor("Grey")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // Paginated exactly like createAchievementsPageEmbed/createShopPageEmbed — unlike a
    // guild raid (capped at memberCap, currently 5), anyone on the server can join a
    // world raid, so raidList has no upper bound and could otherwise exceed Discord's
    // 25-field embed limit and throw.
    createWorldRaidPageEmbed(pageItems, pageIndex, totalPages, totalMultiplier, name, thumbnail) {
        const embed = new EmbedBuilder()
            .setTitle(`${name}: (Total Multiplier: ${totalMultiplier.toFixed(2)}x)`)
            .setDescription(`Below is the list of the current raid members\nPage ${pageIndex + 1} / ${totalPages}`)
            .setColor("Orange")
            .setThumbnail(thumbnail)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(pageItems);
        return embed;

    }

    createRaidEmbed(guildName, raidList, raidCount, totalRaidReward, splitRaidReward, mob, successChance,
        raidResultDescription, multiplierReward = null, passiveReward = null, capacityReward = null) {
        let fields = [], footerText = "Made by Beggar", statRewardMessage = '';
        const hasStatReward = multiplierReward || passiveReward || capacityReward;
        const color = totalRaidReward > 0 || hasStatReward ? 'Green' : 'Red';

        fields.push({
            name: `Result:`,
            value: `${raidResultDescription}`,
            inline: true,
        })
        if (multiplierReward) {
            statRewardMessage += `${multiplierReward.toFixed(2).toLocaleString()} work multiplier to all members!\n`
        }
        if (passiveReward) {
            statRewardMessage += `${passiveReward.toLocaleString()} passive amount to all members!\n`
        }
        if (capacityReward) {
            statRewardMessage += `${capacityReward.toLocaleString()} bank capacity to all members!\n`
        }
        if (hasStatReward) {
            fields.push({
                name: `Stats Granted:`,
                value: `${statRewardMessage}`,
                inline: false,
            })
        }

        fields.push({
            name: `Success Chance:`,
            value: `${(successChance * 100).toFixed(2)}% chance`,
            inline: true,
        })

        const gainOrLoss = totalRaidReward >= 0 ? 'Gained' : 'Lost'
        let usedBankText = ''
        if (!splitRaidReward) {
            usedBankText = totalRaidReward >= 0 ? ' In Guild Bank' : ' From Guild Bank'
        }
        fields.push({
            name: `Total Potatoes ${gainOrLoss}${usedBankText}:`,
            value: `${totalRaidReward.toLocaleString()} potatoes`,
            inline: false,
        })
        if (splitRaidReward) {
            fields.push({
                name: `Split Potatoes ${gainOrLoss}:`,
                value: `${splitRaidReward.toLocaleString()} potatoes`,
                inline: true,
            })
        }

        let stringListOfMembers = ``;
        for (const [index, element] of raidList.entries()) {
            stringListOfMembers += `${element.username}\n`
        }
        const listOfMembers = {
            name: `Members In Raid:`,
            value: `${stringListOfMembers}`,
            inline: false,
        };
        fields.push(listOfMembers);

        fields.push({
            name: `Raid Count:`,
            value: `${(raidCount).toLocaleString()}`,
            inline: true,
        })

        if (mob.credit) {
            footerText = mob.credit;
        }

        const embed = new EmbedBuilder()
            .setTitle(`'${guildName}' encountered ${mob.name}!`)
            .setDescription(`${mob.description}`)
            .setColor(color)
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createWorldEmbed(mob){
        //let fields = [], footerText = "Made by Beggar";
        let footerText = "Made by Beggar"

        const embed = new EmbedBuilder()
            .setTitle(`'${mob.name}`)
            .setDescription(`${mob.description}`)
            .setColor("Orange")
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
           // .setFields(fields)
        return embed;
    }


    createWorldResultEmbed(raidList, totalRaidReward, mob, successChance,
        raidResultDescription, multiplierReward = null, passiveReward = null, capacityReward = null) {
        let fields = [], footerText = "Made by Beggar", statRewardMessage = '';
        const hasStatReward = multiplierReward || passiveReward || capacityReward;
        const color = totalRaidReward > 0 || hasStatReward ? 'Green' : 'Red';
        fields.push({
            name: `Result:`,
            value: `${raidResultDescription}`,
            inline: true,
        })
        if (multiplierReward) {
            statRewardMessage += `${multiplierReward.toFixed(2).toLocaleString()} work multiplier to all members!\n`
        }
        if (passiveReward) {
            statRewardMessage += `${passiveReward.toLocaleString()} passive amount to all members!\n`
        }
        if (capacityReward) {
            statRewardMessage += `${capacityReward.toLocaleString()} bank capacity to all members!\n`
        }
        if (hasStatReward) {
            fields.push({
                name: `Stats Granted:`,
                value: `${statRewardMessage}`,
                inline: false,
            })
        }

        fields.push({
            name: `Success Chance:`,
            value: `${(successChance * 100).toFixed(2)}% chance`,
            inline: true,
        })

        let stringListOfMembers = ``;
        if (raidList.length == 0) {
            fields.push({
                name: 'Members In Raid:',
                value: 'None',
                inline: false,
            })
        } else {
            for (const [index, element] of raidList.entries()) {
                stringListOfMembers += `${element.username} - ${Math.round(element.raidShare * totalRaidReward).toLocaleString()} potatoes gained\n`
            }
            const listOfMembers = {
                name: `Members In Raid:`,
                value: `${stringListOfMembers}`,
                inline: false,
            };
            fields.push(listOfMembers);

            const gainOrLoss = totalRaidReward >= 0 ? 'Gained' : 'Lost'
            fields.push({
                name: `Total Potatoes ${gainOrLoss}:`,
                value: `${totalRaidReward.toLocaleString()} potatoes`,
                inline: false,
            })
        }

        if (mob.credit) {
            footerText = mob.credit;
        }
        const embed = new EmbedBuilder()
            .setTitle(`The Potato Kingdom encountered ${mob.name}!`)
            .setDescription(`${mob.description}`)
            .setColor(color)
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, mob, cooldownSkippedByCompanion = null, isBoostedMetalHit = false) {
        let fields = [], footerText = "Made by Beggar";

        fields.push({
            name: `Work Count:`,
            value: `${newWorkCount.toLocaleString()}`,
            inline: true,
        })
        const gainOrLoss = potatoesGained >= 0 ? 'Gained' : 'Lost'
        const gainPotatoesOrStarches = (mob.name == taroTrader.name || mob.name == goldenYam.name) ? 'Starches' : 'Potatoes';
        const isFailedMetal = potatoesGained == 0 && mob.name != sweetPotato.name;
        let color = potatoesGained >= 0 && !isFailedMetal  ? 'Green' : 'Red';
        fields.push({
            name: `${gainPotatoesOrStarches} ${gainOrLoss}:`,
            value: `${potatoesGained.toLocaleString()} ${gainPotatoesOrStarches.toLowerCase()}`,
            inline: true,
        })

        if (cooldownSkippedByCompanion) {
            fields.push(buildCooldownSkipField(cooldownSkippedByCompanion));
        }

        // A "boosted" Metal Potato hit — one that only landed because a companion perk
        // widened its odds — pays a reduced reward and grants no work-multiplier bump at
        // all (see workFactory.handleMetalPotato). That reduction has to actually show up
        // here or it's just an unexplained smaller number, same reasoning the Poison
        // Mitigation embed's own visibility field already established.
        if (isBoostedMetalHit) {
            fields.push({
                name: `⛏️ Prospector's Own Luck:`,
                value: `This strike only happened because of your companion's boosted odds — reduced haul, no Work Multiplier bump this time.`,
                inline: false,
            });
        }

        if (mob.credit) {
            footerText = mob.credit;
        }

        // Surfaces the hourly special-odds event (if one's live) right on the result
        // embed, since the announcement in chat is easy to miss/scroll past and there
        // was previously no way to check "is something boosted right now?".
        const activeEvent = eventFactory.getCurrentEvent();
        if (activeEvent) {
            footerText += ` • 🎉 ${activeEvent}`;
        }

        let sweetPotatoReward = '';
        if (mob.name == sweetPotato.name) {
            switch (potatoesGained) {
                case 0:
                    sweetPotatoReward = ' (Work Multiplier)';
                    break;
                case 1:
                    sweetPotatoReward = ' (Passive Amount)';
                    break;
                case 2:
                    sweetPotatoReward = ' (Bank Capacity)';
                    break;
            }
        }

        // TODO: Remove in future this is mostly for memes
        let mobDescription = '';
        if (userDisplayName.includes('Charizard') && mob.name == sweetPotato.name) {
            mobDescription = 'Your lips curl up in disgust as you see a sweet potato appear in front of you. It begs and pleads, but it fails to convince you to spare its life in exchange for buffing one of your stats. You decide to brutally murder the sweet potato and forcefully take the stats for yourself anyway. Check your profile!';
        } else {
            mobDescription = mob.description;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} encountered a(n) ${mob.name}!`)
            .setDescription(`${mobDescription}${sweetPotatoReward}`)
            .setColor(color)
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Poison Potato doesn't fit createWorkEmbed's single "potatoes gained/lost" field —
    // the whole point of PoisonMitigation (see workFactory.js) is that repeat hits get
    // progressively less painful for everyone else, and Guinea Pig's own hits get
    // progressively MORE lucrative instead — both need to actually be visible on the
    // embed or they're just a quieter cooldown/bigger number nobody understands. result:
    // { potatoesGained, immune, mitigationInfo } from workFactory.handlePoisonPotato —
    // mitigationInfo is always populated now (Guinea Pig's own hits still update the
    // shared weekly counter): { reduction, lockoutSeconds, hitNumberThisWeek,
    // milestoneJustReached, rebatePercent, escalationMultiplier }, rebatePercent/
    // escalationMultiplier only non-null when immune.
    createPoisonPotatoEmbed(userDisplayName, newWorkCount, result, mob, cooldownSkippedByCompanion = null) {
        const { potatoesGained, immune, mitigationInfo } = result;
        let fields = [{
            name: `Work Count:`,
            value: `${newWorkCount.toLocaleString()}`,
            inline: true,
        }];

        const gainOrLoss = potatoesGained >= 0 ? 'Gained' : 'Lost';
        fields.push({
            name: `Potatoes ${gainOrLoss}:`,
            value: `${potatoesGained.toLocaleString()} potatoes`,
            inline: true,
        });

        if (mitigationInfo) {
            const { reduction, lockoutSeconds, hitNumberThisWeek, milestoneJustReached, rebatePercent, escalationMultiplier } = mitigationInfo;

            if (immune) {
                // Guinea Pig's own rebate is deliberately NOT built off the mitigated
                // (softer) loss — see handlePoisonPotato's own comment — so this shows
                // the escalation it's actually getting instead of the shared reduction
                // number, which doesn't apply to this branch at all.
                const escalationContext = escalationMultiplier > 1
                    ? ` (${escalationMultiplier.toFixed(2)}× — hit #${hitNumberThisWeek} this week)`
                    : ` (1st Poison hit this week)`;
                fields.push({
                    name: `Guinea Pig:`,
                    value: `Turned ${(rebatePercent * 100).toFixed(1)}% of the raw loss into a gain instead${escalationContext} — no cooldown lockout.`,
                    inline: true,
                });
            } else {
                const hitContext = reduction > 0
                    ? `hit #${hitNumberThisWeek} this week — ${(reduction * 100).toFixed(0)}% softer`
                    : `hit #${hitNumberThisWeek} this week`;
                fields.push({
                    name: `Cooldown:`,
                    value: `${convertSecondstoMinutes(lockoutSeconds)} lockout (${hitContext})`,
                    inline: true,
                });
            }

            if (milestoneJustReached) {
                fields.push({
                    name: `🏅 Toxic Tolerance:`,
                    value: `10 Poison hits in one week — the loss and lockout are cut way down for the rest of this week!`,
                    inline: false,
                });
            }
        }

        if (cooldownSkippedByCompanion) {
            fields.push(buildCooldownSkipField(cooldownSkippedByCompanion));
        }

        let footerText = "Made by Beggar";
        const activeEvent = eventFactory.getCurrentEvent();
        if (activeEvent) {
            footerText += ` • 🎉 ${activeEvent}`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} encountered a(n) ${mob.name}!`)
            .setDescription(mob.description)
            .setColor(potatoesGained >= 0 ? 'Green' : 'Red')
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // result: { isNew, companion, potatoesGained } from workFactory.handleCompanionEncounter.
    // A brand-new companion shows its perk and a reminder to equip it via /companion (won,
    // not auto-equipped — equipping stays a deliberate choice); a duplicate pull shows
    // the consolation potato payout instead, same "Gained" framing as every other
    // potato-reward encounter.
    createCompanionEncounterEmbed(userDisplayName, newWorkCount, result, cooldownSkippedByCompanion = null) {
        const { isNew, companion, potatoesGained, workCountBefore, workCountAfter } = result;
        let fields = [{
            name: `Work Count:`,
            value: `${newWorkCount.toLocaleString()}`,
            inline: true,
        }];

        let description, footerText = "Made by Beggar";
        if (isNew) {
            fields.push({
                name: `Perk:`,
                value: formatCompanionPerks(companion),
                inline: true,
            });
            description = `${companion.description}\n\nRun \`/companion\` and use its equip button to make ${companion.name} your active companion!`;
        } else {
            fields.push({
                name: `Potatoes Gained:`,
                value: `${potatoesGained.toLocaleString()} potatoes`,
                inline: true,
            });
            // The duplicate's own workCount also bumps (see workFactory.js's
            // handleCompanionEncounter) — surfaced explicitly since "consolation bag of
            // potatoes" used to read as the *only* thing a duplicate pull did.
            const levelBefore = companionFactory.getCompanionLevel(workCountBefore);
            const levelAfter = companionFactory.getCompanionLevel(workCountAfter);
            fields.push({
                name: `${companion.name} Progress:`,
                value: levelAfter > levelBefore
                    ? `${workCountBefore.toLocaleString()} → ${workCountAfter.toLocaleString()} (+${(workCountAfter - workCountBefore).toLocaleString()})\nLv. ${levelBefore} → Lv. ${levelAfter}! 🎉`
                    : `${workCountBefore.toLocaleString()} → ${workCountAfter.toLocaleString()} (+${(workCountAfter - workCountBefore).toLocaleString()})`,
                inline: true,
            });
            description = `${companion.description}\n\nYou already have a ${companion.name} — it gains experience from the encounter and hands over a consolation bag of potatoes too.`;
        }

        if (cooldownSkippedByCompanion) {
            fields.push(buildCooldownSkipField(cooldownSkippedByCompanion));
        }

        const activeEvent = eventFactory.getCurrentEvent();
        if (activeEvent) {
            footerText += ` • 🎉 ${activeEvent}`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} encountered a wandering companion: ${companion.name}! (${COMPANION_RARITY_LABEL[companion.rarity]})`)
            .setDescription(description)
            .setColor(COMPANION_RARITY_COLOR[companion.rarity])
            .setThumbnail(companion.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // The explicit "welcome back" moment on /companion-scavenge-collect — same celebratory-
    // embed family as createPoisonPotatoEmbed/achievement unlocks, so a scavenge's reward
    // reads as a real moment rather than a silently-absorbed stat change (see
    // systems/companions.md#scavenging). workCountBefore/workCountAfter (that companion's
    // own owned-entry workCount, pre/post this reward) drive the same before/after
    // progress-to-next-level numbers /companion's list already surfaces via
    // companionFactory.getNextLevelThreshold, so a level-up crossed by this one reward is
    // visible right here instead of only showing up the next time /companion is checked.
    // multiplierTier ('normal'/'great'/'incredible', from companionFactory.resolveScavengeReward's
    // WORK_COUNT_MULTIPLIER_TIERS roll) only changes anything visually on the two bonus
    // tiers — a plain 'normal' result looks exactly like this embed always has.
    createScavengeReturnEmbed(userDisplayName, companion, workCountBefore, workCountAfter, starchesGained, multiplierTier = 'normal') {
        const levelBefore = companionFactory.getCompanionLevel(workCountBefore);
        const levelAfter = companionFactory.getCompanionLevel(workCountAfter);
        const nextThreshold = companionFactory.getNextLevelThreshold(workCountAfter);
        const progress = nextThreshold
            ? `${workCountAfter.toLocaleString()} / ${nextThreshold.workCountRequired.toLocaleString()} /work calls to Lv. ${nextThreshold.level}`
            : `${workCountAfter.toLocaleString()} /work calls — max level`;

        const fields = [
            {
                name: `Work Count:`,
                value: `${workCountBefore.toLocaleString()} → ${workCountAfter.toLocaleString()} (+${(workCountAfter - workCountBefore).toLocaleString()})`,
                inline: true,
            },
            {
                name: `Starches Gained:`,
                value: `${starchesGained.toLocaleString()} starches`,
                inline: true,
            },
            {
                name: `Level:`,
                value: levelAfter > levelBefore
                    ? `Lv. ${levelBefore} → Lv. ${levelAfter}! 🎉\n${progress}`
                    : `Lv. ${levelAfter}\n${progress}`,
                inline: false,
            }
        ];

        const tierCallouts = {
            great: '🎉 Great haul! (1.5x) — ',
            incredible: '💥 Incredible haul! (3x) — ',
        };

        const embed = new EmbedBuilder()
            .setTitle(`${tierCallouts[multiplierTier] || ''}${userDisplayName}, ${companion.name} is back from scavenging!`)
            .setDescription(companion.scavengeFlavor || companion.description)
            .setColor(COMPANION_RARITY_COLOR[companion.rarity])
            .setThumbnail(companion.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Ancient Potato's outcome branches like Metal Potato's success/failure split, but
    // on regrade-vs-potato-reward instead — doesn't fit createWorkEmbed's single
    // "potatoes gained" number, same reason createCompanionEncounterEmbed is its own
    // function rather than shoehorned in there. result: { potatoesGained,
    // regradedStatName, regradeIncrease, shopUpgradedStatName, shopUpgradeIncrease,
    // guildRaidReady } from workFactory.js's handleAncientPotato — exactly one of
    // regradedStatName/shopUpgradedStatName/potatoesGained>0 is set per roll.
    createAncientPotatoEmbed(userDisplayName, newWorkCount, result, ancientPotato, cooldownSkippedByCompanion = null) {
        const { potatoesGained, regradedStatName, regradeIncrease, shopUpgradedStatName, shopUpgradeIncrease, guildRaidReady } = result;
        let fields = [{
            name: `Work Count:`,
            value: `${newWorkCount.toLocaleString()}`,
            inline: true,
        }];

        if (regradedStatName) {
            fields.push({
                name: `Permanent Bonus:`,
                value: `+${regradeIncrease.toLocaleString()} ${regradedStatName}`,
                inline: true,
            });
        } else if (shopUpgradedStatName) {
            fields.push({
                name: `Free Shop Upgrade:`,
                value: `+${shopUpgradeIncrease.toLocaleString()} ${shopUpgradedStatName}`,
                inline: true,
            });
        } else {
            fields.push({
                name: `Potatoes Gained:`,
                value: `${potatoesGained.toLocaleString()} potatoes`,
                inline: true,
            });
        }

        if (guildRaidReady) {
            fields.push({
                name: `Guild Raid Cooldown:`,
                value: `Ready now!`,
                inline: true,
            });
        }

        if (cooldownSkippedByCompanion) {
            fields.push(buildCooldownSkipField(cooldownSkippedByCompanion));
        }

        let footerText = "Made by Beggar";
        const activeEvent = eventFactory.getCurrentEvent();
        if (activeEvent) {
            footerText += ` • 🎉 ${activeEvent}`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} unearthed an Ancient Potato!`)
            .setDescription(ancientPotato.description)
            .setColor("Gold")
            .setThumbnail(ancientPotato.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Read-only preview, mirrors /current-raid's own shape — current Mercenary Rank +
    // wins-to-next-rank, which tiers are unlocked, a live success-chance preview per
    // unlocked tier, and bountyTimer remaining. `tiers` is precomputed by bounty-board.js
    // (each { tier, unlocked, successChance, unlocksAtRank }).
    createBountyBoardEmbed(userDisplayName, rankInfo, tiers, cooldownRemainingSeconds) {
        const title = MERCENARY_RANK_TITLES[rankInfo.rank] || `Rank ${rankInfo.rank}`;
        const rankLine = rankInfo.winsToNextRank !== null
            ? `Rank ${rankInfo.rank} — ${title} (${rankInfo.winsToNextRank.toLocaleString()} win${rankInfo.winsToNextRank === 1 ? '' : 's'} to Rank ${rankInfo.rank + 1})`
            : `Rank ${rankInfo.rank} — ${title} (max rank)`;

        const fields = tiers.map(t => ({
            name: `Tier ${t.tier}${t.unlocked ? '' : ' 🔒'}`,
            value: t.unlocked
                ? `${(t.successChance * 100).toFixed(1)}% success chance`
                : `Unlocks at Rank ${t.unlocksAtRank}`,
            inline: true,
        }));

        fields.push({
            name: 'Bounty Cooldown:',
            value: cooldownRemainingSeconds > 0 ? `Ready in ${convertSecondstoMinutes(cooldownRemainingSeconds)}` : 'Ready now!',
            inline: false,
        });

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Bounty Board`)
            .setDescription(rankLine)
            .setColor("Yellow")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Win/loss + stat-reward + Yukon callouts, same "own dedicated embed for a
    // multi-outcome resolution" precedent createPoisonPotatoEmbed/
    // createCompanionEncounterEmbed already set. `result` is
    // mercenaryFactory.resolveBountyAttempt's own return shape; `yukonAward` is
    // mercenaryFactory.resolveYukonAward's return shape, or null if Yukon didn't hit.
    createBountyResultEmbed(userDisplayName, result, yukonAward = null) {
        const { tier, won, successChance, scenario, rankInfo, currency, rewardAmount, penaltyAmount, statReward } = result;
        const color = won ? 'Green' : 'Red';
        const fields = [];

        fields.push({
            name: 'Result:',
            value: won ? scenario.winFlavor : scenario.loseFlavor,
            inline: false,
        });

        fields.push({
            name: 'Success Chance:',
            value: `${(successChance * 100).toFixed(2)}%`,
            inline: true,
        });

        if (won) {
            const currencyLabel = currency === 'potato' ? 'Potatoes' : 'Starches';
            fields.push({
                name: `${currencyLabel} Gained:`,
                value: `${rewardAmount.toLocaleString()} ${currencyLabel.toLowerCase()}`,
                inline: true,
            });
        } else {
            fields.push({
                name: 'Potatoes Lost:',
                value: `${penaltyAmount.toLocaleString()} potatoes`,
                inline: true,
            });
        }

        if (statReward) {
            const statLabels = { workMultiplierAmount: 'Work Multiplier', passiveAmount: 'Passive Income', bankCapacity: 'Bank Capacity' };
            const statText = statReward.map(s => `+${s.amount.toLocaleString()} ${statLabels[s.type]}`).join('\n');
            fields.push({
                name: '🏅 Bounty Bonus — Permanent Stat Reward!',
                value: statText,
                inline: false,
            });
        }

        if (yukonAward) {
            fields.push({
                name: yukonAward.isNew ? '🤠 A new companion joins you!' : '🤠 Yukon, the Highwayman (already owned)',
                value: yukonAward.isNew
                    ? `You've earned the loyalty of Yukon, the Highwayman — a Legendary companion found only through Mercenary Bounties!`
                    : `You already have Yukon's loyalty — instead, you find ${yukonAward.potatoesGained.toLocaleString()} potatoes among their haul.`,
                inline: false,
            });
        }

        fields.push({
            name: 'Mercenary Rank:',
            value: `Rank ${rankInfo.rank}${won ? ' (win recorded!)' : ''}`,
            inline: true,
        });

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} takes on ${scenario.name} — Tier ${tier}`)
            .setDescription(won ? 'Success!' : 'Failed.')
            .setColor(color)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // /rob-npc's own result embed — whiff-only failure (no loss), so there's no
    // "Potatoes Lost" branch the way createBountyResultEmbed needs one. `result` is
    // mercenaryFactory.resolveNpcRob's own return shape.
    createRobNpcResultEmbed(userDisplayName, result) {
        const { won, successChance, amount, rankInfo } = result;
        const color = won ? 'Green' : 'Grey';
        const fields = [
            { name: 'Chance:', value: `${(successChance * 100).toFixed(2)}%`, inline: true },
            { name: 'Mercenary Rank:', value: `Rank ${rankInfo.rank}`, inline: true },
        ];
        if (won) {
            fields.push({ name: 'Potatoes Gained:', value: `${amount.toLocaleString()} potatoes`, inline: false });
        }

        const embed = new EmbedBuilder()
            .setTitle(won ? `${userDisplayName} pulls off a heist!` : `${userDisplayName}'s heist falls through`)
            .setDescription(won
                ? `You ambush a passing supply wagon and make off clean before anyone's the wiser.`
                : `You case the road for an easy mark, but nothing turns up this time — no harm done, no cooldown penalty beyond the usual wait.`)
            .setColor(color)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Rival Bounty Hunters — /notoriety's read-only preview, mirrors createBountyBoardEmbed's
    // own shape (a progress line plus a Ready-now/locked field). `rankInfo` is
    // mercenaryFactory.getMercenaryRankInfo's own return shape; `confrontable` is precomputed
    // by notoriety.js (Rank 2+ AND notoriety >= threshold).
    createNotorietyEmbed(userDisplayName, notoriety, threshold, rankInfo, confrontable, rivalConfrontationWinCount) {
        const title = MERCENARY_RANK_TITLES[rankInfo.rank] || `Rank ${rankInfo.rank}`;
        const rankLine = `Rank ${rankInfo.rank} — ${title}`;

        const fields = [
            {
                name: 'Notoriety:',
                value: `${notoriety.toLocaleString()} / ${threshold.toLocaleString()}`,
                inline: true,
            },
            {
                name: 'Mercenary Rank Gate:',
                value: rankInfo.rank >= 2 ? 'Met (Rank 2+)' : `Not met — Rank 2 required (currently Rank ${rankInfo.rank})`,
                inline: true,
            },
        ];

        fields.push({
            name: 'Confrontation:',
            value: confrontable ? 'Ready now! Run /confront-rival — which scenario you get is a surprise.' : 'Not available yet.',
            inline: false,
        });

        fields.push({
            name: 'Rivals Defeated (lifetime):',
            value: `${rivalConfrontationWinCount.toLocaleString()}`,
            inline: true,
        });

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Notoriety`)
            .setDescription(rankLine)
            .setColor(confrontable ? 'Green' : 'Yellow')
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Rival Bounty Hunters — /confront-rival's result embed, mirrors createBountyResultEmbed's
    // win/loss + stat-reward-callout shape, minus the currency/scenario-flavor split Bounty
    // needs (Rival always pays potatoes and always grants the guaranteed stat bump on a win,
    // so there's no conditional currency branch or rare-roll callout). `result` is
    // mercenaryFactory.resolveRivalConfrontation's own return shape.
    createRivalConfrontationResultEmbed(userDisplayName, result) {
        const { scenario, won, successChance, rival, rankInfo, rewardAmount, penaltyAmount, statBump } = result;
        const color = won ? 'Green' : 'Red';
        const scenarioLabel = scenario.charAt(0).toUpperCase() + scenario.slice(1);
        const fields = [];

        fields.push({
            name: 'Result:',
            value: won ? rival.winFlavor : rival.loseFlavor,
            inline: false,
        });

        fields.push({
            name: 'Success Chance:',
            value: `${(successChance * 100).toFixed(2)}%`,
            inline: true,
        });

        if (won) {
            fields.push({
                name: 'Potatoes Gained:',
                value: `${rewardAmount.toLocaleString()} potatoes`,
                inline: true,
            });
        } else {
            fields.push({
                name: 'Potatoes Lost:',
                value: `${penaltyAmount.toLocaleString()} potatoes`,
                inline: true,
            });
        }

        if (won && statBump) {
            const statLabels = { workMultiplierAmount: 'Work Multiplier', passiveAmount: 'Passive Income', bankCapacity: 'Bank Capacity' };
            const statText = statBump.map(s => `+${s.amount.toLocaleString()} ${statLabels[s.type]}`).join('\n');
            fields.push({
                name: '🏅 Permanent Stat Reward',
                value: statText,
                inline: false,
            });
        }

        fields.push({
            name: 'Notoriety:',
            value: 'Reset to 0',
            inline: true,
        });

        fields.push({
            name: 'Mercenary Rank:',
            value: `Rank ${rankInfo.rank}`,
            inline: true,
        });

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} confronts ${rival.name} — ${scenarioLabel} Scenario`)
            .setDescription(won ? 'Success!' : 'Failed.')
            .setColor(color)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Landing page for /help — lists every topic (pulled from HelpTopics so it can never
    // drift from the choices the slash command itself offers).
    createHelpOverviewEmbed() {
        const overview = HelpTopics.find(topic => topic.id === "overview");
        const topicList = HelpTopics
            .filter(topic => topic.id !== "overview")
            .map(topic => `**${topic.label}** (\`${topic.id}\`) — ${topic.description}`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle("Leash Gromp — Help")
            .setDescription(`${overview.content}\n\n**Topics:**\n${topicList}`)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // Renders any HelpTopics entry that carries static `content` — i.e. every topic
    // except "companions" and "commands", which are generated live instead (see
    // createHelpCompanionsEmbed/createHelpCommandsEmbed) so they can't drift from what's
    // actually shipped.
    createHelpTopicEmbed(topicId) {
        const topic = HelpTopics.find(t => t.id === topicId);
        const embed = new EmbedBuilder()
            .setTitle(`Leash Gromp — ${topic.label}`)
            .setDescription(topic.content)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // Full companion roster grouped by rarity, generated straight off the Companions
    // array so it can never fall out of sync with what /companion actually offers.
    createHelpCompanionsEmbed() {
        const rarityOrder = [CompanionRarity.COMMON, CompanionRarity.RARE, CompanionRarity.LEGENDARY, CompanionRarity.MYTHIC];
        const fields = rarityOrder.map(rarity => {
            const companionsOfRarity = Companions.filter(c => c.rarity === rarity);
            return {
                name: `${COMPANION_RARITY_LABEL[rarity]} (${companionsOfRarity.length})`,
                value: companionsOfRarity.map(c => `**${c.name}** — ${formatCompanionPerks(c)}`).join('\n'),
                inline: false,
            };
        });

        const embed = new EmbedBuilder()
            .setTitle("Leash Gromp — Companions")
            .setDescription(`${Companions.length} companions to find. Found through the "Wandering Companion" /work encounter, or bought directly off /companion-market — except Yukon, the Highwayman, who's found only through a winning \`/take-bounty\` roll (see /help topic:mercenary). Only one can be active at a time — view your own and equip one with \`/companion\`.\n\nEvery companion can level up (to a cap of 10) just by staying equipped through your /work calls — each level makes its own perk stronger. A duplicate pull of one you already own gives it a boost too. Selling a leveled companion on the market carries its level to the buyer, so it's worth more than a fresh one. Perks below are shown at level 1 (base); use \`/companion\` to see your own at their real level.`)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // categorizedCommands: { categoryLabel: [commandName, ...] }, gathered live by help.js
    // off the actual command files (skipping deleted/devOnly ones) so this can't list a
    // command that's been removed or hide one that's been added.
    createHelpCommandsEmbed(categorizedCommands) {
        const fields = Object.entries(categorizedCommands).map(([category, commandNames]) => ({
            name: category,
            value: commandNames.map(name => `\`/${name}\``).join(', '),
            inline: false,
        }));

        const embed = new EmbedBuilder()
            .setTitle("Leash Gromp — Command List")
            .setDescription("Every available command, grouped by category. Discord's own slash command menu shows a short description for each — start typing `/` to browse.")
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // pageItems: full companion objects (owned ids already resolved to roster entries),
    // each carrying its own workCount (see companion.js) for the level shown here. Paginated
    // exactly like createAchievementsPageEmbed/createQuestsPageEmbed. scavenging (optional):
    // the live userDetails.companions.scavenging record ({ companionId, rarity, returnsAt })
    // or null — powers the third status branch below (see systems/companions.md#scavenging).
    createCompanionListEmbed(userDisplayName, pageItems, pageIndex, totalPages, activeId, totalOwned, scavenging = null, canEquip = true) {
        const fields = pageItems.length > 0 ? pageItems.map(companion => {
            let status;
            if (companion.id === activeId) {
                status = '✅ Active';
            } else if (scavenging && companion.id === scavenging.companionId) {
                const remainingSeconds = Math.max(0, Math.ceil((scavenging.returnsAt - Date.now()) / 1000));
                status = remainingSeconds > 0
                    ? `🧭 Scavenging — returns in ${convertSecondstoMinutes(remainingSeconds)}`
                    : `🧭 Scavenging — ready! Use /companion-scavenge-collect`;
            } else {
                status = companion.id;
            }
            const workCount = companion.workCount || 0;
            const level = companionFactory.getCompanionLevel(workCount);
            const nextThreshold = companionFactory.getNextLevelThreshold(workCount);
            const progress = nextThreshold
                ? `${workCount.toLocaleString()} / ${nextThreshold.workCountRequired.toLocaleString()} /work calls to Lv. ${nextThreshold.level}`
                : `${workCount.toLocaleString()} /work calls — max level`;
            // One-time cosmetic tag (Option A3 of the 2026-08-23 Scavenging brainstorm) —
            // hasScavenged is set uniformly on any scavenge return (see
            // companionFactory.resolveScavengeReward), but only ever rendered for
            // Legendary/Mythic companions, so the rarity-gating lives entirely here rather
            // than on the write side.
            const isUpperRarity = companion.rarity === CompanionRarity.LEGENDARY || companion.rarity === CompanionRarity.MYTHIC;
            const scoutTag = (companion.hasScavenged && isUpperRarity) ? ' 🗺️ Seasoned Scout' : '';
            return {
                name: `${companion.name} (${COMPANION_RARITY_LABEL[companion.rarity]}) — Lv. ${level}${scoutTag}`,
                value: `${formatCompanionPerks(companion, level)}\n${progress}\n${status}`,
                inline: false,
            };
        }) : [{ name: 'No companions yet', value: 'Keep working — Wandering Companion encounters can happen on any /work!', inline: false }];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Companions`)
            .setDescription(`${totalOwned} / ${Companions.length} collected\nPage ${pageIndex + 1} / ${totalPages}${canEquip ? `\n\nUse the buttons below to equip a companion shown on this page — click your active companion's own button again to unequip it.` : ''}`)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // pageItems: { listing, companion } pairs for this page (listing from the shared
    // companion_market doc, companion resolved from the roster). listing.workCount is
    // the seller's level at listing time (companionMarketFactory.buildListing) — shown
    // here since a leveled companion is worth more than a fresh one. Paginated exactly
    // like createCompanionListEmbed. Each field name is prefixed with its 1-indexed
    // position on this page ("1) ...", "2) ...") so the numbered buy buttons below the
    // embed (companionMarket.js, "1"-"5") line up unambiguously with the listing above
    // them — buttons carry no price/name of their own, just the number.
    createCompanionMarketEmbed(pageItems, pageIndex, totalPages, totalListings) {
        const fields = pageItems.length > 0 ? pageItems.map(({ listing, companion }, index) => {
            const level = companionFactory.getCompanionLevel(listing.workCount);
            return {
                name: `${index + 1}) ${companion.name} (${COMPANION_RARITY_LABEL[companion.rarity]}) — Lv. ${level} — ${listing.price.toLocaleString()} potatoes`,
                value: `${formatCompanionPerks(companion, level)}\nSeller: ${listing.sellerUsername}`,
                inline: false,
            };
        }) : [{ name: 'No active listings', value: 'Nobody has listed a companion for sale right now.', inline: false }];

        const embed = new EmbedBuilder()
            .setTitle(`Companion Market`)
            .setDescription(`${totalListings} active listing${totalListings === 1 ? '' : 's'}\nPage ${pageIndex + 1} / ${totalPages}\n\nUse the numbered buttons below to buy a listing on this page.`)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // The invoking user's OWN active listings, shown to power /companion-cancel's
    // button-driven flow — same pageItems shape ({ listing, companion } pairs) and
    // pagination as createCompanionMarketEmbed, but without the numbered buy-button
    // prefixing (cancel buttons are labeled with the companion's own name instead, see
    // companionCancel.js, since there's no separate "buy" numbering scheme to match here).
    createCompanionCancelEmbed(userDisplayName, pageItems, pageIndex, totalPages, totalListings) {
        const fields = pageItems.length > 0 ? pageItems.map(({ listing, companion }) => {
            const level = companionFactory.getCompanionLevel(listing.workCount);
            return {
                name: `${companion.name} (${COMPANION_RARITY_LABEL[companion.rarity]}) — Lv. ${level} — ${listing.price.toLocaleString()} potatoes`,
                value: `${formatCompanionPerks(companion, level)}\nListed ${new Date(listing.listedAt).toLocaleDateString()}`,
                inline: false,
            };
        }) : [{ name: 'No active listings', value: "You don't have any companions listed for sale right now.", inline: false }];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Market Listings`)
            .setDescription(`${totalListings} active listing${totalListings === 1 ? '' : 's'}\nPage ${pageIndex + 1} / ${totalPages}\n\nUse the buttons below to cancel a listing on this page.`)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createBirthdayEmbed(sortedBirthdays) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        let userList = []
        for (const [index, element] of sortedBirthdays.entries()) {
            if (index < 5) {
                const user = {
                    name: `${index + 1}) ${element.birthday}`,
                    value: `${element.username}`,
                    inline: false,
                };
                userList.push(user);
            } else {
                break;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`Birthday List`)
            .setDescription(`This is the next 5 birthdays for the server`)
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createCoinflipEmbed(result, headsCount, tailsCount, userPotatoes, amount) {
        let fields = [];
        const potatoResultLabel = amount >= 0 ? 'Gained' : 'Lost';
        const color = amount >= 0 ? 'Green' : 'Red';
        const avatarUrl = result == 'heads'
            ? "https://cdn.discordapp.com/emojis/656933460484685873.webp?size=96&quality=lossless"
            : "https://cdn.discordapp.com/attachments/533073599435636739/1199161990787104878/Miles_22Tails22_Prower_Sonic_and_All-Stars_Racing_Transformed.png?ex=65c189a1&is=65af14a1&hm=f7d3ad2b55689f5fe5a833322af1e37239039d0eeec3ea55aa45219ff6a30d5d&"

        fields.push({
            name: `Heads Count:`,
            value: `${headsCount.toLocaleString()} heads`,
            inline: true,
        })
        fields.push({
            name: `Tails Count:`,
            value: `${tailsCount.toLocaleString()} tails`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        fields.push({
            name: `Potatoes ${potatoResultLabel}:`,
            value: `${amount.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`Coinflip result was... ${result}!`)
            .setDescription(`Displayed below are your current potatoes, potatoes gained or lost, and coinflip stats.`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Shown before the roll happens so the player can back out — previously the odds
    // and stakes were only ever revealed in the same embed as the already-decided result.
    createRobPreviewEmbed(userDisplayName, userId, userAvatar, targetUserDisplayName, chanceToRob, minGain, maxGain, minFine, maxFine) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const fields = [
            {
                name: `Chance to Rob:`,
                value: `${chanceToRob}%`,
                inline: true,
            },
            {
                name: '\n',
                value: '\n',
                inline: false
            },
            {
                name: `If Successful:`,
                value: `+${minGain.toLocaleString()} to ${maxGain.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `If Caught:`,
                value: `-${minFine.toLocaleString()} to ${maxFine.toLocaleString()} potatoes`,
                inline: true,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}, rob ${targetUserDisplayName}?`)
            .setDescription(`Confirm to make the attempt — either outcome puts you on cooldown, and getting caught also extends your next /work.`)
            .setColor("Yellow")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRobCancelledEmbed(userDisplayName, userId, userAvatar, targetUserDisplayName) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} backed out`)
            .setDescription(`No attempt was made on ${targetUserDisplayName} — no cooldown applied, try again whenever.`)
            .setColor("Grey")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    createRebirthNotEligibleEmbed(userDisplayName, userId, userAvatar, missing) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} isn't ready to rebirth yet`)
            .setDescription(`Rebirth requires every base shop tier AND every regrade track fully maxed out. Still needed:\n${missing.map(m => `❌ ${m}`).join('\n')}`)
            .setColor("Grey")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // preview: previewRebirthBonus(userDetails)'s output — computed by the caller so the
    // exact same numbers this embed shows are what committing will actually change.
    createRebirthPreviewEmbed(userDisplayName, userId, userAvatar, preview) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const currentText = `${(preview.currentPercent * 100).toFixed(1)}%`;
        const nextText = `${(preview.nextPercent * 100).toFixed(1)}%`;
        const fields = [
            {
                name: `Resets to zero:`,
                value: `Potatoes, banked potatoes, all 3 regrade tracks, and the shop-purchased portion of Work Multiplier / Passive Income / Bank Capacity / Starch Capacity`,
                inline: false,
            },
            {
                name: `Kept:`,
                value: `Achievements, personal records, starches, and every permanent buff you've earned (Sweet Potato, Metal Potato, raids, quests)`,
                inline: false,
            },
            {
                name: `Permanent gain:`,
                value: `Your live rebirth bonus goes from ${currentText} to ${nextText} of your current Work Multiplier / Passive Income / Bank Capacity, always — this isn't a one-time amount, it keeps applying to whatever those stats grow to afterward, forever, until your next rebirth raises it again.`,
                inline: false,
            },
            {
                name: `This will be rebirth #:`,
                value: `${preview.rebirthNumber}`,
                inline: true,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}, rebirth? This cannot be undone.`)
            .setDescription(`You're maxed out on every shop tier and every regrade track. Confirm to reset and gain a permanent boost — decline and nothing changes.`)
            .setColor("Yellow")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRebirthCancelledEmbed(userDisplayName, userId, userAvatar) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} backed out`)
            .setDescription(`Nothing was reset — your progress is untouched, rebirth whenever you're ready.`)
            .setColor("Grey")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // userDetails: the merged post-rebirth record (needs both rebirthCount and
    // companions to compute the live bonus) — shows the true effective stat, not just
    // the raw base+sweetPotatoBuffs computeRebirthState wrote, since the rebirth bonus
    // no longer gets baked into those fields at all.
    createRebirthCompleteEmbed(userDisplayName, userId, userAvatar, userDetails) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const rebirthPercent = rebirthFactory.getLiveRebirthPercent(userDetails);
        const effectiveWorkMulti = userDetails.workMultiplierAmount * (1 + rebirthPercent);
        const effectivePassive = Math.round(userDetails.passiveAmount * (1 + rebirthPercent));
        const effectiveBank = Math.round(userDetails.bankCapacity * (1 + rebirthPercent));
        const fields = [
            {
                name: `Rebirth #:`,
                value: `${userDetails.rebirthCount}`,
                inline: true,
            },
            {
                name: `Live rebirth bonus:`,
                value: `+${(rebirthPercent * 100).toFixed(1)}%`,
                inline: true,
            },
            {
                name: `New Work Multiplier:`,
                value: `${effectiveWorkMulti.toFixed(2)}x`,
                inline: true,
            },
            {
                name: `New Passive Income:`,
                value: `${effectivePassive.toLocaleString()} potatoes/day`,
                inline: true,
            },
            {
                name: `New Bank Capacity:`,
                value: `${effectiveBank.toLocaleString()} potatoes`,
                inline: true,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} has been reborn!`)
            .setDescription(`Potatoes, bank, shops, and regrades are back to zero — but your permanent buffs, achievements, records, and starches came with you, plus a bigger live rebirth bonus applying to everything you rebuild from here.`)
            .setColor("Purple")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRobEmbed(userDisplayName, userId, userAvatar, robOrFineAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, chanceToRob) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        let fields = [];
        const robResultLabel = robOrFineAmount > 0 ? 'successfully robbed' : 'failed to rob';
        const potatoResultLabel = robOrFineAmount > 0 ? 'Gained' : 'Lost';
        const color = robOrFineAmount > 0 ? 'Green' : 'Red';

        fields.push({
            name: `Chance to Rob:`,
            value: `${chanceToRob}%`,
            inline: true,
        })
        fields.push({
            name: `Target's Potatoes:`,
            value: `${targetUserPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        fields.push({
            name: `Potatoes ${potatoResultLabel}:`,
            value: `${robOrFineAmount.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} ${robResultLabel} ${targetUserDisplayName}!`)
            .setDescription(`Displayed below are your chances to rob, current potatoes, target's potatoes, and how many potatoes were gained or lost.`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createGiveEmbed(userDisplayName, userId, userAvatar, currencyLabel, amount, taxAmount, receivedAmount, userBalance, targetUserDisplayName, targetUserBalance) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const currencyLower = currencyLabel.toLowerCase();
        let fields = [];

        fields.push({
            name: `Current ${currencyLabel}:`,
            value: `${userBalance.toLocaleString()} ${currencyLower}`,
            inline: true,
        })
        fields.push({
            name: `Target's ${currencyLabel}:`,
            value: `${targetUserBalance.toLocaleString()} ${currencyLower}`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        fields.push({
            name: `${currencyLabel} Given:`,
            value: `${amount.toLocaleString()} sent — ${receivedAmount.toLocaleString()} received (-${taxAmount.toLocaleString()} tax)`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} gives ${currencyLower} to ${targetUserDisplayName}!`)
            .setDescription(`Displayed below are your current ${currencyLower}, your target's ${currencyLower}, and how many ${currencyLower} you gave.`)
            .setColor("Green")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Shown when /bank is run with no amount, offering quick percentage buttons instead
    // of requiring a typed number.
    createBankAmountPickerEmbed(userDisplayName, userId, userAvatar, action, userPotatoes, userBankStored, userBankCapacity) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const available = action === 'deposit' ? userPotatoes : userBankStored;
        const availableLabel = action === 'deposit' ? 'Liquid Potatoes' : 'Banked Potatoes';

        const fields = [
            {
                name: `${availableLabel}:`,
                value: `${available.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `Bank Capacity:`,
                value: formatBankCapacityField(userBankStored, userBankCapacity),
                inline: false,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`🏦 ${userDisplayName}, how much do you want to ${action}?`)
            .setDescription(`Pick a quick amount below, or run \`/bank\` again with a specific number.`)
            .setColor("Blue")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createBankEmbed(userDisplayName, userId, userAvatar, action, netAmount, feeAmount, userPotatoes, userBankStored, userBankCapacity) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const actionLabel = action === 'deposit' ? 'Deposited' : 'Withdrew';
        const color = action === 'deposit' ? 'Green' : 'Blue';

        const fields = [
            {
                name: `${actionLabel}:`,
                value: feeAmount > 0
                    ? `${netAmount.toLocaleString()} potatoes (${feeAmount.toLocaleString()} potato fee charged)`
                    : `${netAmount.toLocaleString()} potatoes`,
                inline: false,
            },
            {
                name: `Liquid Potatoes:`,
                value: `${userPotatoes.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `Bank Capacity:`,
                value: formatBankCapacityField(userBankStored, userBankCapacity),
                inline: false,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`🏦 ${userDisplayName}'s Bank`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createGuildBankEmbed(userDisplayName, userId, userAvatar, guildName, action, netAmount, feeAmount, userPotatoes, guildBankStored, guildBankCapacity) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const actionLabel = action === 'deposit' ? 'Deposited' : 'Withdrew';
        const color = action === 'deposit' ? 'Green' : 'Blue';
        const bar = buildProgressBar(guildBankStored, guildBankCapacity);
        const fillPercent = guildBankCapacity > 0 ? (guildBankStored / guildBankCapacity * 100) : 0;

        const fields = [
            {
                name: `${actionLabel}:`,
                value: feeAmount > 0
                    ? `${netAmount.toLocaleString()} potatoes (${feeAmount.toLocaleString()} potato fee charged)`
                    : `${netAmount.toLocaleString()} potatoes`,
                inline: false,
            },
            {
                name: `Your Liquid Potatoes:`,
                value: `${userPotatoes.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `${guildName}'s Guild Bank:`,
                value: `${bar} ${fillPercent.toFixed(1)}%\n${guildBankStored.toLocaleString()} / ${guildBankCapacity.toLocaleString()} potatoes`,
                inline: false,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`🏰 ${guildName}'s Guild Bank`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // /safehouse with no args (or the `list` action) — an overview of every owned
    // safehouse plus, unlike createBankEmbed, a field on the NEXT purchasable slot (cost,
    // rank gate, or "all 6 owned!") since buying more slots is the only way Safehouse
    // capacity grows at all — there's no regrade-style upgrade path to also show.
    createSafehouseListEmbed(userDisplayName, userId, userAvatar, ownedSlots, nextSlotInfo, rankInfo) {
        const avatarUrl = getUserAvatar(userId, userAvatar);

        const fields = ownedSlots.length > 0 ? ownedSlots.map(owned => {
            const def = safehouseFactory.getSlotDefinition(owned.slot);
            const bar = buildProgressBar(owned.balance, def.capacity);
            const fillPercent = def.capacity > 0 ? (owned.balance / def.capacity * 100) : 0;
            return {
                name: `Safehouse #${owned.slot}`,
                value: `${bar} ${fillPercent.toFixed(1)}%\n${owned.balance.toLocaleString()} / ${def.capacity.toLocaleString()} potatoes`,
                inline: false,
            };
        }) : [{ name: 'No safehouses yet', value: `Run \`/safehouse buy\` to buy your first one — unlocked at Mercenary Rank 1.`, inline: false }];

        const totalStored = safehouseFactory.getTotalStored({ safehouses: ownedSlots });
        const totalCapacity = safehouseFactory.getTotalCapacity({ safehouses: ownedSlots });
        fields.push({
            name: `Total`,
            value: `${totalStored.toLocaleString()} / ${totalCapacity.toLocaleString()} potatoes across ${ownedSlots.length} / ${Safehouse.SLOTS.length} safehouses`,
            inline: false,
        });

        if (nextSlotInfo) {
            const rankMet = rankInfo.rank >= nextSlotInfo.rankRequired;
            fields.push({
                name: `Next Safehouse (#${nextSlotInfo.slot})`,
                value: `${nextSlotInfo.cost.toLocaleString()} potatoes — +${nextSlotInfo.capacity.toLocaleString()} capacity\n${rankMet ? 'Unlocked — run `/safehouse buy`' : `Requires Mercenary Rank ${nextSlotInfo.rankRequired} (you're Rank ${rankInfo.rank})`}`,
                inline: false,
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🗝️ ${userDisplayName}'s Safehouses`)
            .setDescription(`Mercenary-exclusive stashes — each holds its own balance, so funding a purchase only ever exposes one house to /rob, not your whole stash.`)
            .setColor("DarkPurple")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Shown when /safehouse deposit|withdraw is run with no amount, offering quick
    // percentage buttons — same shape createBankAmountPickerEmbed already uses.
    // slotNumber is null when no house was picked (the common case now — see
    // safehouseFactory.splitDepositRandomly/autoWithdrawAllocation): the "available"
    // figure and capacity field both fall back to the total across every owned house
    // instead of one house's own numbers.
    createSafehouseAmountPickerEmbed(userDisplayName, userId, userAvatar, action, slotNumber, userPotatoes, houseBalance, totalStored, totalCapacity) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const isSingleHouse = slotNumber !== null;
        const def = isSingleHouse ? safehouseFactory.getSlotDefinition(slotNumber) : null;
        const capacityLabel = isSingleHouse ? `Safehouse #${slotNumber} Capacity` : `Total Safehouse Capacity`;
        const capacityBalance = isSingleHouse ? houseBalance : totalStored;
        const capacityMax = isSingleHouse ? def.capacity : totalCapacity;
        const available = action === 'deposit' ? userPotatoes : capacityBalance;
        const availableLabel = action === 'deposit' ? 'Liquid Potatoes' : (isSingleHouse ? `Safehouse #${slotNumber} Balance` : `Total Stored Across Safehouses`);

        const fields = [
            {
                name: `${availableLabel}:`,
                value: `${available.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `${capacityLabel}:`,
                value: `${buildProgressBar(capacityBalance, capacityMax)} ${(capacityMax > 0 ? capacityBalance / capacityMax * 100 : 0).toFixed(1)}%\n${capacityBalance.toLocaleString()} / ${capacityMax.toLocaleString()} potatoes`,
                inline: false,
            },
        ];

        const target = isSingleHouse ? `into Safehouse #${slotNumber}` : (action === 'deposit' ? 'across your safehouses' : 'from your safehouses');
        const embed = new EmbedBuilder()
            .setTitle(`🗝️ ${userDisplayName}, how much do you want to ${action} ${target}?`)
            .setDescription(isSingleHouse
                ? `Pick a quick amount below, or run \`/safehouse\` again with a specific number.`
                : `Pick a quick amount below, or run \`/safehouse\` again with a specific number.${action === 'deposit' ? ' Not picking a house spreads the deposit across your safehouses automatically.' : ''}`)
            .setColor("Blue")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // allocations: [{ slot, amount }] — one entry for an explicit single-house
    // deposit/withdraw, several when the player let it auto-split/auto-drain across their
    // safehouses. The breakdown line is what actually sells "money spread around" instead
    // of it just being an invisible implementation detail.
    createSafehouseEmbed(userDisplayName, userId, userAvatar, action, allocations, feeAmount, userPotatoes, totalStored, totalCapacity) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const actionLabel = action === 'deposit' ? 'Deposited' : 'Withdrew';
        const sign = action === 'deposit' ? '+' : '-';
        const color = action === 'deposit' ? 'Green' : 'Blue';
        const netAmount = allocations.reduce((sum, a) => sum + a.amount, 0);
        const isSingleHouse = allocations.length === 1;

        const breakdown = [...allocations]
            .sort((a, b) => a.slot - b.slot)
            .map(a => `Safehouse #${a.slot}: ${sign}${a.amount.toLocaleString()}`)
            .join('\n');

        const fields = [
            {
                name: `${actionLabel}${isSingleHouse ? ` (Safehouse #${allocations[0].slot})` : ' (spread across your safehouses)'}:`,
                value: [
                    feeAmount > 0
                        ? `${netAmount.toLocaleString()} potatoes (${feeAmount.toLocaleString()} potato fee charged)`
                        : `${netAmount.toLocaleString()} potatoes`,
                    isSingleHouse ? null : breakdown,
                ].filter(Boolean).join('\n'),
                inline: false,
            },
            {
                name: `Liquid Potatoes:`,
                value: `${userPotatoes.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `Total Safehouse Capacity:`,
                value: `${buildProgressBar(totalStored, totalCapacity)} ${(totalCapacity > 0 ? totalStored / totalCapacity * 100 : 0).toFixed(1)}%\n${totalStored.toLocaleString()} / ${totalCapacity.toLocaleString()} potatoes`,
                inline: false,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`🗝️ ${userDisplayName}'s Safehouse${isSingleHouse ? ` #${allocations[0].slot}` : 's'}`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes, userStarches, maxBuyAmount, currentType, starchPrice) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const color = currentType == 'buy' ? 'Green' : 'Orange';
        let fields = [];

        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Current Starches:`,
            value: `${userStarches.toLocaleString()} starches`,
            inline: true,
        })
        if (currentType == 'buy') {
            fields.push({
                name: `Max starches you can ${currentType}:`,
                value: `${maxBuyAmount.toLocaleString()} starches`,
                inline: false,
            })
        }

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} you can currently ${currentType} starches for ${starchPrice.toLocaleString()} potatoes!`)
            .setDescription(`Displayed below are your current potatoes, starches, and how many you can ${currentType}.`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by izmattk" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes, regradeType, newBaseAmount, increaseAmount, successChance, failStack, cost) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const color = increaseAmount > 0 ? 'Green' : 'Red';
        const succeededOrFailed = increaseAmount > 0 ? 'Succeeded' : 'Failed';
        let typeText;
        if (regradeType == 'Work Multiplier') {
            typeText = 'work multi';
        } else if (regradeType == 'Passive Amount') {
            typeText = 'potatoes';
        } else if (regradeType == 'Bank Capacity') {
            typeText = 'potatoes';
        }
        let fields = [];
        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Cost:`,
            value: `${cost.toLocaleString()} potatoes\n\n`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        if (increaseAmount > 0) {
            fields.push({
                name: `New ${regradeType}:`,
                value: `${newBaseAmount.toLocaleString()} ${typeText}`,
                inline: true,
            })
            fields.push({
                name: `Increase Amount:`,
                value: `${increaseAmount.toLocaleString()}`,
                inline: true,
            })
        }
        fields.push({
            name: `Success Chance:`,
            value: `${(successChance*100).toFixed(2)}% (+${(failStack*100).toFixed(2)}%)`,
            inline: false,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} ${succeededOrFailed} a ${regradeType} regrade!`)
            .setDescription(`Displayed below are your current potatoes and current base amount`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createBuyOrSellStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes, userStarches, currentType, starchAmount, starchPrice, totalPrice) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const color = currentType == 'buy' ? 'Green' : 'Orange';
        const starchesText = starchAmount > 1 ? 'starches' : 'starch';
        let fields = [];

        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Current Starches:`,
            value: `${userStarches.toLocaleString()} ${starchesText}`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} ${currentType}s ${starchAmount.toLocaleString()} ${starchesText} for ${totalPrice.toLocaleString()} potatoes!`)
            .setDescription(`Displayed below are your current potatoes and starches.\nCurrent Price: ${starchPrice.toLocaleString()} potatoes`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by izmattk" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createDailyStreakEmbed(userDisplayName, streak, reward) {
        const embed = new EmbedBuilder()
            .setTitle(`🥔 ${userDisplayName}'s Daily Spud Streak: Day ${streak}!`)
            .setDescription(`+${reward.toLocaleString()} potatoes for showing up today. Come back tomorrow to keep the streak going!`)
            .setColor("Orange")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    createTowerLeaderboardEmbed(sortedEntries) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        let entryList = [];
        if (sortedEntries.length === 0) {
            entryList.push({
                name: "No survivors yet today!",
                value: "Be the first to leave the Tater Tower alive and claim the top spot.",
                inline: false,
            });
        } else {
            sortedEntries.slice(0, 5).forEach((entry, index) => {
                entryList.push({
                    name: `${rankLabel(index)} ${entry.username}`,
                    value: `Floor ${entry.floor.toLocaleString()}`,
                    inline: false,
                });
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("🗼 Tater Tower Leaderboard (Today)")
            .setDescription("Only survived runs count — die to an Elite and your run won't rank, no matter how deep you got. Resets daily at 4am UTC.")
            .setColor("Purple")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(entryList)
        return embed;
    }

    createTowerLeaderboardResultsEmbed(winners) {
        const medals = ['🥇', '🥈', '🥉'];
        const fields = winners.map((winner, index) => {
            const bonusParts = [];
            if (winner.bonus.potatoes > 0) bonusParts.push(`+${winner.bonus.potatoes.toLocaleString()} potatoes`);
            if (winner.bonus.workMultiplier > 0) bonusParts.push(`+${winner.bonus.workMultiplier.toFixed(1)}x work multiplier`);
            if (winner.bonus.passiveIncome > 0) bonusParts.push(`+${winner.bonus.passiveIncome.toLocaleString()} passive income`);
            if (winner.bonus.bankCapacity > 0) bonusParts.push(`+${winner.bonus.bankCapacity.toLocaleString()} bank capacity`);
            return {
                name: `${medals[index] || ''} #${winner.place} ${winner.username} — Floor ${winner.floor.toLocaleString()}`,
                value: bonusParts.length > 0 ? bonusParts.join('\n') : "No bonus earned this run",
                inline: false,
            };
        });

        const embed = new EmbedBuilder()
            .setTitle("🗼 Tater Tower Daily Results!")
            .setDescription("Today's top survivors of the Tater Tower have claimed their rewards!")
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // One page's worth (pageItems, already sliced by the caller) of the active quest
    // list — used by the /quests button-pagination flow, mirroring
    // createAchievementsPageEmbed's shape even though the active count (5) rarely needs
    // more than one page today.
    createQuestsPageEmbed(userDisplayName, pageItems, pageIndex, totalPages, completedCount, totalCount) {
        const fields = pageItems.map(({ quest, isCompleted, progress }) => {
            const status = isCompleted ? '✅' : '📜';
            const categoryLabel = quest.category === 'daily' ? 'Daily' : 'Weekly';
            const value = isCompleted
                ? `${quest.description} (${categoryLabel})`
                : `${quest.description} (${categoryLabel})\n(${progress.toLocaleString()} / ${quest.threshold.toLocaleString()})`;
            return {
                name: `${status} ${quest.name}`,
                value: value,
                inline: false,
            };
        });

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Quests`)
            .setDescription(`${completedCount} / ${totalCount} completed — dailies reset 4am UTC, weeklies reset Mondays\nPage ${pageIndex + 1} / ${totalPages}`)
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Paginated exactly like createQuestsPageEmbed — pageItems is already the reversed
    // (most-recent-first), sliced-to-page-size history array from guildHistory.js.
    createGuildHistoryPageEmbed(guildName, type, pageItems, pageIndex, totalPages, totalCount) {
        const fields = pageItems.map(entry => {
            const when = new Date(entry.timestamp || entry.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            if (type === 'raid') {
                const status = entry.won ? '✅ Won' : '❌ Lost';
                return {
                    name: `${when} — ${entry.raidTier} raid`,
                    value: `${status} — ${entry.potatoDelta.toLocaleString()} potatoes ${entry.won ? 'gained' : 'at stake'}`,
                    inline: false,
                };
            }
            return {
                name: `${when} — ${entry.templateName}`,
                value: `✅ Completed — +${entry.reward.toLocaleString()} Bank Capacity`,
                inline: false,
            };
        });

        if (fields.length === 0) {
            fields.push({
                name: 'Nothing here yet',
                value: type === 'raid' ? 'No guild raids have been fought yet.' : 'No Guild Contracts have been completed yet.',
                inline: false,
            });
        }

        const title = type === 'raid' ? `${guildName}'s Raid History` : `${guildName}'s Guild Contract History`;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(`${totalCount} total — Page ${pageIndex + 1} / ${totalPages}`)
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createQuestCompleteEmbed(userDisplayName, completedQuests, userMultiplier) {
        const fields = completedQuests.map(quest => {
            let rewardText;
            if (quest.category === 'daily') {
                const perQuestReward = Math.floor(DailyQuest.BASE_REWARD_PER_MULTIPLIER * userMultiplier);
                rewardText = `+${perQuestReward.toLocaleString()} potatoes`;
            } else if (quest.reward) {
                const labels = { workMultiplierAmount: 'Work Multiplier', passiveAmount: 'Passive Income', bankCapacity: 'Bank Capacity' };
                // grantedRewardAmount is the actual amount questFactory computed for this
                // player (ramped by their regrade progress on that stat) — not a flat
                // template value, so it varies player to player.
                const amount = quest.reward.statType === 'workMultiplierAmount'
                    ? `+${quest.grantedRewardAmount.toFixed(2)}x`
                    : `+${Math.round(quest.grantedRewardAmount).toLocaleString()}`;
                rewardText = `${amount} ${labels[quest.reward.statType]}`;
            }
            return {
                name: `✅ ${quest.name}`,
                value: `${quest.description}\n${rewardText}`,
                inline: false,
            };
        });

        const title = completedQuests.length > 1
            ? `${userDisplayName} completed ${completedQuests.length} quests!`
            : `${userDisplayName} completed a quest!`;

        const embed = new EmbedBuilder()
            .setTitle(`📜 ${title}`)
            .setColor("Green")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createQuestRotationEmbed(activeQuests, weeklyRotated) {
        const dailyTemplates = Quests.filter(quest => activeQuests.dailyQuestIds.includes(quest.id));
        const fields = dailyTemplates.map(quest => ({
            name: `📜 ${quest.name}`,
            value: quest.description,
            inline: false,
        }));

        if (weeklyRotated) {
            const weeklyTemplates = Quests.filter(quest => activeQuests.weeklyQuestIds.includes(quest.id));
            weeklyTemplates.forEach(quest => {
                fields.push({
                    name: `🗓️ ${quest.name} (Weekly)`,
                    value: quest.description,
                    inline: false,
                });
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("📜 New Quests Available!")
            .setDescription(weeklyRotated ? "Today's quests, plus this week's new weekly quests:" : "Today's quests (weeklies unchanged):")
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // /guild-contract — read-only display of the active weekly Guild Contract and this
    // guild's aggregate progress toward it. progressResult is whatever
    // GuildContractFactory.getProgress returned (never null here — the command replies
    // with a plain message instead of building this embed when there's no active
    // contract at all).
    createGuildContractEmbed(guild, progressResult, breakdown) {
        const { template, progress, threshold, isCompleted } = progressResult;

        const fields = [
            {
                name: "Progress",
                value: `${progress.toLocaleString()} / ${threshold.toLocaleString()}`,
                inline: true,
            },
            {
                name: "Status",
                value: isCompleted ? "✅ Completed — reward already granted" : "📜 In progress",
                inline: true,
            },
            {
                name: "Reward",
                value: `+${GuildContract.BANK_CAPACITY_REWARD.toLocaleString()} Bank Capacity (guild-wide)`,
                inline: false,
            }
        ];

        // Only worth showing once there's something to rank — a guild with no fresh
        // baseline yet (nobody's worked since the contract rotated in) gets an empty
        // breakdown, same case getProgress reports as 0 progress.
        if (breakdown && breakdown.length > 0) {
            const topContributors = breakdown.slice(0, 5)
                .map((member, index) => `${index + 1}. ${member.username}: ${member.delta.toLocaleString()}`)
                .join('\n');
            fields.push({
                name: "Top Contributors",
                value: topContributors,
                inline: false,
            });
        }

        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        const embed = new EmbedBuilder()
            .setTitle(`🤝 ${guild.guildName}'s Guild Contract`)
            .setDescription(`${template.name}: ${template.description}`)
            .setColor("Orange")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // page: a static { title, description, fields } entry from start.js's ONBOARDING_PAGES —
    // pre-authored content, not derived from user data, so this is a thin renderer rather
    // than the chunk-a-list pattern createAchievementsPageEmbed/createCompanionListEmbed use.
    createOnboardingPageEmbed(userDisplayName, page, pageIndex, totalPages) {
        const embed = new EmbedBuilder()
            .setTitle(page.title)
            .setDescription(`${page.description}\n\nPage ${pageIndex + 1} / ${totalPages}`)
            .setColor("Blue")
            .setFooter({ text: `For ${userDisplayName} • Made by Beggar` })
            .setTimestamp(Date.now())
            .setFields(page.fields)
        return embed;
    }

    // Follow-up sent from /work when a guild member's action pushes their guild's
    // active Guild Contract over its threshold — mirrors createQuestCompleteEmbed's
    // shape, one level up (guild-wide instead of per-user).
    createGuildContractCompleteEmbed(guildName, template, bankCapacityReward) {
        const embed = new EmbedBuilder()
            .setTitle(`🤝 ${guildName} completed its Guild Contract!`)
            .setDescription(`${template.name}: ${template.description}`)
            .addFields({
                name: "Reward",
                value: `+${bankCapacityReward.toLocaleString()} Bank Capacity (guild-wide, permanent)`,
                inline: false,
            })
            .setColor("Green")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // Posted to the events channel by the 4am cron on the Mondays a new Guild Contract
    // actually rotates in (mirrors createQuestRotationEmbed, which only posts weekly
    // quest changes on the Mondays they actually happen).
    createGuildContractRotationEmbed(activeContract, template) {
        const embed = new EmbedBuilder()
            .setTitle("🤝 New Guild Contract Available!")
            .setDescription(`This week, every guild can work toward:\n**${template.name}** — ${template.description}`)
            .addFields({
                name: "Reward",
                value: `+${GuildContract.BANK_CAPACITY_REWARD.toLocaleString()} Bank Capacity (guild-wide) on completion`,
                inline: false,
            })
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // Discord caps a single embed at 25 fields and a message at 10 embeds, so both
    // achievement embed builders below chunk into multiple embeds rather than risk
    // throwing (or silently truncating) once the achievement list grows past 25.
    createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked) {
        const fields = newlyUnlocked.map(achievement => ({
            name: achievement.name,
            value: achievement.description,
            inline: false,
        }));

        const title = newlyUnlocked.length > 1
            ? `${userDisplayName} unlocked ${newlyUnlocked.length} achievements!`
            : `${userDisplayName} unlocked an achievement!`;

        const chunks = chunkFields(fields, 25);
        return chunks.map((chunk, index) => {
            const embed = new EmbedBuilder()
                .setColor("Gold")
                .setFooter({ text: "Made by Beggar" })
                .setTimestamp(Date.now())
                .setFields(chunk)
            if (index === 0) embed.setTitle(`🏆 ${title}`);
            return embed;
        });
    }

    // One page's worth (pageItems, already sliced by the caller) of the achievement list —
    // used by the /achievements button-pagination flow in achievements.js, so each page
    // stays a single small embed rather than growing into a wall of text.
    createAchievementsPageEmbed(userDisplayName, pageItems, pageIndex, totalPages, unlockedCount, totalCount) {
        const fields = pageItems.map(({ achievement, isUnlocked, currentValue }) => {
            const status = isUnlocked ? '✅' : '🔒';
            const value = isUnlocked
                ? achievement.description
                : `${achievement.description}\n(${Math.min(currentValue, achievement.threshold).toLocaleString()} / ${achievement.threshold.toLocaleString()})`;
            return {
                name: `${status} ${achievement.name}`,
                value: value,
                inline: false,
            };
        });

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Achievements`)
            .setDescription(`${unlockedCount} / ${totalCount} unlocked\nPage ${pageIndex + 1} / ${totalPages}`)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Admin-only sanity-check dashboard (/admin-stats) — surfaces state that's already
    // cached/persisted elsewhere (economy stats doc, starch doc, world doc, active_quests
    // doc) in one place instead of admins checking DynamoDB directly. Every param can be
    // null/undefined (a fresh deploy before the relevant cron/tick has ever run) so each
    // field falls back to a "not available yet" string rather than throwing.
    createAdminStatsEmbed(economy, starchStatus, worldStatus, activeQuests) {
        let fields = [];

        fields.push({
            name: "Server Total",
            value: economy
                ? `${economy.serverTotal.toLocaleString()} potatoes\n${economy.serverTotalStarches.toLocaleString()} starches`
                : "Not cached yet",
            inline: true,
        });
        fields.push({
            name: "Median Lifetime Earnings",
            value: economy ? `${economy.medianTotalEarnings.toLocaleString()} potatoes` : "Not cached yet",
            inline: true,
        });
        fields.push({
            name: "Active Users",
            value: economy ? `${economy.activeUserCount.toLocaleString()}` : "Not cached yet",
            inline: true,
        });

        fields.push({
            name: "Starch Cycle",
            value: starchStatus.price != null
                ? `Currently **${starchStatus.phase === 'buy' ? 'buying' : 'selling'}** at ${starchStatus.price.toLocaleString()} potatoes/starch`
                : "Not cached yet",
            inline: false,
        });

        fields.push({
            name: "Active World Boss",
            value: worldStatus.active
                ? `${worldStatus.bossName} — ${worldStatus.raidMemberCount} joined`
                : "None active",
            inline: false,
        });

        const dailyNames = activeQuests
            ? Quests.filter(quest => activeQuests.dailyQuestIds?.includes(quest.id)).map(quest => quest.name)
            : [];
        const weeklyNames = activeQuests
            ? Quests.filter(quest => activeQuests.weeklyQuestIds?.includes(quest.id)).map(quest => quest.name)
            : [];
        fields.push({
            name: `Daily Quests${activeQuests ? ` (since ${activeQuests.dailyRotationDate})` : ''}`,
            value: dailyNames.length ? dailyNames.join(", ") : "Not rotated yet",
            inline: false,
        });
        fields.push({
            name: `Weekly Quests${activeQuests ? ` (since ${activeQuests.weeklyRotationDate})` : ''}`,
            value: weeklyNames.length ? weeklyNames.join(", ") : "Not rotated yet",
            inline: false,
        });

        const embed = new EmbedBuilder()
            .setTitle("🛠️ Admin Economy Dashboard")
            .setDescription("Cached game-health snapshot — refreshes every 5 minutes via the passive income tick, except quests/world which update on their own triggers.")
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }
}

function chunkFields(fields, size) {
    const chunks = [];
    for (let i = 0; i < fields.length; i += size) {
        chunks.push(fields.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

function findShopItemName(amount, shopItems) {
    for (const [index, element] of shopItems.entries()) {
        if (element.amount == amount.toFixed(1)) {
            return element.name
        }
    }
    return "N/A";
}

function getUserAvatar(userId, avatarHash) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`;
}

async function getGuildWorkMulti(userDetails, userMultiplier){
    const userGuildId = userDetails.guildId;
    if (userGuildId){
        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if(guild){
            if(guild.guildBuff == "workMulti"){
                const level = guildBuffFactory.getGuildLevel(guild.raidCount);
                return userMultiplier * guildBuffFactory.getGuildBuffValue("workMulti", level);
            }
        }
    }
    return 0
}

module.exports = {
    EmbedFactory
}