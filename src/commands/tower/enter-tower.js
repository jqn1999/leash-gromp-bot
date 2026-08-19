const dynamoHandler = require("../../utils/dynamoHandler");
var {towerFactory} = require("../../utils/towerFactory");
const { getUserInteractionDetails } = require("../../utils/helperCommands");
const { EmbedBuilder } = require("discord.js")
const tC = require("../../utils/towerConstants.js");

async function processRewardPayouts(interaction, userId, rewards, username, userDisplayName, floor, died) {
    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        // The run's results embed has already been sent by this point (see the
        // followUp below in the callback) — this is a genuine DB error on crediting
        // the reward, not a "no reward earned" case, so the player needs to know their
        // run's reward didn't actually get saved rather than assuming it silently did.
        // Since nothing was written, an admin has nothing to look up either — hand the
        // player the exact numbers as a copy-pasteable block so they can be credited
        // manually instead of the run just being lost.
        const failureReport = {
            userId,
            username,
            floor,
            died,
            rewards: {
                potatoes: rewards[tC.PAYOUT.POTATOES] || 0,
                workMultiplier: rewards[tC.PAYOUT.WORK_MULTIPLIER] || 0,
                passiveIncome: rewards[tC.PAYOUT.PASSIVE_INCOME] || 0,
                bankCapacity: rewards[tC.PAYOUT.BANK_CAPACITY] || 0
            },
            timestamp: new Date().toISOString()
        };
        await interaction.followUp({
            content: `${userDisplayName}, your tower run's rewards could not be saved due to a database error. Send this to an admin so they can manually credit you:\n\`\`\`json\n${JSON.stringify(failureReport, null, 2)}\n\`\`\``,
            ephemeral: true
        });
        return;
    }
    let userMultiplier = userDetails.workMultiplierAmount;
    let userPassiveAmount = userDetails.passiveAmount;
    let userBankCapacity = userDetails.bankCapacity;
    let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;

    if (rewards[tC.PAYOUT.POTATOES]) {
        await dynamoHandler.addUserDatabase(userId, "potatoes", rewards[tC.PAYOUT.POTATOES]);
        await dynamoHandler.addUserDatabase(userId, "totalEarnings", rewards[tC.PAYOUT.POTATOES])
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
    if (rewards[tC.PAYOUT.WORK_MULTIPLIER] || rewards[tC.PAYOUT.PASSIVE_INCOME] || rewards[tC.PAYOUT.BANK_CAPACITY]) {
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
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }
        let userMultiplier = userDetails.workMultiplierAmount;

        if (userMultiplier < 20) {
            interaction.editReply(`${userDisplayName} you are barred entry due to being too weak, reach 20x multiplier before you can enter!`)
            return;
        }

        const canEnterTower = userDetails.canEnterTower;
        if (!canEnterTower) {
            interaction.editReply(`${userDisplayName} you have already entered the tower today!`);
            return;
        }

        await dynamoHandler.updateUserDatabase(userId, "canEnterTower", false);
        let tF = new towerFactory(interaction, username, userDetails.workMultiplierAmount)
        let tower_out = await tF.startRun()
        let rewards = tower_out[0];
        let floor = tower_out[1];
        let died = tower_out[2];

        // embed for final results
        let embed = createResult(rewards, floor, username)
        await interaction.followUp({
            embeds: [embed]
        })

        await processRewardPayouts(interaction, userId, rewards, username, userDisplayName, floor, died);

        // "Highest floor ever reached" is a broader personal-best than the daily
        // leaderboard's survival-only eligibility below — floor already reflects the
        // last floor actually reached either way (towerFactory decrements it back by
        // one on a lost Elite fight, since dying happens on the way to the next
        // floor), so a died run still legitimately counts toward this record.
        await dynamoHandler.updateIfNewRecord(userId, 'highestTowerFloor', floor);

        // Only a survived run (voluntarily left, not lost to an Elite) counts for the
        // daily leaderboard — see towerLeaderboardFactory.js for how it's ranked/paid out.
        if (!died) {
            await dynamoHandler.recordTowerLeaderboardEntry({
                userId,
                username,
                floor,
                potatoes: rewards[tC.PAYOUT.POTATOES] || 0,
                workMultiplier: rewards[tC.PAYOUT.WORK_MULTIPLIER] || 0,
                passiveIncome: rewards[tC.PAYOUT.PASSIVE_INCOME] || 0,
                bankCapacity: rewards[tC.PAYOUT.BANK_CAPACITY] || 0
            });
        }
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
                value: `${rewards[1].toFixed(2)} work multiplier`,
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