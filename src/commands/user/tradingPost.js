const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const tradingPostFactory = require("../../utils/tradingPostFactory");
const { Potions } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const BUY_PREFIX = 'trading_post_buy_';

// One button per catalog entry (3 in v1, well under Discord's 5-per-row cap) — disabled
// only when the caller can't afford it, same "a doomed click should never even be possible"
// precedent companionShop.js/companionMarket.js already set. A potion that would be
// REJECTED by the purchase rule (a different effect type already active) is deliberately
// left enabled rather than disabled — that rejection needs its own clear message naming
// what's active and when it expires (see tradingPostFactory.attemptPurchasePotion), which a
// silently-disabled button can't convey.
function buildBuyRow(userDetails) {
    const buttons = Potions.CATALOG.map((potion) => new ButtonBuilder()
        .setCustomId(`${BUY_PREFIX}${potion.id}`)
        .setLabel(`Buy ${potion.name} (${potion.pricePotatoes.toLocaleString()})`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(userDetails.potatoes < potion.pricePotatoes)
    );
    return new ActionRowBuilder().addComponents(buttons);
}

module.exports = {
    name: "trading-post",
    description: "Browse and buy temporary potions from your Guild's or the Merc Faction's Trading Post",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        let userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const scope = tradingPostFactory.resolveTradingPostScope(userDetails);
        if (!scope) {
            interaction.editReply(`${userDisplayName}, you need to be in a guild or be a mercenary to visit a Trading Post!`);
            return;
        }

        // Guild variant needs the guild's own display name for the embed title — the merc
        // variant has no name to look up (there's only one Merc Faction).
        let scopeLabel = null;
        if (tradingPostFactory.isScopeGuild(scope)) {
            const guild = await dynamoHandler.findGuildById(userDetails.guildId);
            if (!guild) {
                interaction.editReply(`${userDisplayName}, there was an error looking for your guild! Check your input and try again!`);
                return;
            }
            scopeLabel = guild.guildName;
        }

        const renderEmbed = (details) => embedFactory.createTradingPostEmbed(userDisplayName, userId, interaction.user.avatar, scope, scopeLabel, details);

        const embed = renderEmbed(userDetails);
        const components = [buildBuyRow(userDetails)];
        const reply = await interaction.editReply({ embeds: [embed], components });

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            if (!clicked.customId.startsWith(BUY_PREFIX)) {
                continue;
            }

            await clicked.deferUpdate();
            const potionId = clicked.customId.slice(BUY_PREFIX.length);
            const result = await tradingPostFactory.attemptPurchasePotion(userId, username, potionId);

            // A successful purchase closes the shop out — direct instruction ("make trading
            // post embed go away when purchase happens"). Only one potion can ever be active
            // at once and a same-type buy just extends it, so there's nothing left to browse
            // for immediately afterward; a REJECTED purchase (wrong effect type active, can't
            // afford it) leaves the shop open instead, same as before, so the player can pick
            // a different potion or top up without re-running the command.
            if (result.ok) {
                await interaction.editReply({
                    content: `${userDisplayName}, ${result.message}`,
                    embeds: [],
                    components: []
                });
                break;
            }

            userDetails = await dynamoHandler.findUser(userId, username);
            await interaction.editReply({
                content: `${userDisplayName}, ${result.message}`,
                embeds: [renderEmbed(userDetails)],
                components: [buildBuyRow(userDetails)]
            });
        }
    }
}
