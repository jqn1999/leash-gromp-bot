const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { worldBossMobs } = require("../../utils/worldFactory")
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 10;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// join-world-raid + current-world-raid folded in here (2026-09-21, command-cap headroom
// pass — see roadmap.md) from their own top-level src/commands/misc/joinWorldRaid.js and
// currentWorldRaid.js files, now deleted. Both took zero options and are a genuine
// "one-shot action + read-only status" pair for the SAME activity, so this mirrors
// /leaderboard's single-required-String-choice dispatch shape rather than Subcommand type.
// Behavior/output of both is unchanged.
async function runJoinWorldRaid(interaction) {
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    let world = await dynamoHandler.getStatDatabase("world")
    let worldList = world.world_list

    if (!world.world_active) {
        interaction.editReply(`${userDisplayName}, there is no active raid to join!`);
        return;
    }

    if (worldList.filter(currentMember => currentMember.id == userId).length > 0) {
        interaction.editReply(`${userDisplayName} you have already joined this world raid.`);
        return;
    }

    worldList.push({id: userId, username: username})
    await dynamoHandler.updateStatDatabase("world", "world_list", worldList)
    interaction.editReply(`${userDisplayName} you have joined the world raid! ${worldList.length.toLocaleString()} member${worldList.length == 1 ? '' : 's'} in so far — check /world-raid current-world-raid for the full roster and total multiplier.`);
}

async function runCurrentWorldRaid(interaction) {
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    let world = await dynamoHandler.getStatDatabase("world")
    let worldList = world.world_list
    let worldIndex = world.world_index

    if (!world.world_active) {
        interaction.editReply(`${userDisplayName}, there is no active raid!`);
        return;
    }

    let totalMultiplier = 0;
    let raidList = [];
    const worldMemberDetails = await Promise.all(worldList.map(element => dynamoHandler.findUser(element.id, element.username)));
    for (const [index, element] of worldList.entries()) {
        const memberDetails = worldMemberDetails[index];
        if (!memberDetails) {
            interaction.editReply(`${element.username} could not be looked up due to a database error, please try again!`);
            return;
        }

        const user = {
            name: `${index + 1}) ${element.username}`,
            value: `${memberDetails.workMultiplierAmount.toFixed(2)}x Multiplier`,
            inline: false,
        };
        raidList.push(user);
        totalMultiplier += memberDetails.workMultiplierAmount;
    }

    const bossName = worldBossMobs[worldIndex].name
    const thumbnail = worldBossMobs[worldIndex].thumbnailUrl

    const pages = chunkArray(raidList, PAGE_SIZE);
    const renderPage = (pageIndex) => embedFactory.createWorldRaidPageEmbed(pages[pageIndex], pageIndex, pages.length, totalMultiplier, bossName, thumbnail);

    const embed = renderPage(0);
    const components = pages.length > 1 ? [buildPaginationRow('world_raid', 0, pages.length)] : [];
    const reply = await interaction.editReply({ embeds: [embed], components: components });

    await runPaginatedReply(reply, interaction, 'world_raid', pages.length, renderPage);
}

module.exports = {
    name: "world-raid",
    description: "Join or check the status of the current world raid",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'world-raid-option',
            description: 'Which world raid action to run',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'join-world-raid',
                    value: 'join-world-raid'
                },
                {
                    name: 'current-world-raid',
                    value: 'current-world-raid'
                }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const worldRaidChoice = interaction.options.get('world-raid-option')?.value;

        switch (worldRaidChoice) {
            case 'join-world-raid':
                await runJoinWorldRaid(interaction);
                break;
            case 'current-world-raid':
                await runCurrentWorldRaid(interaction);
                break;
        }
    },
    // Exported for direct unit testing, same precedent /admin's own subcommand functions
    // and /leaderboard's towerLeaderboardCallback already set.
    joinWorldRaidCallback: runJoinWorldRaid,
    currentWorldRaidCallback: runCurrentWorldRaid,
}
