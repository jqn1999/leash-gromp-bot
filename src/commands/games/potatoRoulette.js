const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, parseAndValidateBet } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const { Roulette } = require("../../utils/constants");
const embedFactory = new EmbedFactory();

// American double-zero roulette's 38-pocket structure (see Roulette in constants.js):
// 0-17 -> golden (18 pockets), 18-35 -> dirt (18 pockets), the remaining 2 -> rotten
// (rare, 2/38 — bettable since 2026-08-31 at Roulette.ROTTEN_PAYOUT_MULTIPLIER, see
// handleWinningBet below). Deliberately computed from POCKET_COUNT/GOLDEN_POCKETS/
// DIRT_POCKETS rather than hardcoding "36-37" so the rotten-pocket count can't drift out
// of sync if only one of the other two constants is ever edited.
function spinWheel() {
    const pocketIndex = Math.floor(Math.random() * Roulette.POCKET_COUNT);
    if (pocketIndex < Roulette.GOLDEN_POCKETS) return 'golden';
    if (pocketIndex < Roulette.GOLDEN_POCKETS + Roulette.DIRT_POCKETS) return 'dirt';
    return 'rotten';
}

// A golden/dirt win pays the full bet as profit (1:1, stake untouched, no tax line) — the
// 2 rotten pockets alone are the house's 5.26% edge on that bet, per the technical design
// in roadmap.md. A rotten win instead pays Roulette.ROTTEN_PAYOUT_MULTIPLIER (17:1) — the
// SAME 5.26% house edge, just expressed as a bigger payout for a rarer (2/38) outcome
// instead of even money for a common (18/38) one. See Roulette's own comment in
// constants.js for the fairness derivation.
async function handleWinningBet(bet, userId, userPotatoes, userTotalEarnings, rouletteStats, pocketColor, colorSelected, interaction) {
    const payoutMultiplier = colorSelected === 'rotten' ? Roulette.ROTTEN_PAYOUT_MULTIPLIER : 1;
    const profit = bet * payoutMultiplier;
    userPotatoes += profit;
    userTotalEarnings += profit;
    await dynamoHandler.updateStatDatabase('roulette', 'totalPayout', rouletteStats.totalPayout + profit);
    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
    await dynamoHandler.updateUserDatabase(userId, "totalEarnings", userTotalEarnings);
    const embed = embedFactory.createPotatoRouletteEmbed(pocketColor, colorSelected, rouletteStats.goldenCount, rouletteStats.dirtCount, rouletteStats.rottenCount, userPotatoes, profit);
    interaction.editReply({ embeds: [embed] });
}

async function handleLosingBet(bet, userId, userPotatoes, userTotalLosses, rouletteStats, pocketColor, colorSelected, interaction) {
    userPotatoes -= bet;
    userTotalLosses -= bet;
    await dynamoHandler.updateStatDatabase('roulette', 'totalReceived', rouletteStats.totalReceived - bet);
    await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
    await dynamoHandler.updateUserDatabase(userId, "totalLosses", userTotalLosses);
    const embed = embedFactory.createPotatoRouletteEmbed(pocketColor, colorSelected, rouletteStats.goldenCount, rouletteStats.dirtCount, rouletteStats.rottenCount, userPotatoes, -bet);
    interaction.editReply({ embeds: [embed] });
}

module.exports = {
    name: "potato-roulette",
    description: "Bet on golden, dirt, or rotten (rare, higher payout) in a 38-pocket potato wheel.",
    options: [
        {
            name: 'bet-amount',
            description: 'Amount of potatoes: all | half | (amount)',
            required: true,
            type: ApplicationCommandOptionType.String,
        },
        {
            name: 'color',
            description: `Color the wheel will land on — rotten pays ${Roulette.ROTTEN_PAYOUT_MULTIPLIER}:1 (rare, 2/38 odds)`,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'golden',
                    value: 'golden'
                },
                {
                    name: 'dirt',
                    value: 'dirt'
                },
                {
                    name: `rotten (pays ${Roulette.ROTTEN_PAYOUT_MULTIPLIER}:1)`,
                    value: 'rotten'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let bet = interaction.options.get('bet-amount')?.value;
        let colorSelected = interaction.options.get('color')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;

        const parsedBet = parseAndValidateBet(bet, userPotatoes, userDisplayName, interaction);
        if (!parsedBet) return;
        bet = parsedBet.bet;

        if (!colorSelected) {
            colorSelected = 'golden';
        }

        const pocketColor = spinWheel();

        // updateStatDatabase writes ONE field at a time (a plain DynamoDB `SET
        // #attrName = :attrValue`), so this trackingId's row only ever contains whichever
        // counters have actually been incremented so far — any field never yet touched
        // (e.g. rottenCount before anyone's landed on rotten) is simply ABSENT from the row,
        // not 0, and getStatDatabase itself returns undefined before the row exists at all.
        // Merge onto a zeroed default object (rather than `|| defaults`) so every individual
        // field is guaranteed present, not just the object as a whole — an `|| defaults`
        // fallback only covers the "row doesn't exist yet" case and still crashes the moment
        // a real-but-partial row is missing just one field the embed below reads.
        let rouletteStats = {
            goldenCount: 0, dirtCount: 0, rottenCount: 0, totalPayout: 0, totalReceived: 0,
            ...(await dynamoHandler.getStatDatabase('roulette') || {})
        };
        if (pocketColor === 'golden') {
            rouletteStats.goldenCount += 1;
            await dynamoHandler.updateStatDatabase('roulette', 'goldenCount', rouletteStats.goldenCount);
        } else if (pocketColor === 'dirt') {
            rouletteStats.dirtCount += 1;
            await dynamoHandler.updateStatDatabase('roulette', 'dirtCount', rouletteStats.dirtCount);
        } else {
            rouletteStats.rottenCount += 1;
            await dynamoHandler.updateStatDatabase('roulette', 'rottenCount', rouletteStats.rottenCount);
        }

        if (pocketColor === colorSelected) {
            await handleWinningBet(bet, userId, userPotatoes, userTotalEarnings, rouletteStats, pocketColor, colorSelected, interaction);
        } else {
            await handleLosingBet(bet, userId, userPotatoes, userTotalLosses, rouletteStats, pocketColor, colorSelected, interaction);
        }
    }
}
