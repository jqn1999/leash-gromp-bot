const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const { getRaidLevelInfo } = require("../../utils/raidFactory");
const { getRaidCooldownSkipSources } = require("../guilds/startRaid");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Read-only preview across every cooldown-skip mechanic in the game (2026-09-05, direct
// instruction: "can we get all the user's skip chances for all the various mechanics
// somewhere... a dedicated embed to make it easier"). Reuses the exact same source-gathering
// helpers each real command rolls against — dynamoHandler.getWorkCooldownSkipSources,
// mercenaryFactory.getMercenaryCooldownSkipSources, startRaid.getRaidCooldownSkipSources —
// so the numbers shown here can never drift from what actually gets rolled. Never rolls
// anything itself and never writes to the database — same "viewing never claims/spends
// anything" precedent /bounty-board and /notoriety already set.
module.exports = {
    name: "skip-chances",
    description: "See your current % chance to skip cooldown on /work, Bounty/Heist, and Guild Raid",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const workSources = await dynamoHandler.getWorkCooldownSkipSources(userDetails);

        // null (not an empty array) when the system isn't unlocked yet — the embed shows a
        // "here's how to unlock this" line instead of a misleading 0%.
        let mercenarySources = null;
        if (userDetails.isMercenary) {
            mercenarySources = await mercenaryFactory.getMercenaryCooldownSkipSources(userDetails);
        }

        let raidSources = null;
        if (userDetails.guildId) {
            const guild = await dynamoHandler.findGuildById(userDetails.guildId);
            if (guild) {
                const { level: guildLevel } = getRaidLevelInfo(guild.raidCount);
                raidSources = await getRaidCooldownSkipSources(guild, guildLevel);
            }
        }

        const embed = embedFactory.createSkipChancesEmbed(userDisplayName, workSources, mercenarySources, raidSources);
        interaction.editReply({ embeds: [embed] });
    }
}
