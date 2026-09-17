const dynamoHandler = require("../utils/dynamoHandler");
const companionFactory = require("../utils/companionFactory");
const { CompanionShop, CompanionMarket, CompanionRarity } = require("../utils/constants");

// Companion Shop (roadmap.md item 92, 2026-09-14 direct instruction) — a personal,
// rotating NPC storefront, distinct from the player-to-player CompanionMarket. Design
// locked across a multi-round confirm loop before any code was written: personal (not
// shared) stock, potato-or-starch pricing, no reroll, an 8pm ET rotation matching every
// other weekly/daily boundary this codebase already uses, and seeded/deterministic
// offerings so nothing about a slot needs to be pre-rolled or stored — only which slots
// have been bought.

// Same 8pm ET boundary Quests/Guild Contracts/Mercenary weekly quests/Poison-Mimic
// mitigation/the Daily Login Streak all already reset at — duplicated here rather than
// imported per this codebase's established "mirrored, not shared" convention for these
// tiny pure date helpers (see workFactory.js's getCurrentWeekTag / dailyStreakFactory.js's
// getStreakDayString, both of which independently duplicate the exact same
// getEasternDateParts shape for the same reason). Date.UTC below is used purely as
// calendar-math (correctly rolling month/year/weekday boundaries), never as a timezone
// conversion — the actual Eastern-time reading is Intl's job.
const RESET_HOUR_EST = 20;

function getEasternDateParts(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23'
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour) };
}

function formatYMD(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// The effective "shop day" for a given real moment — same shape as dailyStreakFactory.js's
// getStreakDayString: the Eastern calendar day, bumped by one once it's 8pm ET or later.
function getDailyTag(now = new Date()) {
    const { year, month, day, hour } = getEasternDateParts(now);
    const effectiveDay = hour >= RESET_HOUR_EST ? day + 1 : day;
    const effective = new Date(Date.UTC(year, month - 1, effectiveDay));
    return formatYMD(effective.getUTCFullYear(), effective.getUTCMonth() + 1, effective.getUTCDate());
}

// The effective "shop week" — same shape as workFactory.js's getCurrentWeekTag: the most
// recent Sunday-8pm-ET boundary that's already passed. Reset day moved Monday -> Sunday
// (2026-09-17, direct instruction) alongside every other weekly boundary in this codebase.
function getWeeklyTag(now = new Date()) {
    const { year, month, day, hour } = getEasternDateParts(now);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const daysSinceSunday = weekday;
    const pastThisWeeksBoundary = daysSinceSunday > 0 || hour >= RESET_HOUR_EST;
    const sundayOffset = daysSinceSunday + (pastThisWeeksBoundary ? 0 : 7);
    const effectiveSunday = new Date(Date.UTC(year, month - 1, day - sundayOffset));
    return effectiveSunday.toLocaleDateString('en-US', { timeZone: 'UTC' });
}

// getUsers()-style external/partial data guard (dynamoHandler.js's own toNumber
// precedent, mirrored here) — a starch-market doc that's never been written yet must not
// propagate NaN/undefined into a price computation.
function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

// xmur3 string hash -> mulberry32 PRNG, a common minimal seeded-RNG pairing — deterministic
// and evenly-distributed enough for a small in-game roll, no cryptographic requirement.
// Seeded per (userId, tag, slotIndex) so a given player's given rotation's given slot
// always derives the exact same offering on every read, with nothing about it ever
// persisted (see constants.js's CompanionShop comment).
function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    return function () {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    };
}

