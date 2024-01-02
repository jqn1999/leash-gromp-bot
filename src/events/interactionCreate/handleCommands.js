const { devs, testServer } = require('../../config');
const getLocalCommands = require('../../utils/getLocalCommands');

module.exports = async (client, interaction) => {
    if (!interaction.isChatInputCommand) return;
    if (!interaction.member) return;

    const localCommands = getLocalCommands();

    try {
        const commandObject = localCommands.find((cmd) => cmd.name === interaction.commandName);

        if (!commandObject) return;

        if (commandObject.devOnly) {
            if (!devs.includes(interaction.member.id)) {
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
                if (!interaction.member.permissions.has(permission) && !devs.includes(interaction.member.id)) {
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

        const validChannels = ['1187561420406136843', '796873375632195605', '1188525931346792498', '1188539987118010408'];
        if (!validChannels.includes(interaction.channel.id)) {
            interaction.reply({
                content: 'This channel is not registered to run commands!',
                ephemeral: true,
            })
            return;
        }

        await commandObject.callback(client, interaction);
    } catch (e) {
        console.log(`There was an error running this command ${e}`)
    }
};