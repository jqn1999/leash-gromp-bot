const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");
const { isStarchBuyingWindow, getActiveStarchBuffPercent } = require("../../utils/starchFactory");
const { Starch } = require("../../utils/constants");
const companionFactory = require("../../utils/companionFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const spudKeepFactory = require("../../utils/spudKeepFactory");

module.exports = {
    name: "sell-starch",
    description: "Sell starches at today's price",
    options: [
        {
            name: 'starch-amount',
            description: 'Number of starches to sell: all | half | (amount)',
            required: true,
            type: ApplicationCommandOptionType.String,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;   

        // check date
        if (isStarchBuyingWindow()) {
            interaction.editReply(`${userDisplayName}, this is a buying period for starches (Monday 10am-10pm, or Thursday 10am-10pm EST) — selling reopens once that window closes!`);
            return;
        }

        // get starch number and basic stuff
        let starches = interaction.options.get('starch-amount')?.value
        let userPotatoes = userDetails.potatoes;
        let userStarches = userDetails.starches;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;

        // error checking
        if (starches.toLowerCase() == 'all') {
            starches = userStarches;
        } else if (starches.toLowerCase() == 'half') {
            starches = Math.round(userStarches/2);
        } else{
            starches = Math.floor(Number(starches));
            if (isNaN(starches)) {
                interaction.editReply(`${userDisplayName}, something went wrong with starch amount. Try again!`);
                return;
            }
        }

        const isStarchGreaterThanZero = starches >= 1;
        if (!isStarchGreaterThanZero) {
            interaction.editReply(`${userDisplayName}, you can only sell positive amounts!`);
            return;
        }

        const sellingTooMuch = starches > userStarches;
        if(sellingTooMuch){
            interaction.editReply(`${userDisplayName}, you can only sell up to ${userStarches.toLocaleString()} starches!`);
            return;
        }

        // sell
        const details = await dynamoHandler.getStatDatabase("starch")
        const buyPrice = details.starch_buy
        // Mole/Elder Rootbeard — folded straight into the per-unit price so the embed's
        // displayed sellPrice and the actual payout never disagree. Yamsalot's World Boss
        // buff (systems/raids-and-world-events.md#server-wide-buff) stacks additively in
        // the same bracket, same convention this codebase already uses for combining
        // multiple percentage bonuses (e.g. workFactory.js's guild+companion+rebirth
        // multiplier terms) — 0 whenever no such buff is currently live.
        const starchSellBonusPercent = companionFactory.getActivePerkValue(userDetails, "starchSellBonusPercent");
        const starchBuffPercent = await getActiveStarchBuffPercent();
        const sellPrice = details.starch_sell * (1 + starchSellBonusPercent + starchBuffPercent)

        const buyValue = buyPrice * starches
        const sellValue = Math.round(sellPrice * starches)
        // Starch.SELL_TAX_PERCENT (5%, new 2026-08-30) — taken off the gross sale, same
        // "seller nets less, house gets the rest" shape every other tax in this game uses.
        // profitOrLoss is computed off the NET amount, since that's what the seller
        // actually walks away with.
        const starchSaleTax = Math.floor(sellValue * Starch.SELL_TAX_PERCENT)
        const netSellValue = sellValue - starchSaleTax
        const profitOrLoss = netSellValue - buyValue

        userPotatoes += netSellValue
        userStarches -= starches

        // Non-work-focused companion leveling (Mole/Rootcarver/Elder Rootbeard's
        // starchSellBonusPercent) — /sell-starch has no cooldown to scale a grant against
        // the way Bounty/Heist do, so the grant scales by the resource VALUE MOVED in this
        // call (starches sold) instead of a flat per-call amount. Restricted by PERK TYPE,
        // not a specific companion id — any equipped companion carrying
        // starchSellBonusPercent trains here.
        const leveledCompanions = companionFactory.levelActiveCompanion(
            userDetails.companions,
            companionFactory.getStarchSellWorkCountGrant(starches),
            null,
            "starchSellBonusPercent"
        );
        // "did the equipped companion actually train" readout for the result embed — see
        // companionFactory.getAppliedCompanionXpGain's own comment.
        const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, leveledCompanions);
        const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;

        await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
        await dynamoHandler.updateUserDatabase(userId, "starches", userStarches);
        await dynamoHandler.updateUserDatabase(userId, "companions", leveledCompanions);
        if (starchSaleTax > 0) {
            // Spud Keep (systems/spud-keep.md) — while a holder is live, a share of this
            // tax is redirected to the accruing pot instead of the house account
            // (already potato-denominated here, no currency conversion needed); a no-op
            // (100% to the house, byte-identical to before) whenever no holder is live.
            const { houseAmount, potAmount } = await spudKeepFactory.splitTaxForSpudKeepPot(starchSaleTax);
            await dynamoHandler.addUserDatabase(client.user.id, "potatoes", houseAmount);
            await spudKeepFactory.creditSpudKeepPot(potAmount);
        }
        if (profitOrLoss > 0) {
            await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings + profitOrLoss);
        } else if (profitOrLoss < 0) {
            await dynamoHandler.updateUserDatabase(userId, "totalLosses", userTotalLosses + profitOrLoss);
        }
        embed = embedFactory.createBuyOrSellStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes,
            userStarches, 'sell', starches, sellPrice, netSellValue, starchSaleTax, companionXpGained, companionName);
        interaction.editReply({ embeds: [embed] });
    }
}