function mulberry32(seed) {
    let t = seed;
    return function () {
        t |= 0;
        t = (t + 0x6D2B79F5) | 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

function createSeededRandom(userId, tag, slotIndex) {
    const seedFn = xmur3(`${userId}:${tag}:${slotIndex}`);
    return mulberry32(seedFn());
}

// Cumulative walk against this shop's OWN table (CompanionShop.RARITY_ODDS), never
// CompanionRarityOdds — the player asked for Mythic to be "very very rare" here
// specifically and for Heirloom to be excluded entirely, so this shop's odds genuinely
// diverge from /work's roll table (see constants.js's own comment on CompanionShop).
// Object.keys preserves insertion order for these string keys, already ascending.
function rollShopRarity(roll) {
    for (const rarity of Object.keys(CompanionShop.RARITY_ODDS)) {
        if (roll < CompanionShop.RARITY_ODDS[rarity]) {
            return rarity;
        }
    }
    return CompanionRarity.MYTHIC;
}

// One slot's fully-derived offering: rarity, which companion within that rarity
// (companionFactory.getCompanionsByRarity — already excludes dropSource-tagged companions
// like Yukon/Cinderroot/Bastion, same reuse every other roll path in this codebase gets),
// its potato-equivalent price, and whether this slot is starch-priced. potatoPrice is
// ALWAYS the source of truth even for a starch slot — getEffectivePrice below converts it
// to a live starch amount only at view/purchase time, so the slot's real value stays fixed
// while the exact starch number it costs tracks the live market.
function getShopOffering(userId, tag, slotIndex) {
    const rng = createSeededRandom(userId, tag, slotIndex);
    const rarity = rollShopRarity(rng());
    const pool = companionFactory.getCompanionsByRarity(rarity);
    const companion = pool[Math.floor(rng() * pool.length)];
    const varianceRoll = rng();
    const variance = 1 + (varianceRoll * 2 - 1) * CompanionShop.PRICE_VARIANCE;
    const potatoPrice = Math.round(CompanionMarket.MINIMUM_PRICE[rarity] * CompanionShop.PRICE_MULTIPLIER[rarity] * variance);
    const isStarch = rng() < CompanionShop.STARCH_CHANCE;
    return { slotIndex, companionId: companion.id, rarity, potatoPrice, isStarch };
}

// Reads the CURRENT rotation's tags against whatever's stored on the user record and
// resets whichever purchased-slot list has gone stale — same "a tag mismatch means a
// fresh period with nothing done yet" pattern workFactory.js's computePoisonMitigation/
// computeMimicMitigation already use. Purely a read-side computation: nothing is
// persisted here, since the daily/weekly purchased lists only ever need to be written at
// the moment of an actual purchase (attemptPurchaseSlot below) — simply browsing the shop
// never needs a write, unlike Poison/Mimic mitigation which persists on every hit.
function resolveShopState(companionShop, now = new Date()) {
    const dailyTag = getDailyTag(now);
    const weeklyTag = getWeeklyTag(now);
    const isFreshDaily = !companionShop || companionShop.dailyTag !== dailyTag;
    const isFreshWeekly = !companionShop || companionShop.weeklyTag !== weeklyTag;
    return {
        dailyTag,
        weeklyTag,
        dailyPurchasedSlots: isFreshDaily ? [] : (companionShop.dailyPurchasedSlots || []),
        weeklyPurchasedSlots: isFreshWeekly ? [] : (companionShop.weeklyPurchasedSlots || [])
    };
}

// The live starch cost for a potato-denominated value — the inverse of
// spudKeepFactory.convertStarchesToPotatoesForPot's own `potatoes = Math.floor(starches *
// starch_sell)`. Rounds UP (ceil, not floor) so the shop never undercharges a fractional
// starch's worth versus the potato price it's actually standing in for. Returns null if
// the starch market doc is missing/malformed (sellPrice <= 0) rather than dividing by
// zero — callers treat that as "try again shortly," same as any other live-market read
// this codebase already guards this way.
async function getLiveStarchPrice(potatoValue) {
    const starchMarket = await dynamoHandler.getStatDatabase("starch");
    const sellPrice = toNumber(starchMarket && starchMarket.starch_sell);
    if (!(sellPrice > 0)) {
        return null;
    }
    return Math.ceil(potatoValue / sellPrice);
}

// Resolves an offering's real, current cost — { currencyField, amount } — fetching the
// live starch rate only when the slot actually needs it, so a browse of an all-potato page
// never pays for a starch-market read it doesn't need.
async function getEffectivePrice(offering) {
    if (!offering.isStarch) {
        return { currencyField: 'potatoes', amount: offering.potatoPrice };
    }
    const amount = await getLiveStarchPrice(offering.potatoPrice);
    return { currencyField: 'starches', amount };
}

// Builds every slot's full display state for both periods in one pass — one live starch-
// market read shared across every starch-priced slot on the page, rather than one read
// per slot. Used by companionShop.js to render the browse embed; purchasing itself
// re-derives everything fresh via attemptPurchaseSlot rather than trusting this snapshot.
async function buildShopView(userId, userDetails, now = new Date()) {
    const state = resolveShopState(userDetails.companionShop, now);
    const starchMarket = await dynamoHandler.getStatDatabase("starch");
    const starchSellPrice = toNumber(starchMarket && starchMarket.starch_sell);

    const buildSlots = (period, tag, purchasedSlots, slotCount) => Array.from({ length: slotCount }, (_, slotIndex) => {
        const offering = getShopOffering(userId, `${period}:${tag}`, slotIndex);
        const companion = companionFactory.getCompanionById(offering.companionId);
        const purchased = purchasedSlots.includes(slotIndex);
        const price = offering.isStarch
            ? (starchSellPrice > 0 ? Math.ceil(offering.potatoPrice / starchSellPrice) : null)
            : offering.potatoPrice;
        const currencyField = offering.isStarch ? 'starches' : 'potatoes';
        const affordable = price != null && userDetails[currencyField] >= price;
        return { slotIndex, offering, companion, purchased, price, currencyField, affordable };
    });

    return {
        dailyTag: state.dailyTag,
        weeklyTag: state.weeklyTag,
        dailySlots: buildSlots('daily', state.dailyTag, state.dailyPurchasedSlots, CompanionShop.DAILY_SLOT_COUNT),
        weeklySlots: buildSlots('weekly', state.weeklyTag, state.weeklyPurchasedSlots, CompanionShop.WEEKLY_SLOT_COUNT)
    };
}

// The actual purchase — re-fetches userDetails fresh (same discipline every other
// confirm-button flow in this codebase uses) and re-derives the offering/rotation state
// from scratch rather than trusting anything the browse embed had on-page, since it can
// sit open for a while. A pure NPC sink, same shape as shopFactory.attemptShopBuy (buying
// a workShop/bankShop/starchShop tier): the spent currency is simply deducted, never
// credited anywhere — this is an NPC storefront, not a CompanionMarket trade between two
// players. `period` is 'daily' or 'weekly'.
async function attemptPurchaseSlot(userId, username, period, slotIndex, now = new Date()) {
    const freshUserDetails = await dynamoHandler.findUser(userId, username);
    if (!freshUserDetails) {
        return { ok: false, message: `could not be looked up due to a database error, please try again!` };
    }

    const slotCount = period === 'daily' ? CompanionShop.DAILY_SLOT_COUNT : CompanionShop.WEEKLY_SLOT_COUNT;
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slotCount) {
        return { ok: false, message: `that slot doesn't exist.` };
    }

    const state = resolveShopState(freshUserDetails.companionShop, now);
    const purchasedSlots = period === 'daily' ? state.dailyPurchasedSlots : state.weeklyPurchasedSlots;
    if (purchasedSlots.includes(slotIndex)) {
        return { ok: false, message: `you've already bought that slot this rotation — there's no reroll, but a new one rotates in next time.` };
    }

    const tag = period === 'daily' ? state.dailyTag : state.weeklyTag;
    const offering = getShopOffering(userId, `${period}:${tag}`, slotIndex);
    const companion = companionFactory.getCompanionById(offering.companionId);

    const { currencyField, amount: cost } = await getEffectivePrice(offering);
    if (cost == null) {
        return { ok: false, message: `the starch market is unavailable right now — please try again shortly.` };
    }
    if (freshUserDetails[currencyField] < cost) {
        return { ok: false, message: `you need ${cost.toLocaleString()} ${currencyField} for this slot but only have ${freshUserDetails[currencyField].toLocaleString()}.` };
    }

    const { companions: updatedCompanions } = companionFactory.applyCompanionAward(freshUserDetails, companion, 0);
    const updatedPurchasedSlots = [...purchasedSlots, slotIndex];
    const updatedCompanionShop = {
        dailyTag: state.dailyTag,
        weeklyTag: state.weeklyTag,
        dailyPurchasedSlots: period === 'daily' ? updatedPurchasedSlots : state.dailyPurchasedSlots,
        weeklyPurchasedSlots: period === 'weekly' ? updatedPurchasedSlots : state.weeklyPurchasedSlots
    };

    await dynamoHandler.updateUserFields(userId, {
        [currencyField]: freshUserDetails[currencyField] - cost,
        companions: updatedCompanions,
        companionShop: updatedCompanionShop
    });

    return { ok: true, message: `you bought ${companion.name} for ${cost.toLocaleString()} ${currencyField}! Use /companion to equip it.` };
}

module.exports = {
    getDailyTag,
    getWeeklyTag,
    rollShopRarity,
    getShopOffering,
    resolveShopState,
    getLiveStarchPrice,
    getEffectivePrice,
    buildShopView,
    attemptPurchaseSlot
}
