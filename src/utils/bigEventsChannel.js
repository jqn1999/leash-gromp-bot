const dynamoHandler = require("./dynamoHandler");
const { CompanionRarity } = require("./constants");

// Big Events Channel (2026-09-16) — bot-side counterpart to financial-project's own
// postBigEvent (gromp-economy/gromp-mercenary/gromp-guilds' handler.ts). The website
// Lambdas post directly to the stored webhook for their own triggers (work-encounter type,
// <30%-chance Raid/Bounty/Heist wins), but companion pulls happen on BOTH sides — and
// Tower's Bastion has no website equivalent at all (Tower isn't ported there) — so this
// bot-side helper posts to the exact same webhook URL/stats-table doc directly, the same
// way the website does: a Discord webhook accepts a plain POST from anywhere, bot process
// or not, no client/token needed.
const BIG_EVENT_EMBED_COLOR = 0xFFD700;

async function postBigEvent(message) {
    try {
        const config = await dynamoHandler.getStatDatabase("server_big_events_channel");
        if (!config?.webhookUrl) return;
        await fetch(config.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [{ description: message, color: BIG_EVENT_EMBED_COLOR }] }),
        });
    } catch (error) {
        console.error("postBigEvent (bot-side) failed (non-fatal):", error);
    }
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

module.exports = { postBigEvent, isBigEventCompanion, describeCompanion };
