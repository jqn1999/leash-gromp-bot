const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const guildBuffFactory = require("../../utils/guildBuffFactory");

module.exports = {
    name: "set-buff",
    description: "Set guild buff for all members",
    options: [
        {
            name: 'buff',
            description: 'buff choices',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'rob-chance',
                    value: 'robChance'
                },
                {
                    name: 'raid-timer',
                    value: 'raidTimer'
                },
                {
                    name: 'work-timer',
                    value: 'workTimer'
                },
                {
                    name: 'work-multi',
                    value: 'workMulti'
                }
            ]
        }
    ],

    callback: async (client, interaction) => {
        await interaction.deferReply()
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to select a buff for!`);
            return;
        }

        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        const guildId = guild.guildId;
        const memberList = guild.memberList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        let canBuff = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canBuff) {
            interaction.editReply(`${userDisplayName} you must be a co-leader or the guild leader to set the guild buff!`);
            return;
        }
        let buffSelect = interaction.options.get('buff')?.value;

        // store buff into guild db
        await dynamoHandler.updateGuildDatabase(guildId, 'guildBuff', buffSelect);
        const level = guildBuffFactory.getGuildLevel(guild.raidCount);
        interaction.editReply(`Guild buff for ${guild.guildName} has been set to **${buffSelect}**: ${guildBuffFactory.getGuildBuffLabel(buffSelect, level)}`)
    }
}