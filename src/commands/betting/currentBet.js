const { EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

async function createBetEmbed(betDetails, interaction) {
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
        value: `${betDetails.optionOneTotal} potatoes`,
        inline: true,
    })
    fields.push({
        name: `2) ${betDetails.optionTwo}`,
        value: `${betDetails.optionTwoTotal} potatoes`,
        inline: true,
    })

    if (betDetails.optionOneTotal != betDetails.baseAmount) {
        let largestVoterOptionOne = {userId: "", bet: 0, displayName: ""};
        let optionOneSplit;
        betDetails.optionOneVoters.forEach(voter => {
            if (voter.bet > largestVoterOptionOne.bet) {
                largestVoterOptionOne.userId = voter.userId;
                largestVoterOptionOne.bet = voter.bet;
            }
        })
        const targetUserOne = await interaction.guild.members.fetch(largestVoterOptionOne.userId);
        if (!targetUserOne) {
            await interaction.editReply("That user doesn't exist in this server.");
            return;
        }
        largestVoterOptionOne.displayName = targetUserOne.user.displayName
        optionOneSplit = largestVoterOptionOne.bet / (betDetails.optionOneTotal - betDetails.baseAmount);
        optionOnePercentage = (optionOneSplit*100).toFixed(2)
        fields.push({
            name: `${betDetails.optionOne} Largest Bet: ${largestVoterOptionOne.bet}`,
            value: `${largestVoterOptionOne.displayName} wins ${Math.floor(optionOneSplit*betDetails.optionTwoTotal)} potatoes (${optionOnePercentage}%)`,
            inline: false,
        })
    }

    if (betDetails.optionTwoTotal != betDetails.baseAmount) {
        let largestVoterOptionTwo = {userId: "", bet: 0, displayName: ""};
        let optionTwoSplit;
        betDetails.optionTwoVoters.forEach(voter => {
            if (voter.bet > largestVoterOptionTwo.bet) {
                largestVoterOptionTwo.userId = voter.userId;
                largestVoterOptionTwo.bet = voter.bet;
            }
        })
        const targetUserTwo = await interaction.guild.members.fetch(largestVoterOptionTwo.userId);
        if (!targetUserTwo) {
            await interaction.editReply("That user doesn't exist in this server.");
            return;
        }
        largestVoterOptionTwo.displayName = targetUserTwo.user.displayName
        optionTwoSplit = largestVoterOptionTwo.bet / (betDetails.optionTwoTotal - betDetails.baseAmount);
        optionTwoPercentage = (optionTwoSplit*100).toFixed(2)
        fields.push({
            name: `${betDetails.optionTwo} Largest Bet: ${largestVoterOptionTwo.bet}`,
            value: `${largestVoterOptionTwo.displayName} wins ${Math.floor(optionTwoSplit*betDetails.optionOneTotal)} potatoes (${optionTwoPercentage}%)`,
            inline: false,
        })
    }
    fields.push({
        name: `Base Bet Amount (per side):`,
        value: `${betDetails.baseAmount} potatoes)`,
        inline: false,
    })

    const embed = new EmbedBuilder()
        .setTitle(`(1) ${betDetails.optionOne} vs (2) ${betDetails.optionTwo} (${ratio})`)
        .setDescription(`${betDetails.description}\nBelow are the current bets and their respective totals: `)
        .setColor("Random")
        .setThumbnail(betDetails.thumbnailUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .setFields(fields);
    return embed;
}

module.exports = {
    name: "current-bet",
    description: "Displays the current bet (if there is one)",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const mostRecentBet = await dynamoHandler.getMostRecentBet();
        if (mostRecentBet.isActive == false) { 
            interaction.editReply(`There is no currently active bet.`);
            return;
        }
        const embed = await createBetEmbed(mostRecentBet, interaction);
        interaction.editReply({ embeds: [embed] });
    }
}