const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { getEffectiveScenarioChances } = require("../../utils/workFactory");
const companionFactory = require("../../utils/companionFactory");
const festivalFactory = require("../../utils/festivalFactory");
const { WORK_SCENARIO_INDICES } = require("../../utils/eventFactory");
const { Festival } = require("../../utils/constants");
const { workScenarios } = require("./work.js");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Human-readable labels per /work scenario type — matches the established colloquial terms
// already used elsewhere (Prospector's own perk description: "Poison Potato, Large Potato,
// Companion, Taro Trader & Mimic Potato"), not each mob constant's own raw `.name` field
// (poisonPotato.name is "Poisonous Potato," never shown to players as such anywhere else).
const SCENARIO_LABELS = {
    [WORK_SCENARIO_INDICES.GOLDEN]: "Golden Potato",
    [WORK_SCENARIO_INDICES.POISON]: "Poison Potato",
    [WORK_SCENARIO_INDICES.LARGE]: "Large Potato",
    [WORK_SCENARIO_INDICES.METAL]: "Metal Potato",
    [WORK_SCENARIO_INDICES.SWEET]: "Sweet Potato",
    [WORK_SCENARIO_INDICES.COMPANION]: "Wandering Companion",
    [WORK_SCENARIO_INDICES.TARO]: "Taro Trader",
    [WORK_SCENARIO_INDICES.ANCIENT]: "Ancient Potato",
    [WORK_SCENARIO_INDICES.MIMIC]: "Mimic Potato",
    [WORK_SCENARIO_INDICES.GOLDEN_YAM]: "Golden Yam",
    [WORK_SCENARIO_INDICES.REGULAR]: "Regular Work",
};

// Converts a scenario table's own cumulative thresholds ([.001, .011, .051, ...]) into each
// scenario's real, independent probability mass ([.001, .01, .04, ...]) — the same
// "subtract the running total" pattern workFactory.getEffectiveScenarioChances/
// festivalFactory.applyFestivalOddsOverride/startRaid.js's own bracketOdds all already use
// internally, just surfaced here since showing that final per-scenario number is this
// command's whole point.
function toProbabilityMass(chances) {
    let previous = 0;
    return chances.map(({ type, chance }) => {
        const width = chance - previous;
        previous = chance;
        return { type, width };
    });
}

// Read-only preview, mirrors /bounty-board/current-raid's own "never snapshots/claims by
// viewing" precedent. Ephemeral — a player's own live odds preview, personal to them
// (folds in their own Prospector bonus), not something worth broadcasting to the channel.
module.exports = {
    name: "work-odds",
    description: "See your own live /work encounter odds — every scenario, with your bonuses already applied",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        // Mirrors performWork's own odds pipeline exactly (work.js) — live workScenarios
        // (already hourly-event-adjusted, since EventFactory's own roll mutates it in place
        // via setWorkScenarios) -> Prospector's per-request widening -> the festival
        // odds-boost composed on top, never merged into either — so this can never drift
        // from what a real /work call would actually roll against.
        const prospectorMultiplierBonus = companionFactory.getActivePerkValue(userDetails, "specialEncounterMultiplierBonus");
        const prospectorAdjustedChances = getEffectiveScenarioChances(workScenarios, prospectorMultiplierBonus);

        const activeFestival = await dynamoHandler.getActiveFestival();
        const festivalOddsOverride = festivalFactory.isFestivalLive(activeFestival) ? activeFestival.oddsOverride : null;
        const effectiveChances = festivalFactory.applyFestivalOddsOverride(prospectorAdjustedChances, festivalOddsOverride);

        const odds = toProbabilityMass(effectiveChances).map(({ type, width }) => ({
            label: SCENARIO_LABELS[type] || `Scenario ${type}`,
            percentText: `${(width * 100).toFixed(2)}%`,
        }));

        // Same boosted-odds naming fix as /festival's own status embed (2026-09-28,
        // player-reported: "Nothing said poison had 50% more chance to be found") — this
        // command is exactly where a player would come looking for that number, so it's
        // called out by name here too, not just in /festival.
        const festivalBoostText = festivalOddsOverride
            ? `${Festival.ODDS_OVERRIDE_SCENARIO_LABEL[festivalOddsOverride.scenario] || festivalOddsOverride.scenario} is boosted +${Math.round((festivalOddsOverride.multiplier - 1) * 100)}% by this season's festival.`
            : null;
        const prospectorText = prospectorMultiplierBonus > 0
            ? `Prospector is widening Poison/Large/Companion/Taro/Mimic by +${(prospectorMultiplierBonus * 100).toFixed(0)}% each.`
            : null;

        const embed = embedFactory.createWorkOddsEmbed(userDisplayName, odds, [festivalBoostText, prospectorText].filter(Boolean));
        await interaction.editReply({ embeds: [embed] });
    }
}
