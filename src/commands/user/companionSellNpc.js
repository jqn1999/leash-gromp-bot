const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionMarketFactory = require("../../utils/companionMarketFactory");
const { Companions } = require("../../utils/constants");

function buildConfirmRow() {
    const confirmButton = new ButtonBuilder()
        .setCustomId('companion_sell_npc_confirm')
        .setLabel('Sell it')
        .setStyle(ButtonStyle.Danger);
    const cancelButton = new ButtonBuilder()
        .setCustomId('companion_sell_npc_cancel')
        .setLabel('Back out')
        .setStyle(ButtonStyle.Secondary);
    return new ActionRowBuilder().addComponents(confirmButton, cancelButton);
}

module.exports = {
    name: "companion-sell-npc",
    description: "Instantly sell a companion to an NPC for well under market value (use /companion-sell to list it for other players instead)",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'companion',
            description: 'Which companion to sell',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: Companions.map(companion => ({ name: companion.name, value: companion.id }))
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const companionId = interaction.options.get('companion')?.value;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const validation = companionMarketFactory.validateNpcSaleRequest(userDetails, companionId);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }
        const { companion, level } = validation;
        const { min, max } = companionMarketFactory.getNpcSaleRange(companion, level);

        const reply = await interaction.editReply({
            content: `${userDisplayName}, sell ${companion.name} (level ${level}) to an NPC for somewhere between **${min.toLocaleString()}** and **${max.toLocaleString()}** potatoes (rolled when you confirm)? This is well under what it could fetch on /companion-sell — only do this if you don't want to wait for a buyer. It will leave your owned companions immediately, no refunds.`,
            components: [buildConfirmRow()]
        });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'companion_sell_npc_cancel') {
            await (confirmation ? confirmation.update({ content: `${userDisplayName}, sale cancelled.`, components: [] }) : reply.edit({ content: `${userDisplayName}, sale timed out.`, components: [] })).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-fetch — time passed during the confirm prompt, and the companion must still
        // be owned (not sold/listed elsewhere) right before it's removed. Level is
        // re-derived fresh too, in case more /work happened with it active in the meantime.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        const revalidation = companionMarketFactory.validateNpcSaleRequest(freshUserDetails, companionId);
        if (!revalidation.valid) {
            await interaction.editReply({ content: `${userDisplayName}, ${revalidation.error}`, components: [] });
            return;
        }

        const salePrice = companionMarketFactory.rollNpcSalePrice(revalidation.companion, revalidation.level);
        const updatedCompanions = companionMarketFactory.removeFromOwned(freshUserDetails, companionId);

        await dynamoHandler.updateUserFields(userId, {
            potatoes: freshUserDetails.potatoes + salePrice,
            companions: updatedCompanions
        });

        await interaction.editReply({ content: `${userDisplayName}, sold ${revalidation.companion.name} to an NPC for ${salePrice.toLocaleString()} potatoes.`, components: [] });
    }
}
