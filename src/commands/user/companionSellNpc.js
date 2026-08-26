const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionMarketFactory = require("../../utils/companionMarketFactory");

module.exports = {
    name: "companion-sell-npc",
    description: "Instantly sell a companion to an NPC for well under market value",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'companion',
            description: 'Which companion to sell',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    // Same reasoning as companionSell.js's autocomplete — filters to what the invoking
    // user actually owns and isn't scavenging, one choice per independently-leveled owned
    // instance (value = instanceId, not companionId). Unlike /companion-sell, a companion
    // already listed on the market is NOT excluded here (validateNpcSaleRequest doesn't
    // check the market either) — this command sells straight to an NPC, so an active
    // listing isn't a relevant conflict the way it is for creating a second listing.
    autocomplete: async (client, interaction) => {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const userId = interaction.user.id;
        const username = interaction.user.username;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            await interaction.respond([]);
            return;
        }

        const choices = (userDetails.companions?.owned ?? [])
            .filter(entry => !companionFactory.isScavenging(userDetails, entry.instanceId))
            .map(entry => ({ entry, companion: companionFactory.getCompanionById(entry.id) }))
            .filter(({ companion }) => companion && companion.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(({ entry, companion }) => ({
                name: `${companion.name} (Lv. ${companionFactory.getCompanionLevel(entry.workCount)})`,
                value: entry.instanceId
            }));

        await interaction.respond(choices);
    },
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const instanceId = interaction.options.get('companion')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const validation = companionMarketFactory.validateNpcSaleRequest(userDetails, instanceId);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }
        const { companion, level } = validation;
        const { min, max } = companionMarketFactory.getNpcSaleRange(companion, level);

        const reply = await interaction.editReply({
            content: `${userDisplayName}, sell ${companion.name} (level ${level}) to an NPC for somewhere between **${min.toLocaleString()}** and **${max.toLocaleString()}** potatoes (rolled when you confirm)? This is well under what it could fetch on /companion-sell — only do this if you don't want to wait for a buyer. It will leave your owned companions entirely, no refunds.`,
            components: [buildConfirmCancelRow('companion_sell_npc', 'Sell it')]
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
        const revalidation = companionMarketFactory.validateNpcSaleRequest(freshUserDetails, instanceId);
        if (!revalidation.valid) {
            await interaction.editReply({ content: `${userDisplayName}, ${revalidation.error}`, components: [] });
            return;
        }

        const salePrice = companionMarketFactory.rollNpcSalePrice(revalidation.companion, revalidation.level);
        const updatedCompanions = companionMarketFactory.removeFromOwned(freshUserDetails, instanceId);

        await dynamoHandler.updateUserFields(userId, {
            potatoes: freshUserDetails.potatoes + salePrice,
            companions: updatedCompanions
        });

        await interaction.editReply({ content: `${userDisplayName}, sold ${revalidation.companion.name} to an NPC for ${salePrice.toLocaleString()} potatoes.`, components: [] });
    }
}
