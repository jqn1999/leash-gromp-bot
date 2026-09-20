const dynamoHandler = require("./dynamoHandler");
const { CompanionRarity } = require("./constants");

// Big Events Channel (2026-09-16) — bot-side counterpart to financial-project's own
// postBigEvent (gromp-economy/gromp-mercenary/gromp-guilds' handler.ts). Originally
// website-only for the work-encounter-type/<30%-chance-win triggers (companion pulls were
// the sole bot-side exception, added the same day — see isBigEventCompanion's own comment).
// Widened same day, direct instruction ("I also wanted the big events to generally include
// normal discord bot commands too for the golden and metals and such"): every trigger this
// channel has is now checked bot-side too, at the real Discord command that produces it,
// posting to the exact same stored webhook URL/stats-table doc the website Lambdas use — a
// Discord webhook accepts a plain POST from anywhere, bot process or not, no client/token
// needed.
const BIG_EVENT_EMBED_COLOR = 0xFFD700;
const BIG_EVENT_FOOTER = { text: "Gromp Big Events" };

// Per-scenario colors (2026-09-18, direct instruction — "mess with the web events and big
// events colors... assign different colors to scenarios and grey for normal work"). Color
// follows the scenario's own flavor (what it IS), not win/loss — Poison is green because
// that's a poison color, not because a poison hit is good (it's still a loss; the
// title/description carry that, not the hue). metalSuccess/metalFailure share one color for
// the same reason: Metal Potato is still "a metal potato" whether or not it was felled.
// Mirrored — not shared — into financial-project's own gromp-economy/handler.ts, keyed by
// the exact same encounterType strings both repos already agree on (doWork's own literals).
// This bot only ever exercises 4 of these 11 (golden/metalSuccess/ancient/goldenYam — the
// only work encounters that reach THIS channel; the other 7 only ever post to the website's
// normal Activity channel, which the bot has no equivalent of) plus the two non-work
// categories below — kept as one complete map anyway so it stays the single source of truth
// financial-project's own copy is checked against.
const SCENARIO_COLOR = {
    regular: 0x99AAB5,      // Grey — plain, unremarkable work
    golden: 0xFFD700,       // Gold — unchanged
    goldenYam: 0xF1C40F,    // Warm amber-gold — same rarity tier as Golden Potato, distinct enough
    metalSuccess: 0x5B7C99, // Steel blue-grey — metallic
    metalFailure: 0x5B7C99,
    ancient: 0xA9744F,      // Aged bronze
    poison: 0x2ECC71,       // Toxic green
    sweet: 0xE67E22,        // Orange — real sweet-potato flesh color
    large: 0x7B4B2A,        // Earthy russet brown
    taro: 0x8E44AD,         // Purple — real taro color
    mimic: 0x2C2F33,        // Near-black — shadowy/deceptive
    companion: 0xE91E8C,    // Magenta — rare/exciting, distinct from every potato-earth-tone
};
// Non-work Big Event categories, same palette family.
const LONG_SHOT_WIN_COLOR = 0xFF4500;  // Fire orange-red — matches "🔥 Against All Odds!"
const RARE_COMPANION_COLOR = 0xE91E8C; // Same magenta as the `companion` work scenario above —
                                        // unifies "companion" as one color regardless of source
                                        // (Wandering Companion / Yukon / Cinderroot / Bastion).

// <30%-chance Raid/Bounty/Heist win threshold — shared with financial-project's own
// BIG_EVENT_WIN_CHANCE_THRESHOLD (gromp-mercenary/gromp-guilds' handler.ts). Kept as one
// named constant here rather than a bare 0.30 literal at each of the (several) bot-side
// call sites this now applies to.
const BIG_EVENT_WIN_CHANCE_THRESHOLD = 0.30;

// /work encounter types that count as a Big Event — mirrors financial-project's own
// BIG_EVENT_WORK_ENCOUNTERS/BIG_EVENT_WORK_LABELS (gromp-economy/handler.ts) exactly.
// Golden Yam wasn't named verbatim by the player but shares Golden Potato's exact 0.1%
// base encounter chance (see constants.js's workScenarios chance table), so it was folded
// into the same tier there and stays folded in here for consistency.
const BIG_EVENT_WORK_ENCOUNTERS = new Set(["golden", "metalSuccess", "ancient", "goldenYam"]);
const BIG_EVENT_WORK_LABELS = {
    golden: "a Golden Potato",
    metalSuccess: "a Metal Potato",
    ancient: "an Ancient Potato",
    goldenYam: "a Golden Yam",
};

// Embed titles for the same 4 encounter types, above — kept as their own map rather than
// derived from BIG_EVENT_WORK_LABELS (whose "a/an Golden Potato" phrasing reads naturally
// mid-sentence in a description, but not as a standalone title).
const BIG_EVENT_WORK_TITLES = {
    golden: "✨ Golden Potato!",
    metalSuccess: "✨ Metal Potato Felled!",
    ancient: "✨ Ancient Potato Unearthed!",
    goldenYam: "✨ Golden Yam!",
};

