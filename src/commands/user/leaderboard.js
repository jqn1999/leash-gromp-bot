const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

function findUserIndex(allUsers, userId) {
    let index = 0;
    let foundFlag = false;
    allUsers.forEach(user => {
        if (user.userId == userId) {
            foundFlag = true;
        } else if (foundFlag == false) {
            index += 1
        }
    })
    return index
}

// tower-leaderboard folded in here (2026-09-20, command-cap headroom pass — see
// roadmap.md) from its own top-level src/commands/tower/tower-leaderboard.js file, which
// is now deleted. Behavior/output is unchanged — this is the same
// "several read-only report views under one command" shape user-leaderboard/
// guild-leaderboard/starch-leaderboard/mercenary-leaderboard already used, just with a 5th
// choice added, not a new consolidation mechanism.
async function runTowerLeaderboard(interaction) {
    const entries = await dynamoHandler.getTowerLeaderboard();
    const sorted = [...entries].sort((a, b) => b.floor - a.floor);
    const embed = embedFactory.createTowerLeaderboardEmbed(sorted);
    interaction.editReply({ embeds: [embed] });
}

module.exports = {
    name: "leaderboard",
    description: "Displays the leaderboard for your given choice",
    deleted: false,
    options: [
        {
            name: 'leaderboard-option',
            description: 'Which leaderboard to display',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'user-leaderboard',
                    value: 'user-leaderboard'
                },
                {
                    name: 'guild-leaderboard',
                    value: 'guild-leaderboard'
                },
                {
                    name: 'starch-leaderboard',
                    value: 'starch-leaderboard'
                },
                {
                    name: 'mercenary-leaderboard',
                    value: 'mercenary-leaderboard'
                },
                {
                    name: 'tower-leaderboard',
                    value: 'tower-leaderboard'
                }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let embed;
        const leaderboardChoice = interaction.options.get('leaderboard-option')?.value;

        switch (leaderboardChoice) {
            case 'user-leaderboard':
                const sortedUsers = await dynamoHandler.getSortedUsers();
                const totalPotatoes = await dynamoHandler.getServerTotal();
                const userIndex = findUserIndex(sortedUsers, interaction.user.id);
                embed = embedFactory.createUserLeaderboardEmbed(sortedUsers, totalPotatoes, userIndex);
                interaction.editReply({ embeds: [embed] });
                break;
            case 'guild-leaderboard':
                const sortedGuildList = await dynamoHandler.getSortedGuildsByLevelAndRaidCount();
                embed = embedFactory.createGuildLeaderboardEmbed(sortedGuildList);
                interaction.editReply({ embeds: [embed] });
                break;
            case 'starch-leaderboard':
                const sortedUserStarches = await dynamoHandler.getSortedUserStarches();
                const totalStarches = await dynamoHandler.getServerTotalStarches();
                const userStarchIndex = findUserIndex(sortedUserStarches, interaction.user.id);
                embed = embedFactory.createUserStarchLeaderboardEmbed(sortedUserStarches, totalStarches, userStarchIndex);
                interaction.editReply({ embeds: [embed] });
                break;
            case 'mercenary-leaderboard':
                const sortedMercs = await dynamoHandler.getSortedMercenariesByBountyWins();
                // findUserIndex assumes the caller is present in the array — a non-mercenary
                // (or 0-win mercenary) never is, since the sorted list excludes 0-win users
                // entirely, so guard with an explicit membership check first rather than
                // trusting findUserIndex's own fallback (it'd return sortedMercs.length).
                const isRankedMerc = sortedMercs.some(merc => merc.userId == interaction.user.id);
                const mercIndex = isRankedMerc ? findUserIndex(sortedMercs, interaction.user.id) : -1;
                embed = embedFactory.createMercenaryLeaderboardEmbed(sortedMercs, mercIndex);
                interaction.editReply({ embeds: [embed] });
                break;
            case 'tower-leaderboard':
                await runTowerLeaderboard(interaction);
                break;
        }
    },
    // Exported for direct unit testing, same precedent /admin's own subcommand functions
    // just set (giveCallback, resetTowerCallback, etc.) for exporting inner logic alongside
    // the dispatcher.
    towerLeaderboardCallback: runTowerLeaderboard,
}