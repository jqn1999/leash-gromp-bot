const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

        // updateStatDatabase writes ONE field at a time (a plain DynamoDB `SET
        // #attrName = :attrValue`), so this trackingId's row only ever contains whichever
        // counters have actually been incremented so far — any field never yet touched
        // (e.g. jackpotCount before anyone's hit Golden Potato) is simply ABSENT from the
        // row, not 0, and getStatDatabase itself returns undefined before the row exists at
        // all. Merge onto a zeroed default object (rather than `|| defaults`) so every
        // individual field is guaranteed present, not just the object as a whole — an
        // `|| defaults` fallback only covers the "row doesn't exist yet" case and still
        // crashes the moment a real-but-partial row is missing just one field this file reads.
        let goldenReelsStats = {
            totalPayout: 0, totalReceived: 0, jackpotCount: 0, metalCount: 0, largeCount: 0, regularCount: 0, lossCount: 0,
            ...(await dynamoHandler.getStatDatabase('goldenReels') || {})
        };

        // Resolve EVERY spin up front (2026-09-30, direct instruction — each spin used to
        // write the player's ABSOLUTE potatoes total to the DB as the embed advanced,
        // computed off a running total kept only in this function's own local memory. A
        // long run (up to MAX_SPINS * SPIN_DELAY_MS ≈ 3.3 minutes) left a wide window where
        // any OTHER command the player ran concurrently (/work, etc.) would read/write the
        // real DB value, get silently clobbered by this command's next stale in-memory
        // write, or vice versa — a lost-update race, not a display bug. Everything below is
        // pure local-variable math against the snapshot read above, no DB access at all, so
        // there's nothing left for a concurrent command to race against until the single
        // batched write right after this loop.
        const spinResults = [];
        let simulatedPotatoes = userPotatoes;
        let netTotal = 0;
        let jackpotHits = 0;
        let spinsRun = 0;
        let stoppedEarly = false;
        const statDeltas = { totalPayout: 0, totalReceived: 0, jackpotCount: 0, metalCount: 0, largeCount: 0, regularCount: 0, lossCount: 0 };

        for (let i = 1; i <= spinsRequested; i++) {
            if (bet > simulatedPotatoes) {
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

            simulatedPotatoes += delta;
            if (delta >= 0) {
                statDeltas.totalPayout += delta;
            } else {
                statDeltas.totalReceived -= bet;
            }

            if (symbol) {
                const statKey = SYMBOL_STAT_KEYS[symbol.name];
                statDeltas[statKey] += 1;
                if (symbol.name === 'Golden Potato') jackpotHits += 1;
            } else {
                statDeltas.lossCount += 1;
            }

            netTotal += delta;
            spinsRun += 1;
            spinResults.push({ spinNumber: i, symbolName, payoutMultiplier, delta, potatoesAfter: simulatedPotatoes });
        }

        // Apply the WHOLE run's outcome in one write — see the loop's own comment above
        // for why this replaced a per-spin absolute-value write. All 3 fields are written
        // together even if a given run never touched one of them (e.g. an all-losses run
        // leaves totalEarnings unchanged) — simpler and no less correct than conditionally
        // omitting unchanged fields, since re-writing an unchanged value is a no-op.
        if (spinsRun > 0) {
            userPotatoes += netTotal;
            userTotalEarnings += statDeltas.totalPayout;
            userTotalLosses += statDeltas.totalReceived; // statDeltas.totalReceived is already negative
            await dynamoHandler.updateUserFields(userId, { potatoes: userPotatoes, totalEarnings: userTotalEarnings, totalLosses: userTotalLosses });

            // Same one-write-per-touched-counter batching for the shared goldenReels stats
            // row — previously one updateStatDatabase call per spin per touched counter,
            // racing every OTHER player's own concurrent golden-reels run on the same row.
            // Still skips a counter this run never touched at all, preserving the "absent
            // means never written, not 0" contract this file's own top comment describes.
            for (const [key, delta] of Object.entries(statDeltas)) {
                if (delta === 0) continue;
                goldenReelsStats[key] += delta;
                await dynamoHandler.updateStatDatabase('goldenReels', key, goldenReelsStats[key]);
            }
        }

        // Animate at the same pace as before (GoldenReels.SPIN_DELAY_MS between spins) —
        // purely cosmetic now, since every number above was already resolved and written
        // before this loop even starts. "Skip to End" (2026-09-30, direct instruction) lets
        // an impatient player jump straight to the summary without waiting out the
        // remaining delays; only shown when there's more than one spin's worth of
        // animation to actually skip. skipPromise is created once and raced against EVERY
        // remaining delay — once it resolves (the button was clicked), every subsequent
        // race resolves instantly too, so the very next loop iteration's own `if
        // (skipRequested) break;` check ends the animation immediately.
        let skipResolve;
        const skipPromise = new Promise(resolve => { skipResolve = resolve; });
        let skipRequested = false;
        let collector = null;
        const skipRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('golden_reels_skip').setLabel('Skip to End').setStyle(ButtonStyle.Secondary)
        );

        for (let idx = 0; idx < spinResults.length; idx++) {
            if (skipRequested) break;
            const result = spinResults[idx];
            const isLastSpin = idx === spinResults.length - 1;
            const canSkip = spinResults.length > 1 && !isLastSpin;

            const reply = await interaction.editReply({
                embeds: [embedFactory.createGoldenReelsSpinEmbed(result.spinNumber, spinsRequested, result.symbolName, result.payoutMultiplier, result.delta, result.potatoesAfter)],
                components: canSkip ? [skipRow] : [],
            });

            // Attached once, off the first spin's own reply message — every later edit in
            // this loop reuses the same underlying message, so the collector stays valid.
            if (idx === 0 && canSkip) {
                collector = reply.createMessageComponentCollector({
                    filter: i => i.user.id === interaction.user.id && i.customId === 'golden_reels_skip',
                    time: GoldenReels.SPIN_DELAY_MS * spinResults.length + 30_000,
                });
                collector.on('collect', async buttonInteraction => {
                    skipRequested = true;
                    skipResolve();
                    await buttonInteraction.deferUpdate().catch(() => {});
                });
            }

            if (!isLastSpin && !skipRequested) {
                await Promise.race([sleep(GoldenReels.SPIN_DELAY_MS), skipPromise]);
            }
        }
        if (collector) collector.stop();

        await interaction.editReply({ embeds: [embedFactory.createGoldenReelsSummaryEmbed(spinsRun, spinsRequested, netTotal, jackpotHits, stoppedEarly, bet)], components: [] });
    }
}
