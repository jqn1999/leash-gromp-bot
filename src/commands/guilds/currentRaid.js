const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Raid } = require("../../utils/constants")
const { getLiveRaidRoster, getMemberRaidPower, getEffectiveRaidPower } = require("../../utils/raidFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "current-raid",
    description: "Displays the current raid group for your guild",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to view the raid of!`);
            return;
        }

        let guild = await dynamoHandler.findGuildById(userGuildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
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
        // Same average-plus-headcount-bonus formula /start-raid actually rolls against
        // (see raidFactory.js's getEffectiveRaidPower) — kept in sync so this preview
        // never shows a different number than what a real raid attempt would use.
        const totalMultiplier = getEffectiveRaidPower(raidMemberDetails);

        embed = await embedFactory.createRaidMemberListEmbed(guild, raidMemberList, totalMultiplier, timeUntilRaidAvailableInSeconds);
        interaction.editReply({ embeds: [embed] });
    }
}