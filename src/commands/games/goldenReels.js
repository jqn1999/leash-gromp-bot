const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, parseAndValidateBet } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const { GoldenReels } = require("../../utils/constants");
const embedFactory = new EmbedFactory();

// Maps a matched symbol's name to its stats-table counter field. Kept as an explicit
// table (rather than deriving from the name string) so a future rename of a symbol's
// display name in constants.js can't silently rename/break its stat counter too.
const SYMBOL_STAT_KEYS = {
    'Golden Potato': 'jackpotCount',
    'Metal Potato': 'metalCount',
    'Large Potato': 'largeCount',
    'Regular Potato': 'regularCount',
}

// Single categorical draw per spin (not 3 independent reels — see GoldenReels' own
// comment in constants.js for why). `chance` values in GoldenReels.SYMBOLS are per-symbol
// slice widths, so this cumulative-sums them at roll time, same cumulative-threshold
// strict-`<` idiom workScenarios (work.js) already established. Falling past the last
// threshold is a loss — returns null.
function rollSymbol() {
    const roll = Math.random();
    let cumulative = 0;
    for (const symbol of GoldenReels.SYMBOLS) {
        cumulative += symbol.chance;
        if (roll < cumulative) return symbol;
    }
    return null;
}

module.exports = {
    name: "golden-reels",
    description: "Spin the golden reels for a shot at a rare payout multiplier, bet-per-spin.",
    options: [
        {
            name: 'bet-amount',
            description: 'Amount of potatoes wagered PER SPIN: all | half | (amount)',
            required: true,
            type: ApplicationCommandOptionType.String,
        },
        {
            name: 'spins',
            description: `Number of spins to run (1-${GoldenReels.MAX_SPINS})`,
            required: true,
            type: ApplicationCommandOptionType.Integer,
            minValue: 1,
            maxValue: GoldenReels.MAX_SPINS,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let bet = interaction.options.get('bet-amount')?.value;
        let spinsRequested = interaction.options.get('spins')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;

        const parsedBet = parseAndValidateBet(bet, userPotatoes, userDisplayName, interaction);
        if (!parsedBet) return;
        bet = parsedBet.bet;

        // Defensive re-clamp on top of the slash option's own minValue/maxValue — Discord
        // already enforces this before the callback runs, but this keeps the loop below
        // safe even if that option definition is ever loosened without this file changing.
        spinsRequested = Math.min(Math.max(Math.floor(Number(spinsRequested)) || 1, 1), GoldenReels.MAX_SPINS);

        let goldenReelsStats = await dynamoHandler.getStatDatabase('goldenReels');

        let spinsRun = 0;
        let netTotal = 0;
        let jackpotHits = 0;
        let stoppedEarly = false;

        for (let i = 1; i <= spinsRequested; i++) {
            if (bet > userPotatoes) {
                stoppedEarly = true;
                break;
            }

            const symbol = rollSymbol();
            const payoutMultiplier = symbol ? symbol.payoutMultiplier : 0;
            const symbolName = symbol ? symbol.name : 'No Match';
            // payoutMultiplier is a TOTAL return multiple (stake included), so the net
            // change to the player's balance is (multiplier - 1) * bet — this collapses a
            // loss (multiplier 0) to exactly -bet without a separate branch.
            const delta = Math.round(bet * (payoutMultiplier - 1));

            userPotatoes += delta;
            if (delta >= 0) {
                userTotalEarnings += delta;
                await dynamoHandler.updateUserFields(userId, { potatoes: userPotatoes, totalEarnings: userTotalEarnings });
                await dynamoHandler.updateStatDatabase('goldenReels', 'totalPayout', goldenReelsStats.totalPayout + delta);
                goldenReelsStats.totalPayout += delta;
            } else {
                userTotalLosses -= bet;
                await dynamoHandler.updateUserFields(userId, { potatoes: userPotatoes, totalLosses: userTotalLosses });
                await dynamoHandler.updateStatDatabase('goldenReels', 'totalReceived', goldenReelsStats.totalReceived - bet);
                goldenReelsStats.totalReceived -= bet;
            }

            if (symbol) {
                const statKey = SYMBOL_STAT_KEYS[symbol.name];
                goldenReelsStats[statKey] += 1;
                await dynamoHandler.updateStatDatabase('goldenReels', statKey, goldenReelsStats[statKey]);
                if (symbol.name === 'Golden Potato') jackpotHits += 1;
            } else {
                goldenReelsStats.lossCount += 1;
                await dynamoHandler.updateStatDatabase('goldenReels', 'lossCount', goldenReelsStats.lossCount);
            }

            netTotal += delta;
            spinsRun += 1;

            await interaction.editReply({ embeds: [embedFactory.createGoldenReelsSpinEmbed(i, spinsRequested, symbolName, payoutMultiplier, delta, userPotatoes)] });

            if (i < spinsRequested) {
                await new Promise(resolve => setTimeout(resolve, GoldenReels.SPIN_DELAY_MS));
            }
        }

        await interaction.editReply({ embeds: [embedFactory.createGoldenReelsSummaryEmbed(spinsRun, spinsRequested, netTotal, jackpotHits, stoppedEarly, bet)] });
    }
}