// Structure pass (2026-09-18, direct instruction — "the channels for big events/activity
// dont show anything but the potato count (which some things dont give)... give them more
// details and structure... so they feel better and more alive"). Previously every embed was
// a single bare `description` string with every detail (player, reward, odds, companion)
// crammed into one sentence — supersedes server-activity-channel.md's earlier "kept
// deliberately simple, description only" decision, which this instruction explicitly asks to
// move past. postBigEvent's own signature changed from a flat message string to a structured
// {title, description, fields, color} object so title/fields render as real embed structure
// instead of more inline text. `color` defaults to Gold (BIG_EVENT_EMBED_COLOR) but every
// call site below now passes its own SCENARIO_COLOR/LONG_SHOT_WIN_COLOR/RARE_COMPANION_COLOR
// entry — same-day follow-up, direct instruction ("assign different colors to scenarios and
// grey for normal work"), which explicitly reopens the earlier "one single Gold color for
// every subtype" decision this same file used to document as settled.
async function postBigEvent({ title, description, fields = [], color = BIG_EVENT_EMBED_COLOR }) {
    try {
        const config = await dynamoHandler.getStatDatabase("server_big_events_channel");
        if (!config?.webhookUrl) return;
        await fetch(config.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                embeds: [{
                    title,
                    description,
                    color,
                    fields,
                    footer: BIG_EVENT_FOOTER,
                    timestamp: new Date().toISOString(),
                }],
            }),
        });
    } catch (error) {
        console.error("postBigEvent (bot-side) failed (non-fatal):", error);
    }
}

// Small field builders shared by every call site below, so the exact wording/shape (field
// name, inline-ness) can't drift between work.js/takeBounty.js/robNpc.js/startRaid.js/
// enter-tower.js's own calls into a half-dozen slightly different versions of "who did this."
function playerField(userDisplayName) {
    return { name: "Adventurer", value: userDisplayName, inline: true };
}
function rewardField(amount, currency = "potatoes") {
    return { name: "Reward", value: `${amount.toLocaleString()} ${currency}`, inline: true };
}
function oddsField(successChance) {
    return { name: "Odds", value: `${Math.round(successChance * 100)}%`, inline: true };
}
function guildField(guildName) {
    return { name: "Guild", value: guildName, inline: true };
}
function companionField(companion) {
    return { name: "Companion", value: describeCompanion(companion), inline: true };
}
function sourceField(label) {
    return { name: "Found", value: label, inline: true };
}
// Guild Raid Stat Reward parity pass (2026-09-20, systems/guilds.md's "Guild Raid Stat
// Reward: Technical Design", section 8) — shared "Stats Granted" field for every merc-side
// long-shot-win post (takeBounty.js/robNpc.js/confrontRival.js) that also landed a stat
// grant on the same win, enriching an already-firing post rather than triggering a new one.
// `types` is a flat array of grant-entry `type` strings (workMultiplierAmount/passiveAmount/
// bankCapacity) — own copy of embedFactory.js's own statLabels map (Bounty result embed),
// same "small lookup duplicated rather than shared across module internals" precedent this
// file's own RARITY_LABEL/COMPANION_RARITY_LABEL pair already sets.
const STAT_REWARD_LABEL = { workMultiplierAmount: "Work Multiplier", passiveAmount: "Passive Income", bankCapacity: "Bank Capacity" };
function statsGrantedField(types) {
    return { name: "Stats Granted", value: types.map(t => STAT_REWARD_LABEL[t] ?? t).join(", "), inline: false };
}

// Companion-pull Big Event condition (2026-09-16, direct instruction — "add mythic and
// above companions or the tower/yukon/guild companions to the big events"). Two
// independent conditions, either one qualifies:
//   - rarity is Mythic or Heirloom (the two tiers above Legendary — see
//     CompanionRarity/CompanionRarityOdds in constants.js), regardless of which roll path
//     produced it (a /work Wandering Companion encounter, Companion Shop, Companion Hunt).
//   - the companion's own dropSource is one of the three activity-exclusive companions
//     (Yukon/bounty, Cinderroot/guildRaid, Bastion/tower) — all three sit at Legendary
//     rarity, not Mythic+, but they're gated behind a specific rare activity outcome
//     rather than pure RNG, which is exactly the "big/rare moment" this channel exists for.
// Deliberately excludes companionBuy.js/companionMarket.js's applyCompanionAward calls —
// those move an already-known, already-leveled instance between two players (a trade, not
// a lucky roll), nothing to celebrate as a "pull."
const MYTHIC_PLUS_RARITIES = new Set([CompanionRarity.MYTHIC, CompanionRarity.HEIRLOOM]);
const SPECIAL_DROP_SOURCES = new Set(["bounty", "guildRaid", "tower"]);

function isBigEventCompanion(companion) {
    return MYTHIC_PLUS_RARITIES.has(companion.rarity) || SPECIAL_DROP_SOURCES.has(companion.dropSource);
}

// Own copy of embedFactory.js's COMPANION_RARITY_LABEL — that one is module-internal
// (not exported), and every call site here already imports this file for the two
// functions above, so duplicating this small a lookup beats reaching into embedFactory's
// internals or restructuring its exports for one shared constant.
const RARITY_LABEL = {
    [CompanionRarity.COMMON]: "Common",
    [CompanionRarity.RARE]: "Rare",
    [CompanionRarity.LEGENDARY]: "Legendary",
    [CompanionRarity.MYTHIC]: "Mythic",
    [CompanionRarity.HEIRLOOM]: "Heirloom",
};

function describeCompanion(companion) {
    return `${companion.name} (${RARITY_LABEL[companion.rarity] ?? companion.rarity})`;
}

module.exports = {
    postBigEvent,
    isBigEventCompanion,
    describeCompanion,
    playerField,
    rewardField,
    oddsField,
    guildField,
    companionField,
    sourceField,
    statsGrantedField,
    BIG_EVENT_WIN_CHANCE_THRESHOLD,
    BIG_EVENT_WORK_ENCOUNTERS,
    BIG_EVENT_WORK_LABELS,
    BIG_EVENT_WORK_TITLES,
    SCENARIO_COLOR,
    LONG_SHOT_WIN_COLOR,
    RARE_COMPANION_COLOR,
};
