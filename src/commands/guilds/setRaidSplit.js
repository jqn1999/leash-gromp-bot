const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

// Per-guild opt-in toggle for how a raid reward/penalty that doesn't fully fit in the
// guild bank gets split among raiders — 'even' (raidFactory.handlePotatoSplit, today's
// default behavior) or 'share' (raidFactory.handlePotatoSplitByShare, weighted by each
// raider's own raw raid power). Deliberately NOT a forced replacement of even-split — see
// guild.raidSplitMode's default in dynamoHandler.js's getDefaultGuildFields, self-healed
// onto every pre-existing guild the same way guildBuff already is.
const RAID_SPLIT_MODE_LABELS = {
    even: 'Even Split — every raider gets an equal share',
    share: 'Contribution-Based Split — bigger raid power means a bigger share'
};

module.exports = {
    name: "set-raid-split",
    description: "Set how your guild's raid rewards/penalties are split among raiders",
    options: [
        {
            name: 'mode',
            description: 'How to split raid rewards/penalties that spill out of the guild bank',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'even-split',
                    value: 'even'
                },
                {
                    name: 'contribution-split',
                    value: 'share'
                }
            ]
        }
    ],

    callback: async (client, interaction) => {
        await interaction.deferReply()
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to set the raid split mode for!");
        if (!guild) return;
        const guildId = guild.guildId;
        const memberList = guild.memberList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        let canSetRaidSplit = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canSetRaidSplit) {
            interaction.editReply(`${userDisplayName} you must be a co-leader or the guild leader to set the raid split mode!`);
            return;
        }
        let raidSplitMode = interaction.options.get('mode')?.value;

        await dynamoHandler.updateGuildDatabase(guildId, 'raidSplitMode', raidSplitMode);
        interaction.editReply(`Raid reward/penalty split for ${guild.guildName} has been set to **${raidSplitMode}**: ${RAID_SPLIT_MODE_LABELS[raidSplitMode]}`)
    }
}
