const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const { sortTowerLeaderboardEntries } = require("../../utils/towerLeaderboardFactory");
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
    // Ranking order: floor, then elitesKilled, then potatoes — see
    // towerLeaderboardFactory.js's sortTowerLeaderboardEntries, shared with the actual
    // payout ranking so this preview can't drift onto a different ordering.
    const sorted = sortTowerLeaderboardEntries(entries);

    // Titles (systems/titles.md, "more places titles show up" pass, 2026-09-27) — stored
    // leaderboard entries are a payout-time snapshot with no equippedTitle field, and
    // deliberately isn't given one (a title picked AFTER today's run should still show up
    // here, the same live-read behavior every other leaderboard already has) — fetched live
    // for only the top 5 actually rendered, not the full `sorted` array, to keep this cheap.
    const topFive = sorted.slice(0, 5);
    const topFiveDetails = await Promise.all(topFive.map(e => dynamoHandler.findUser(e.userId, e.username)));
    topFive.forEach((entry, i) => { entry.equippedTitle = topFiveDetails[i]?.equippedTitle || null; });

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