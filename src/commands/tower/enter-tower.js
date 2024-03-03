const dynamoHandler = require("../../utils/dynamoHandler");
var {towerFactory} = require("../../utils/towerFactory");
const { getUserInteractionDetails } = require("../../utils/helperCommands");
const { EmbedBuilder } = require("discord.js")
const tC = require("../../utils/towerConstants.js");

async function processRewardPayouts(userId, rewards, userPotatoes, userTotalEarnings, userMultiplier, userPassiveAmount, userBankCapacity, sweetPotatoBuffs) {
    if (rewards[tC.PAYOUT.POTATOES]) {
        userPotatoes += rewards[tC.PAYOUT.POTATOES]
        userTotalEarnings += rewards[tC.PAYOUT.POTATOES]
        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);
    }
    if (rewards[tC.PAYOUT.WORK_MULTIPLIER]) {
        userMultiplier += rewards[tC.PAYOUT.WORK_MULTIPLIER]
        sweetPotatoBuffs.workMultiplierAmount += rewards[tC.PAYOUT.WORK_MULTIPLIER];
        await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", userMultiplier);
    }
    if (rewards[tC.PAYOUT.PASSIVE_INCOME]) {
        userPassiveAmount += rewards[tC.PAYOUT.PASSIVE_INCOME]
        sweetPotatoBuffs.passiveAmount += rewards[tC.PAYOUT.PASSIVE_INCOME];
        await dynamoHandler.updateUserDatabase(userId, "passiveAmount", userPassiveAmount);
    }
    if (rewards[tC.PAYOUT.BANK_CAPACITY]) {
        userBankCapacity += rewards[tC.PAYOUT.BANK_CAPACITY]
        sweetPotatoBuffs.bankCapacity += rewards[tC.PAYOUT.BANK_CAPACITY];
        await dynamoHandler.updateUserDatabase(userId, "bankCapacity", userBankCapacity);
    }
    if (rewards[tC.PAYOUT.WORK_MULTIPLIER] || rewards[tC.PAYOUT.PASSIVE_INCOME] ||rewards[tC.PAYOUT.BANK_CAPACITY]) {
        await dynamoHandler.updateUserDatabase(userId, "sweetPotatoBuffs", sweetPotatoBuffs);
    }
}

module.exports = {
    name: "enter-tower",
    description: "Enter the tater tower once a day",
    callback: async (client, interaction) => {
        await interaction.deferReply();

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userMultiplier = userDetails.workMultiplierAmount;
        let userPassiveAmount = userDetails.passiveAmount;
        let userBankCapacity = userDetails.bankCapacity;
        let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;
        const canEnterTower = userDetails.canEnterTower;

        /*if (!canEnterTower) {
            interaction.editReply(`${userDisplayName} you have already entered the tower today!`);
            return;
        }*/

        await dynamoHandler.updateUserDatabase(userId, "canEnterTower", false);
        let tF = new towerFactory(interaction, username, userDetails.workMultiplierAmount)
        let rewards = tC.RUN
        rewards, floor = await tF.startRun()

        // embed for final results
        let embed = createResult(rewards, floor, username)
        await interaction.followUp({
            embeds: [embed]
        })

        // TODO: PROCESS PAYOUT
        await processRewardPayouts(userId, rewards, userPotatoes, userTotalEarnings, userMultiplier, userPassiveAmount, userBankCapacity, sweetPotatoBuffs);
        console.log("left")
    }
}

function createResult(rewards, floor, username){
    const embed = new EmbedBuilder()
        .setTitle(`Tower Run: ${username.toLocaleString()}\nAchieved Floor ${floor.toLocaleString()}!`)
        .setColor('Yellow')
        .setTimestamp(Date.now())
        .setFooter({text: `Tater Tower: ${username}`})
        .setThumbnail("https://cdn.discordapp.com/attachments/1146091052781011026/1207562794057203752/cute-brown-cartoon-potato-character-laughing-and-waving-hands-on-a-white-background-food-and.png?ex=65e0197d&is=65cda47d&hm=57e5b7985e414688367a7318cb3a5b3128cc8affa1d16a25b21c739549269e85&")
        .addFields(
            {
                name: "Potatoes:",
                value: `${rewards[0].toLocaleString()} potatoes`,
                inline: false,
            },
            {
                name: "Work Multiplier:",
                value: `${rewards[1]} work multiplier`,
                inline: false,
            },
            {
                name: "Passive Income:",
                value: `${rewards[2].toLocaleString()} passive`,
                inline: false,
            },
            {
                name: "Bank Capacity:",
                value: `${rewards[3].toLocaleString()} capacity`,
                inline: false,
            }
        );
        return embed
}