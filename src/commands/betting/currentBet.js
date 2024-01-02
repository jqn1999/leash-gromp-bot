const { EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

async function createBetEmbed(betDetails) {
    let odds, ratio;
    if (betDetails.optionOneTotal > betDetails.optionTwoTotal) {
        odds = (betDetails.optionOneTotal / betDetails.optionTwoTotal).toFixed(2);
        ratio = `${odds} : 1`
    } else {
        odds = (betDetails.optionTwoTotal / betDetails.optionOneTotal).toFixed(2);
        ratio = `1 : ${odds}`
    }

    if (!betDetails.thumbnailUrl) {
        betDetails.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
    }

    let largestVoterOptionOne = {userId: "", bet: 0};
    let optionOneSplit;
    betDetails.optionOneVoters.forEach(voter => {
        if (voter.bet > largestVoterOptionOne.bet) {
            largestVoterOptionOne.userId = voter.userId;
            largestVoterOptionOne.bet = voter.bet;
        }
    })
    optionOneSplit = (largestVoterOptionOne.bet / betDetails.optionOneTotal).toFixed(2);

    let largestVoterOptionTwo = {userId: "", bet: 0};
    let optionTwoSplit;
    betDetails.optionTwoVoters.forEach(voter => {
        if (voter.bet > largestVoterOptionTwo.bet) {
            largestVoterOptionTwo.userId = voter.userId;
            largestVoterOptionTwo.bet = voter.bet;
        }
    })
    optionTwoSplit = (largestVoterOptionTwo.bet / betDetails.optionTwoTotal).toFixed(2);


    const embed = new EmbedBuilder()
        .setTitle(`(1) ${betDetails.optionOne} vs (2) ${betDetails.optionTwo} (${ratio})`)
        .setDescription(`${betDetails.description}\nBelow are the current bets and their respective totals: `)
        .setColor("Random")
        .setThumbnail(betDetails.thumbnailUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .addFields(
            {
                name: `1) ${betDetails.optionOne}`,
                value: `${betDetails.optionOneTotal} potatoes`,
                inline: true,
            },
            {
                name: `2) ${betDetails.optionTwo}`,
                value: `${betDetails.optionTwoTotal} potatoes`,
                inline: true,
            },
            {
                name: `${betDetails.optionOne} Largest Bet`,
                value: `${largestVoterOptionOne.bet} wins ${Math.floor(optionOneSplit*betDetails.optionTwoTotal)} potatoes (${optionOneSplit*100}%)`,
                inline: false,
            },
            {
                name: `${betDetails.optionTwo} Largest Bet`,
                value: `${largestVoterOptionTwo.bet} wins ${Math.floor(optionTwoSplit*betDetails.optionOneTotal)} potatoes (${optionTwoSplit*100}%)`,
                inline: true,
            },
        );
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
        const embed = await createBetEmbed(mostRecentBet);
        interaction.editReply({ embeds: [embed] });
    }
}