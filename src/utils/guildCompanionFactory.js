const { GuildCompanionDrop, GuildCompanionScaling } = require("./constants");
const companionFactory = require("./companionFactory");

// Cinderroot, the Hoardwarden — see systems/guilds.md's "Guild Companion (Cinderroot)
// Rework" section for the full design. Discord.js-free, matching every other factory file
// in this codebase (companionFactory.js, raidFactory.js, guildBuffFactory.js) — that's
// exclusively command-file territory.
//
// Reworked 2026-09-11 (direct instruction): Cinderroot used to be a pure guild-owned
// singleton — a winning raid wrote `guild.guildCompanion` directly, no player ever "owned"
// it. It's now found the same way Yukon is (a real personal companion instance, in
// Companions[] in constants.js, landing in userDetails.companions.owned, awarded to
// whoever STARTED the raid) and must be explicitly DONATED to a guild to do anything.
// `guild.guildCompanion` keeps its exact shape from before, plus one new field:
//   { id: "cinderroot", acquiredAt, acquiredRaidTier, equipped: true | false }
// `equipped: false` is the "benched" state — still possessed by the guild (no fresh
// donation needed to reactivate), but inert: no perks, not sacrificeable. Every perk/
// sacrifice consumer below gates on `equipped === true`, not just `guildCompanion != null`.

function getGuildCompanionById(id) {
    return companionFactory.getCompanionById(id);
}

// True only once a guild both possesses AND has equipped Cinderroot — the one gate every
// perk getter and the sacrifice-offer/treasury-interest consumers (guildCompanionFactory
// itself, startRaid.js, dynamoHandler.js, embedFactory.js) all share. Loose `!= null` on
// `guildCompanion` handles both an unhealed `undefined` and a healed-but-never-won `null`
// identically, matching every other guildCompanion read site's own convention.
function isCinderrootEquipped(guild) {
    return guild.guildCompanion != null && guild.guildCompanion.equipped === true;
}

// Mirrors guildBuffFactory.getGuildBuffValue's exact clamp shape.
function getGuildCompanionScalingValue(scaleKey, level) {
    const scale = GuildCompanionScaling[scaleKey];
    if (!scale) return 0;
    const clampedLevel = Math.min(Math.max(level, 1), scale.length);
    return scale[clampedLevel - 1];
}

function getRaidCooldownReduction(guild, level) {
    if (!isCinderrootEquipped(guild)) return 0;
    return getGuildCompanionScalingValue('raidCooldownReductionPercent', level);
}

function getRaidRewardBonus(guild, level) {
    if (!isCinderrootEquipped(guild)) return 0;
    return getGuildCompanionScalingValue('raidRewardBonusPercent', level);
}

// One roll per winning raid RESOLUTION (never per member — see roadmap's fairness
// reasoning), gated off entirely once a guild already POSSESSES one (equipped or benched —
// only one Cinderroot allowed per guild, per direct instruction). No longer writes
// anything itself — the actual award now lands on the raid-STARTING member's own
// companion roster via resolveCinderrootAward below, called by the caller (startRaid.js)
// with that member's own userDetails, mirroring exactly how Yukon's own acquisition roll
// (mercenaryFactory.resolveYukonAward) never touches this file at all.
async function rollGuildCompanionDrop(guild, raidSelection, wonThisRaid) {
    if (!wonThisRaid || guild.guildCompanion != null) return { awarded: false };
    const chance = GuildCompanionDrop.CHANCE[raidSelection] ?? 0;
    if (chance <= 0 || Math.random() >= chance) return { awarded: false };
    return { awarded: true };
}

// Cinderroot's personal-instance award — mirrors mercenaryFactory.resolveYukonAward
// exactly. Only ever touches userDetails.companions; `guild.guildCompanion` is completely
// untouched by a find, only ever written by an explicit donate/equip/unequip/sacrifice.
function resolveCinderrootAward(userDetails) {
    const cinderroot = companionFactory.getCompanionById('cinderroot');
    const { isNew, companions } = companionFactory.applyCompanionAward(userDetails, cinderroot);
    return { isNew, companion: cinderroot, companions };
}

// Donate-and-equip (personal instance -> guild property, equipped: true) — available to
// the OWNING PLAYER themselves, no guild-role gate (it's their own find; requiring
// Leader/Co-Leader here would let a Leader block a member from ever contributing what they
// found). Preconditions: the player actually owns that instance (and it's genuinely
// Cinderroot, not some other companion id), it isn't out scavenging, and the guild doesn't
// already possess one (equipped OR benched — strict per-guild singleton).
function validateDonateRequest(userDetails, guild, instanceId) {
    if (guild.guildCompanion != null) {
        return { valid: false, error: "your guild already has a Cinderroot (equipped or benched) — only one is allowed per guild." };
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
// genuinely ownerless guild property, not a reference back to whoever found it (per direct
// instruction: no departure hook is needed anywhere since there's no ongoing personal-
// ownership tie left to unwind). Clears it from `active`/`favorites` too, the same cleanup
// companionMarketFactory.removeFromOwned already does for `active` when an instance stops
// being ownable — extended here to `favorites` as well, since a donated instance can no
// longer be quick-equipped from a stale favorite slot.
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
    return { id: 'cinderroot', acquiredAt: Date.now(), acquiredRaidTier: null, equipped: true };
}

// Re-equip (benched -> equipped) and unequip (equipped -> benched) — both Leader/Co-Leader
// only once a guild has stopped personally-owning it (see this file's own top comment).
// Pure state-transition validation; the caller (a command) still owns the actual role
// check and the DB write, mirroring every other guild command's own division of labor.
function validateEquipRequest(guild) {
    if (guild.guildCompanion == null) {
        return { valid: false, error: "your guild doesn't have a Cinderroot to equip yet — someone has to find one on a winning raid and donate it first with /guild-companion-donate." };
    }
    if (guild.guildCompanion.equipped === true) {
        return { valid: false, error: "your guild's Cinderroot is already equipped." };
    }
    return { valid: true };
}

function validateUnequipRequest(guild) {
    if (guild.guildCompanion == null) {
        return { valid: false, error: "your guild doesn't have a Cinderroot to unequip." };
    }
    if (guild.guildCompanion.equipped !== true) {
        return { valid: false, error: "your guild's Cinderroot is already benched." };
    }
    return { valid: true };
}

// Pure boolean toggle on the existing guildCompanion record — no player inventory touched,
// no new drop needed to reactivate a benched one. Used by both equip (true) and unequip
// (false).
function setCinderrootEquipped(guildCompanion, equipped) {
    return { ...guildCompanion, equipped };
}

module.exports = {
    getGuildCompanionById,
    isCinderrootEquipped,
    getGuildCompanionScalingValue,
    getRaidCooldownReduction,
    getRaidRewardBonus,
    rollGuildCompanionDrop,
    resolveCinderrootAward,
    validateDonateRequest,
    removeDonatedCompanionFromOwned,
    buildDonatedGuildCompanion,
    validateEquipRequest,
    validateUnequipRequest,
    setCinderrootEquipped,
};
