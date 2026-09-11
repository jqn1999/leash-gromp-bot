const { GuildCompanionDrop, GuildCompanionScaling } = require("./constants");
const companionFactory = require("./companionFactory");

// Cinderroot, the Hoardwarden — see systems/guilds.md's "Guild Companion (Cinderroot)
// Rework" section for the full design. Discord.js-free, matching every other factory file
// in this codebase (companionFactory.js, raidFactory.js, guildBuffFactory.js) — that's
// exclusively command-file territory.
//
// Reworked 2026-09-11 (direct instruction): Cinderroot is found the same way Yukon is (a
// real personal companion instance, in Companions[] in constants.js, landing in
// userDetails.companions.owned, awarded to whoever STARTED the raid) and must be explicitly
// DONATED to a guild to do anything.
//
// Revised again same day (direct instruction): the equip/unequip toggle this rework
// originally shipped with was removed as unnecessary complexity. `guild.guildCompanion` is
// back to its original two-state shape — a guild either possesses Cinderroot (fully active,
// protecting the guild) or doesn't:
//   { id: "cinderroot", acquiredAt, acquiredRaidTier }
// Every perk/sacrifice/treasury consumer gates on simple possession (`guildCompanion !=
// null`), not a second flag. To reclaim a donated Cinderroot, a guild's Leader/Co-Leader
// pulls it out entirely with /guild-companion-withdraw — see resolveCinderrootAward below,
// reused for both the original find and a withdraw's personal-award step.

function getGuildCompanionById(id) {
    return companionFactory.getCompanionById(id);
}

// Mirrors guildBuffFactory.getGuildBuffValue's exact clamp shape.
function getGuildCompanionScalingValue(scaleKey, level) {
    const scale = GuildCompanionScaling[scaleKey];
    if (!scale) return 0;
    const clampedLevel = Math.min(Math.max(level, 1), scale.length);
    return scale[clampedLevel - 1];
}

function getRaidCooldownReduction(guild, level) {
    if (guild.guildCompanion == null) return 0;
    return getGuildCompanionScalingValue('raidCooldownReductionPercent', level);
}

function getRaidRewardBonus(guild, level) {
    if (guild.guildCompanion == null) return 0;
    return getGuildCompanionScalingValue('raidRewardBonusPercent', level);
}

// One roll per winning raid RESOLUTION (never per member — see roadmap's fairness
// reasoning), gated off entirely once a guild already POSSESSES one (only one Cinderroot
// allowed per guild, per direct instruction). No longer writes anything itself — the actual
// award now lands on the raid-STARTING member's own companion roster via
// resolveCinderrootAward below, called by the caller (startRaid.js) with that member's own
// userDetails, mirroring exactly how Yukon's own acquisition roll
// (mercenaryFactory.resolveYukonAward) never touches this file at all.
async function rollGuildCompanionDrop(guild, raidSelection, wonThisRaid) {
    if (!wonThisRaid || guild.guildCompanion != null) return { awarded: false };
    const chance = GuildCompanionDrop.CHANCE[raidSelection] ?? 0;
    if (chance <= 0 || Math.random() >= chance) return { awarded: false };
    return { awarded: true };
}

// Cinderroot's personal-instance award — mirrors mercenaryFactory.resolveYukonAward
// exactly. Only ever touches userDetails.companions; `guild.guildCompanion` is completely
// untouched by a find, only ever written by an explicit donate/withdraw/sacrifice. Reused
// by /guild-companion-withdraw's own personal-award step.
function resolveCinderrootAward(userDetails) {
    const cinderroot = companionFactory.getCompanionById('cinderroot');
    const { isNew, companions } = companionFactory.applyCompanionAward(userDetails, cinderroot);
    return { isNew, companion: cinderroot, companions };
}

// Donate (personal instance -> guild property) — available to the OWNING PLAYER
// themselves, no guild-role gate (it's their own find; requiring Leader/Co-Leader here
// would let a Leader block a member from ever contributing what they found). Preconditions:
// the player actually owns that instance (and it's genuinely Cinderroot, not some other
// companion id), it isn't out scavenging, and the guild doesn't already possess one (strict
// per-guild singleton).
function validateDonateRequest(userDetails, guild, instanceId) {
    if (guild.guildCompanion != null) {
        return { valid: false, error: "your guild already has a Cinderroot — only one is allowed per guild." };
    }
    const ownedEntry = companionFactory.getOwnedEntry(userDetails, instanceId);
    if (!ownedEntry || ownedEntry.id !== 'cinderroot') {
        return { valid: false, error: "you don't own that Cinderroot." };
    }
    if (companionFactory.isScavenging(userDetails, instanceId)) {
        return { valid: false, error: "that Cinderroot is out scavenging — it can't be donated until it returns (or you cancel the scavenge)." };
    }
    return { valid: true, ownedEntry };
}

// Removes the donated instance entirely from the player's own companions — it becomes
// genuinely ownerless guild property, not a reference back to whoever found it. Clears it
// from `active`/`favorites` too, the same cleanup companionMarketFactory.removeFromOwned
// already does for `active` when an instance stops being ownable — extended here to
// `favorites` as well, since a donated instance can no longer be quick-equipped from a
// stale favorite slot.
function removeDonatedCompanionFromOwned(userDetails, instanceId) {
    const companions = userDetails.companions;
    const favorites = Array.isArray(companions.favorites)
        ? companions.favorites.map(slot => (slot === instanceId ? null : slot))
        : companions.favorites;
    return {
        ...companions,
        owned: companions.owned.filter(c => c.instanceId !== instanceId),
        active: companions.active === instanceId ? null : companions.active,
        favorites
    };
}

// The new guild.guildCompanion record written on a successful donation. acquiredRaidTier
// is always null — once ownership is severed from the specific player/raid that found it,
// there's no continuity left to know which raid tier THIS instance was originally found on
// (owned companion instances never carried that field), so this deliberately doesn't try
// to fake one.
function buildDonatedGuildCompanion() {
    return { id: 'cinderroot', acquiredAt: Date.now(), acquiredRaidTier: null };
}

module.exports = {
    getGuildCompanionById,
    getGuildCompanionScalingValue,
    getRaidCooldownReduction,
    getRaidRewardBonus,
    rollGuildCompanionDrop,
    resolveCinderrootAward,
    validateDonateRequest,
    removeDonatedCompanionFromOwned,
    buildDonatedGuildCompanion,
};
