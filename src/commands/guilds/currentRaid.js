const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Raid } = require("../../utils/constants")
const { getLiveRaidRoster, getMemberRaidPower, getEffectiveRaidPowerBreakdown, getRaidLevelInfo, getUnlockedRaidModes } = require("../../utils/raidFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const { runStartRaidFlow } = require("./startRaid");
const embedFactory = new EmbedFactory();

// Labels for the mode-selection row shown after "Start Raid" is clicked — keyed exactly
// like /start-raid's own raid-select choices and getUnlockedRaidModes's return shape, so a
// button click here starts the exact same raid mode typing the option manually would.
const RAID_MODE_LABELS = {
    baby: 'Baby',
    regular: 'Regular',
    elite: 'Elite',
    legendary: 'Legendary',
    stat: 'Stat'
};

function buildRaidModeRow(unlockedModes) {
    const buttons = Object.entries(RAID_MODE_LABELS)
        .filter(([mode]) => unlockedModes[mode])
        .map(([mode, label]) => new ButtonBuilder()
            .setCustomId(`current_raid_mode_${mode}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Primary));
    return new ActionRowBuilder().addComponents(buttons);
}

module.exports = {
    name: "current-raid",
    description: "Displays the current raid group for your guild",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to view the raid of!");
        if (!guild) return;
        const raidList = await getLiveRaidRoster(guild);

        const timeUntilRaidAvailableInSeconds = Math.floor((guild.raidTimer - Date.now())/1000);

        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before starting!`);
            return;
        }

        let raidMemberList = [];
        const raidMemberDetails = await Promise.all(raidList.map(element => dynamoHandler.findUser(element.id, element.username)));
        for (const [index, element] of raidList.entries()) {
            const userDetails = raidMemberDetails[index];
            if (!userDetails) {
                interaction.editReply(`${element.username} could not be looked up due to a database error, please try again!`);
                return;
            }

            const user = {
                name: `${index + 1}) ${element.username}`,
                value: `${getMemberRaidPower(userDetails).toFixed(2)}x Raid Power (Work Multiplier + rebirth bonus)`,
                inline: false,
            };
            raidMemberList.push(user);
        }
        // Same rank-weighted-teamPower-plus-headcount-bonus formula /start-raid actually
        // rolls against (see raidFactory.js's getEffectiveRaidPower) — kept in sync so
        // this preview never shows a different number than what a real raid attempt
        // would use. The breakdown (not just the final number) is passed to the embed so
        // players can see what the Total Multiplier is actually made of — rank-weighted
        // team power plus a headcount bonus — instead of an opaque single figure.
        const powerBreakdown = getEffectiveRaidPowerBreakdown(raidMemberDetails);
        const totalMultiplier = powerBreakdown.effectivePower;

        const embed = await embedFactory.createRaidMemberListEmbed(guild, raidMemberList, totalMultiplier, timeUntilRaidAvailableInSeconds, powerBreakdown, guild.raidSplitMode, guild.raidPayoutMode);

        // Only offer the Start Raid button once the cooldown has actually elapsed —
        // clicking it before then would just hit runStartRaidFlow's own cooldown
        // rejection, so there's no reason to show it early.
        const raidIsReady = timeUntilRaidAvailableInSeconds <= 0;
        const startRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('current_raid_start').setLabel('Start Raid').setStyle(ButtonStyle.Success)
        );

        const reply = await interaction.editReply({ embeds: [embed], components: raidIsReady ? [startRow] : [] });
        if (!raidIsReady) return;

        const collectorFilter = i => i.user.id === interaction.user.id;
        const startClick = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);
        if (!startClick) {
            await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
            return;
        }
        await startClick.deferUpdate();

        // Re-fetched rather than reusing the guild/level looked up above — time may have
        // passed since this reply first went out, and a stale level here could offer (or
        // hide) an Elite/Legendary button the guild no longer does/does qualify for.
        const freshGuild = await dynamoHandler.findGuildById(guild.guildId);
        const { level: guildLevel } = getRaidLevelInfo(freshGuild.raidCount);
        const unlockedModes = getUnlockedRaidModes(guildLevel);

        await interaction.editReply({ embeds: [embed], components: [buildRaidModeRow(unlockedModes)] });

        const modeClick = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);
        if (!modeClick) {
            await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
            return;
        }

        const raidSelection = modeClick.customId.replace('current_raid_mode_', '');
        await modeClick.deferUpdate();
        // runStartRaidFlow takes it from here — the shared implementation /start-raid's
        // own callback also delegates to, so this button starts exactly the raid typing
        // the slash command would (permission check, cooldown, roster, preview + confirm,
        // scenario roll, all of it).
        await runStartRaidFlow(modeClick, raidSelection);
    }
}
