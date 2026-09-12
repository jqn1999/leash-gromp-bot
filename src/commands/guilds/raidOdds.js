const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const { getLiveRaidRoster, getEffectiveRaidPower, getUnlockedRaidModes } = require("../../utils/raidFactory");
const { getWorldBuffWorkMultiPercent } = require("../../utils/workFactory");
const { buildRaidPreview, getRaidLevelAndRewardMultiplier } = require("./startRaid");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Keyed exactly like getUnlockedRaidModes's own return shape and /start-raid's
// raid-select choices, in the display order the embed should show them.
const RAID_MODE_LABELS = {
    baby: 'Baby Raid',
    regular: 'Regular Raid',
    elite: 'Elite Raid',
    legendary: 'Legendary Raid',
    stat: 'Stat Raid',
};

// Read-only preview, mirrors /bounty-board and /current-raid's own "viewing never
// claims/rolls/commits anything" precedent. Direct instruction, 2026-09-12: "give a way
// for guilds to see the raid probabilities of each tier without having to wait for raid
// cd to be done", then "it can be similar to the bounty board mercs have which has a
// single embed with all the odds/rewards/etc." Deliberately has NO cooldown check at
// all — that's the entire point of this command existing separately from /start-raid's
// own preview, which only shows once the guild is off cooldown. Reads the exact same
// buildRaidPreview/getRaidLevelAndRewardMultiplier helpers startRaid.js's own real roll
// uses, so these numbers can never drift from what a real raid attempt would actually use.
module.exports = {
    name: "raid-odds",
    description: "See your guild's raid odds and rewards for every unlocked tier, even while on cooldown",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to view raid odds for!");
        if (!guild) return;

        const raidList = await getLiveRaidRoster(guild);
        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before previewing odds!`);
            return;
        }

        const { guildLevel, raidRewardMultiplier } = getRaidLevelAndRewardMultiplier(guild);

        const raidMemberDetails = await Promise.all(raidList.map(element => dynamoHandler.findUser(element.id, element.username)));
        // Same three ingredients runStartRaidFlow's own totalMultiplier is built from —
        // rank-weighted team power + headcount bonus, Firefly's best-in-roster boost, and
        // the live World Boss workMulti buff — so this preview can't understate (or
        // overstate) the odds a real raid attempt would actually roll against.
        let totalMultiplier = getEffectiveRaidPower(raidMemberDetails);
        const raidCompanionBoost = Math.max(0, ...raidMemberDetails.map(m => m ? companionFactory.getActivePerkValue(m, "guildRaidMultiplierPercent") : 0));
        if (raidCompanionBoost > 0) {
            totalMultiplier *= (1 + raidCompanionBoost);
        }
        const worldBuffPercent = await getWorldBuffWorkMultiPercent();
        if (worldBuffPercent > 0) {
            totalMultiplier *= (1 + worldBuffPercent);
        }

        const unlockedModes = getUnlockedRaidModes(guildLevel);
        const modeSections = Object.entries(RAID_MODE_LABELS)
            .filter(([mode]) => unlockedModes[mode])
            .map(([mode, label]) => ({
                label,
                brackets: buildRaidPreview(mode, totalMultiplier, raidRewardMultiplier, guildLevel),
            }));

        const raidTimeRemainingSeconds = Math.max(0, Math.floor((guild.raidTimer - Date.now()) / 1000));
        const embed = embedFactory.createRaidOddsEmbed(guild.guildName, totalMultiplier, guildLevel, raidRewardMultiplier, modeSections, raidTimeRemainingSeconds);
        interaction.editReply({ embeds: [embed] });
    }
}
