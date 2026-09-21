const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bet } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// /manage-bet — one Administrator-gated command grouping the 3 admin-only betting actions
// (2026-09-21, command-cap headroom pass — see roadmap.md). Mirrors /admin's own
// Subcommand-type shape (each action keeps a genuinely different option set, so this uses
// Discord Subcommand entries rather than /leaderboard's single-choice-option shape) rather
// than /leaderboard's, since create/end/lock each need their own distinct required options
// (or none). /bet and /current-bet are deliberately NOT folded in here — /bet is the
// frequent, ungated player action, and /current-bet is a normal-player read command; folding
// either into an Administrator-only command would lock ordinary players out of commands they
// can run today. Each subcommand's own logic is preserved verbatim from its original file —
// only the file's shape (module boundary, command name -> Subcommand name) changed.
function calculateBetBaseAmount(serverTotal) {
    totalBetBase = Math.round(serverTotal * Bet.PERCENT_OF_SERVER_TOTAL_TO_BASE / 10000) * 10000
    const actualBetBase = totalBetBase > 1000000 ? 1000000 : totalBetBase
    return actualBetBase;
}

async function runCreate(client, interaction) {
    const optionOne = interaction.options.get('option-1').value;
    const optionTwo = interaction.options.get('option-2').value;
    const description = interaction.options.get('description').value;
    let thumbnailUrl = interaction.options.get('thumbnail-url')?.value;
    if (!thumbnailUrl) thumbnailUrl = "";

    const mostRecentBet = await dynamoHandler.getMostRecentBet();
    if (mostRecentBet && mostRecentBet.isActive == true) {
        interaction.reply({
            content: "There is already an active bet!",
            ephemeral: true
        })
        return;
    }

    const total = await dynamoHandler.getCachedServerTotal();
    const baseAmount = calculateBetBaseAmount(total);
    const nextBetId = mostRecentBet ? mostRecentBet.betId + 1 : 1;
    await dynamoHandler.addBet(nextBetId, optionOne, optionTwo, description, thumbnailUrl, baseAmount);
    interaction.reply(`New bet has been added for ${optionOne} vs ${optionTwo}`)
}

async function handleBetConclusion(winningList, winningSideTotal, losingList, losingSideTotal, betBaseAmount) {
    await Promise.all(winningList.map(async userBet => {
        const user = await dynamoHandler.findUser(userBet.userId, "");
        if (!user) {
            interaction.editReply('User was missing for some reason');
            return;
        }
        const originalPotatoes = user.potatoes

        let userSplit = userBet.bet + Math.floor(userBet.bet/(winningSideTotal - betBaseAmount)*losingSideTotal);
        let userId = user.userId;
        let newUserPotatoes = user.potatoes + userSplit;
        let userTotalEarnings = user.totalEarnings + Math.floor(userBet.bet/(winningSideTotal - betBaseAmount)*losingSideTotal);
        await dynamoHandler.updateUserDatabase(userId, "potatoes", newUserPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);
        console.log(`handleBetConclusionWinner: ${user.username} bet ${userBet.bet} potatoes and won ${userSplit - userBet.bet} potatoes. `
                    + `They went from ${originalPotatoes} potatoes to ${newUserPotatoes} potatoes.`)
    }));
    await Promise.all(losingList.map(async userBet => {
        const user = await dynamoHandler.findUser(userBet.userId, "");
        if (!user) {
            interaction.editReply('User was missing for some reason');
            return;
        }

        let userId = user.userId;
        let userTotalLosses = user.totalLosses - userBet.bet;
        await dynamoHandler.updateUserDatabase(userId, "totalLosses", userTotalLosses);
        console.log(`handleBetConclusionLoser: ${user.username} bet and lost ${userBet.bet} potatoes.`)
    }));
}

async function runEnd(client, interaction) {
    const winner = interaction.options.get('winner').value;

    const mostRecentBet = await dynamoHandler.getMostRecentBet();
    if (!mostRecentBet.isActive) {
        interaction.reply({
            content: `There is no currently active bet to end`,
            ephemeral: true
        });
        return;
    }

    await interaction.deferReply();
    const optionOneTotal = mostRecentBet.optionOneTotal;
    const optionOneVoters = mostRecentBet.optionOneVoters;
    const optionTwoTotal = mostRecentBet.optionTwoTotal;
    const optionTwoVoters = mostRecentBet.optionTwoVoters;
    const betBaseAmount = mostRecentBet.baseAmount;

    let winningOption;
    if (winner == 1) {
        winningOption = mostRecentBet.optionOne;
        await handleBetConclusion(optionOneVoters, optionOneTotal, optionTwoVoters, optionTwoTotal, betBaseAmount);
    } else {
        winningOption = mostRecentBet.optionTwo;
        await handleBetConclusion(optionTwoVoters, optionTwoTotal, optionOneVoters, optionOneTotal, betBaseAmount);
    }
    await dynamoHandler.endCurrentBet(mostRecentBet.betId, winningOption);
    const embed = embedFactory.createBetEndEmbed(mostRecentBet, winningOption);
    interaction.editReply({ embeds: [embed] });
}

async function runLock(client, interaction) {
    await interaction.deferReply();
    const mostRecentBet = await dynamoHandler.getMostRecentBet();
    if (mostRecentBet && mostRecentBet.isActive == false) {
        interaction.editReply({
            content: "There is no active bet to lock. Please check again.",
            ephemeral: true
        });
        return;
    }

    if (mostRecentBet.isLocked) {
        interaction.editReply({
            content: "The active bet is already locked.",
            ephemeral: true
        });
        return;
    }
    const betId = mostRecentBet.betId;
    const optionOne = mostRecentBet.optionOne;
    const optionTwo = mostRecentBet.optionTwo;
    await dynamoHandler.lockCurrentBet(betId);
    interaction.editReply(`${optionOne} vs ${optionTwo} betting has now been locked! No more bets may be entered!`)
}

module.exports = {
    name: "manage-bet",
    description: "Admin tools for the prediction-market betting system (subcommands)",
    devOnly: false,
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    options: [
        {
            name: 'create',
            description: 'Creates a new bet if there is no active bet',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'option-1',
                    description: 'First option for new bet',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                },
                {
                    name: 'option-2',
                    description: 'Second option for new bet',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                },
                {
                    name: 'description',
                    description: 'Describe the bet',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                },
                {
                    name: 'thumbnail-url',
                    description: 'Image for the new bet',
                    required: false,
                    type: ApplicationCommandOptionType.String,
                }
            ],
        },
        {
            name: 'end',
            description: 'Ends the current bet (if active)',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'winner',
                    description: 'Winning option to be selected',
                    required: true,
                    type: ApplicationCommandOptionType.Number,
                    choices: [
                        { name: '1', value: 1 },
                        { name: '2', value: 2 }
                    ]
                }
            ],
        },
        {
            name: 'lock',
            description: 'Locks the current bet and stops further bets from entering',
            type: ApplicationCommandOptionType.Subcommand,
        },
    ],
    callback: async (client, interaction) => {
        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            case 'create':
                await runCreate(client, interaction);
                break;
            case 'end':
                await runEnd(client, interaction);
                break;
            case 'lock':
                await runLock(client, interaction);
                break;
        }
    },
    // Exported individually for direct unit testing, same "export the inner logic, not just
    // the dispatcher" precedent /admin's own giveCallback/resetTowerCallback/etc. set.
    createCallback: runCreate,
    endCallback: runEnd,
    lockCallback: runLock,
}
