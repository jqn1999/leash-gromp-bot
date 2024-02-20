const { ApplicationCommandOptionType, EmbedBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const choices = [
    {
        name: 'Rock', emoji: '🗿', beats: 'Scissor'
    },
    {
        name: 'Scissor', emoji: '✂️', beats: 'Paper'
    },
    {
        name: 'Paper', emoji: '📰', beats: 'Rock'
    }
]

module.exports = {
    name: "rps",
    description: "Rock, paper, scissors. Challenge a player",
    options: [
        {
            name: 'player',
            description: 'Person you want to challenge',
            required: true,
            type: ApplicationCommandOptionType.User,
        },
        {
            name: 'bet-amount',
            description: 'Amount of potatoes: all | half | (amount)',
            required: true,
            type: ApplicationCommandOptionType.String,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const targetUser = interaction.options.getUser('player');
        let bet = interaction.options.get('bet-amount')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        if (targetUser.id == userId) {
            interaction.editReply(`${userDisplayName} you cannot play against yourself!`);
            return;
        } else if (targetUser.bot) {
            interaction.editReply(`${userDisplayName} you cannot play against bots!`);
            return;
        }

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        let userPotatoes = userDetails.potatoes;
        let targetUserDisplayName, targetUsername;
        if (targetUser.id) {
            const targetUserInfo = await interaction.guild.members.fetch(targetUser.id);
            if (!targetUserInfo) {
                await interaction.editReply('That user doesn\'t exist in this server.');
                return;
            }
            targetUserDisplayName = targetUserInfo.displayName;
            targetUsername = targetUserInfo.user.username;
        }
        const targetUserDetails = await dynamoHandler.findUser(targetUser.id, targetUsername);
        if (!targetUserDetails) {
            interaction.editReply(`${targetUserDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }
        let targetUserPotatoes = targetUserDetails.potatoes;

        if (bet.toLowerCase() == 'all') {
            bet = userPotatoes;
        } else if (bet.toLowerCase() == 'half') {
            bet = Math.round(userPotatoes / 2);
        } else {
            bet = Math.floor(Number(bet));
            if (isNaN(bet)) {
                interaction.editReply(`${userDisplayName}, something went wrong with your bet. Try again!`);
                return;
            }
        }

        const isBetGreaterThanZero = bet >= 1;
        if (!isBetGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only bet positive amounts! You have ${userPotatoes.toLocaleString()} potatoes left.`);
            return;
        }

        const isBetLessThanOrEqualUserAmount = bet <= userPotatoes;
        if (!isBetLessThanOrEqualUserAmount) {
            interaction.editReply(`${userDisplayName}, you do not have enough potatoes to bet ${bet.toLocaleString()} potatoes! You have ${userPotatoes.toLocaleString()} potatoes left.`);
            return;
        }

        if (targetUserPotatoes < bet) {
            interaction.editReply(`${userDisplayName} your opponent does not have enough potatoes!`);
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle(`Rock Paper Scissors\nWager: ${bet.toLocaleString()} potatoes`)
            .setDescription(`It's currently ${targetUser}'s turn.`)
            .setThumbnail('https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png')
            .setColor('Orange')
            .setTimestamp(new Date());

        const buttons = choices.map((choice) => {
            return new ButtonBuilder()
                .setCustomId(choice.name)
                .setLabel(choice.name)
                .setStyle(ButtonStyle.Primary)
                .setEmoji(choice.emoji)
        });

        const row = new ActionRowBuilder().addComponents(buttons)

        const reply = await interaction.editReply({
            content: `${targetUser}, you have been invited to a game of Rock Paper Scissors by ${interaction.user} for ${bet.toLocaleString()} potatoes.\nTo start playing, click one of the buttons below.`,
            embeds: [embed],
            components: [row]
        });

        const targetUserInteraction = await reply.awaitMessageComponent({
            filter: (i) => i.user.id === targetUser.id,
            time: 30_000,
        }).catch(async (error) => {
            embed.setDescription(`Game over. ${targetUser} did not respond in time.`)
            await reply.edit({ embeds: [embed], components: [] })
        })

        if (!targetUserInteraction) return;

        const targetUserChoice = choices.find((choice) => choice.name === targetUserInteraction.customId);

        await targetUserInteraction.reply({
            content: `You picked ${targetUserChoice.name + targetUserChoice.emoji}`,
            ephemeral: true
        });

        embed.setDescription(`It's currently ${interaction.user}'s turn.`)
        await reply.edit({
            content: `${interaction.user} it's your turn now.`,
            embeds: [embed]
        });

        const initialUserInteraction = await reply.awaitMessageComponent({
            filter: (i) => i.user.id === interaction.user.id,
            time: 30_000,
        }).catch(async (error) => {
            embed.setDescription(`Game over. ${interaction.user} did not respond in time.`)
            await reply.edit({ embeds: [embed], components: [] })
        })

        if (!initialUserInteraction) return;

        const initialUserChoice = choices.find(choice => choice.name === initialUserInteraction.customId)

        let result;

        if (targetUserChoice.beats === initialUserChoice.name) {
            result = `${targetUser} won ${bet.toLocaleString()} potatoes!`
            await dynamoHandler.addUserDatabase(targetUser.id, "potatoes", bet)
            await dynamoHandler.addUserDatabase(userId, "potatoes", -bet)
            if (targetUser.avatar) {
                embed.setThumbnail(`https://cdn.discordapp.com/avatars/${targetUser.id}/${targetUser.avatar}.png`)
            }
        }

        if (initialUserChoice.beats === targetUserChoice.name) {
            result = `${interaction.user} won ${bet.toLocaleString()} potatoes!`
            await dynamoHandler.addUserDatabase(targetUser.id, "potatoes", -bet)
            await dynamoHandler.addUserDatabase(userId, "potatoes", bet)
            if (interaction.user.avatar) {
                embed.setThumbnail(`https://cdn.discordapp.com/avatars/${userId}/${interaction.user.avatar}.png`)
            }
        }

        if (targetUserChoice.name === initialUserChoice.name) {
            result = `It was a tie!`
        }

        embed.setDescription(`${targetUser} picked ${targetUserChoice.name + targetUserChoice.emoji}\n
        ${interaction.user} picked ${initialUserChoice.name + initialUserChoice.emoji}\n\n
        ${result}`)

        reply.edit({
            embeds: [embed],
            components: []
        })
    }
}