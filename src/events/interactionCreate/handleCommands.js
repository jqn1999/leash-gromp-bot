const { awsConfigurations } = require("../../utils/constants");
const getLocalCommands = require('../../utils/getLocalCommands');
const dynamoHandler = require("../../utils/dynamoHandler");
const { getUserInteractionDetails } = require("../../utils/helperCommands");
const { DailyStreakFactory } = require("../../utils/dailyStreakFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const dailyStreakFactory = new DailyStreakFactory();
const achievementFactory = new AchievementFactory();
const embedFactory = new EmbedFactory();

// Auto-triggered on a user's first successful command interaction each day — no
// dedicated /daily command. Failures here must never block the command itself, so
// every step is defensively caught and logged rather than thrown.
async function processDailyStreak(interaction) {
    try {
        const [userId, username] = getUserInteractionDetails(interaction);
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) return null;
        return await dailyStreakFactory.processLogin(userDetails);
    } catch (e) {
        console.log(`processDailyStreak error: ${e}`);
        return null;
    }
}

async function notifyDailyStreak(interaction, streakResult, userDisplayName) {
    if (!streakResult || !(interaction.replied || interaction.deferred)) return;
    try {
        const streakEmbed = embedFactory.createDailyStreakEmbed(userDisplayName, streakResult.streak, streakResult.reward);
        await interaction.followUp({ embeds: [streakEmbed] });

        const [userId, username] = getUserInteractionDetails(interaction);
        const updatedUserDetails = await dynamoHandler.findUser(userId, username);
        if (!updatedUserDetails) return;
        const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            await interaction.followUp({ embeds: achievementEmbeds });
        }
    } catch (e) {
        console.log(`notifyDailyStreak error: ${e}`);
    }
}

module.exports = async (client, interaction) => {
    if (!interaction.isChatInputCommand) return;
    if (!interaction.member) return;

    const localCommands = getLocalCommands();

    try {
        const commandObject = localCommands.find((cmd) => cmd.name === interaction.commandName);

        if (!commandObject) return;

        if (commandObject.devOnly) {
            if (!awsConfigurations.devs.includes(interaction.member.id)) {
                interaction.reply(
                    {
                        content: 'Only developers are allowed to run this command',
                        ephemeral: true
                    }
                );
                return;
            }
        }

        if (commandObject.testOnly) {
            interaction.reply(
                {
                    content: 'This command cannot be run here',
                    ephemeral: true
                }
            );
            return;
        }

        if (commandObject.permissionsRequired?.length) {
            for (const permission of commandObject.permissionsRequired) {
                if (!interaction.member.permissions.has(permission) && !awsConfigurations.devs.includes(interaction.member.id)) {
                    interaction.reply({
                        content: 'Not enough permissions.',
                        ephemeral: true,
                    });
                    return;
                }
            }
        }

        if (commandObject.botPermissions?.length) {
            for (const permission of commandObject.botPermissions) {
                const bot = interaction.guild.members.me;

                if (!bot.permissions.has(permission)) {
                    interaction.reply({
                        content: "I don't have enough permissions.",
                        ephemeral: true,
                    });
                    return;
                }
            }
        }

        const validChannels = ['1187561420406136843', '796873375632195605', '1188525931346792498', '1188539987118010408','1203822914437124188'];
        if (!validChannels.includes(interaction.channel.id)) {
            interaction.reply({
                content: 'This channel is not registered to run commands!',
                ephemeral: true,
            })
            return;
        }

        const streakResultPromise = processDailyStreak(interaction);

        await commandObject.callback(client, interaction);

        const [, , userDisplayName] = getUserInteractionDetails(interaction);
        await notifyDailyStreak(interaction, await streakResultPromise, userDisplayName);
    } catch (e) {
        console.log(`There was an error running this command ${e}`)
    }
};