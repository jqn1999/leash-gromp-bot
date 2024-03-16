const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Raid } = require("../../utils/constants")
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
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
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
        const raidList = guild.raidList;

        const timeSinceLastRaidInSeconds = Math.floor((Date.now() - guild.raidTimer) / 1000);
        const timeUntilRaidAvailableInSeconds = Raid.RAID_TIMER_SECONDS - timeSinceLastRaidInSeconds

        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before starting!`);
            return;
        }

        let totalMultiplier = 0;
        let raidMemberList = [];
        for (const [index, element] of raidList.entries()) {
            const userDetails = await dynamoHandler.findUser(element.id, element.username);
            if (!userDetails) {
                interaction.editReply(`${element.username} was not in the DB, they should now be added. Try again!`);
                return;
            }

            const user = {
                name: `${index + 1}) ${element.username}`,
                value: `${userDetails.workMultiplierAmount.toFixed(2)}x Multiplier`,
                inline: false,
            };
            raidMemberList.push(user);
            totalMultiplier += userDetails.workMultiplierAmount;
        }

        // check for guild buff - multi
        if(guild.guildBuff == "raidMulti"){
            totalMultiplier *= 1.15;
        }

        embed = await embedFactory.createRaidMemberListEmbed(guild, raidMemberList, totalMultiplier, timeSinceLastRaidInSeconds, timeUntilRaidAvailableInSeconds);
        interaction.editReply({ embeds: [embed] });
    }
}