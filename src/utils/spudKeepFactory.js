const dynamoHandler = require("../utils/dynamoHandler");
const { RaidFactory, getLiveRaidRoster, getMemberRaidPower, getEffectiveRaidPowerBreakdown } = require("../utils/raidFactory");
const { getWorldBuffWorkMultiPercent } = require("../utils/workFactory");
const { SpudKeep } = require("../utils/constants");

const raidFactory = new RaidFactory();

// getUsers()-style external/partial data guard (dynamoHandler.js's own toNumber
// precedent) — a stats-table doc that's never been written yet, or a pot field left
// over from before this feature existed, must not propagate NaN into an ADD/split.
function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

// The load-bearing design decision for the whole feature (see roadmap.md's "The holder
// buff — a genuinely new pattern" section) — a buff that's live for exactly one CLASS of
// user (every current mercenary, or every current member of one guild) without being a
// per-user write or a per-user field. Evaluated live, at read time, off a field the user
// record already has (guildId for the guild case, isMercenary for the Faction case) — NOT
// a reuse of isSpudKeepHolderLive below, which answers a different, broader question
// ("is a holder live at all," independent of who's asking).
function isSpudKeepBuffLiveForUser(buff, userDetails, buffType) {
    if (!buff || buff.buffType !== buffType || !buff.expiresAt || buff.expiresAt <= Date.now()) return false;
    if (buff.holderType === "guild") return Boolean(userDetails) && userDetails.guildId === buff.holderId;
    if (buff.holderType === "mercenary") return Boolean(userDetails) && userDetails.isMercenary === true;
    return false;
}

// The tax-redirect predicate — deliberately separate from isSpudKeepBuffLiveForUser, not
// a reuse of it (see roadmap.md's own "New predicate" section). Answers "is a holder live
// at all," independent of buff type and of the paying user's own guild/mercenary status.
function isSpudKeepHolderLive(buff) {
    return Boolean(buff && buff.holderType && buff.expiresAt > Date.now());
}

// Splits one taxed amount between the house account and the pot, IN WHATEVER CURRENCY
// taxAmount itself is denominated. Returns houseAmount === taxAmount and potAmount === 0
// whenever no holder is live — today's exact pre-Spud-Keep behavior, byte-identical, so
// every one of the ~7 tax call sites degrades to untouched behavior the moment the Keep
// goes unclaimed. The pot itself only ever stores potatoes (see creditSpudKeepPot below)
// — a caller whose taxAmount is starch-denominated (currently only /give's starch-tax
// branch) must convert potAmount via convertStarchesToPotatoesForPot before crediting it;
// houseAmount is always credited back in the SAME currency taxAmount came in as.
async function splitTaxForSpudKeepPot(taxAmount) {
    const buff = await dynamoHandler.getActiveSpudKeepBuff();
    if (!isSpudKeepHolderLive(buff)) return { houseAmount: taxAmount, potAmount: 0 };
    const potAmount = Math.floor(taxAmount * SpudKeep.POT_REDIRECT_PERCENT);
    return { houseAmount: taxAmount - potAmount, potAmount }; // subtraction, not a second
                                                                // Math.floor — guarantees
                                                                // houseAmount + potAmount
                                                                // always equals taxAmount
}

// The pot is potato-only (2026-08-30 simplification — no separate potStarches counter,
// so guilds and mercenaries alike are always paid out in one currency). /give's
// starch-tax branch is the one tax site whose split amount isn't already potato-
// denominated — convert it to potatoes at the CURRENT starch sell price (the same price
// /sell-starch itself reads, dynamoHandler.getStatDatabase("starch").starch_sell, never
// the buy price) before handing it to creditSpudKeepPot below. A missing/malformed
// starch-market doc guards to 0 (toNumber) rather than propagating NaN into the pot.
async function convertStarchesToPotatoesForPot(starchAmount) {
    if (!(starchAmount > 0)) return 0;
    const starchMarket = await dynamoHandler.getStatDatabase("starch");
    const sellPrice = toNumber(starchMarket && starchMarket.starch_sell);
    return Math.floor(starchAmount * sellPrice);
}

// One-line atomic-ADD consumer for every tax site — never a read-then-write, so many
// unrelated tax events across the whole server firing at the same instant each land
// safely (dynamoHandler.addStatFields's own atomic `add` UpdateExpression). Always
// potatoes — see convertStarchesToPotatoesForPot above for the one caller that needs a
// currency conversion first.
async function creditSpudKeepPot(potatoAmount) {
    if (!(potatoAmount > 0)) return;
    await dynamoHandler.addStatFields('spud_keep', { potPotatoes: potatoAmount });
}

// Attacker's bonus (2026-08-30 follow-up, direct instruction) — every non-holder
// entrant's power is multiplied by this before the lottery roll. Capped escalation,
// mirroring PoisonMitigation's own shape: streak 0/1/2/3/4+ -> +0/15/30/45/60% on top of
// the flat base.
function getAttackerBonusMultiplier(consecutiveHoldCycles) {
    const cycles = Math.min(toNumber(consecutiveHoldCycles), SpudKeep.ATTACKER_BONUS_STREAK_CAP);
    return 1 + SpudKeep.ATTACKER_BONUS_BASE + SpudKeep.ATTACKER_BONUS_PER_HOLD_CYCLE * cycles;
}

// Holder's own compounding buff value (2026-08-31, direct instruction: "if players hold
// the spud keep multiple days in a row, the buff portion compounds ... 8% ... scale it up
// to a maximum of 40% each for 5 days held") — same consecutiveHoldCycles counter and cap
// shape as getAttackerBonusMultiplier above, just read by the DEFENDING side's own reward
// instead of every attacker's odds. Shared by both the passive and cooldown halves of the
// bundle (called once per track with that track's own base/per-cycle/max constants) since
// they're deliberately symmetric. At cycles 0/1/2/3/4+ (a fresh capture through 4
// successful defenses, i.e. day 1 through day 5+ of an unbroken hold) this returns exactly
// 8%/16%/24%/32%/40% for either track.
function getCompoundingBuffValue(baseValue, perHoldCycleValue, maxValue, consecutiveHoldCycles) {
    const cycles = Math.min(toNumber(consecutiveHoldCycles), SpudKeep.HOLD_BUFF_STREAK_CAP);
    return Math.min(baseValue + perHoldCycleValue * cycles, maxValue);
}

// N = the largest signed-up guild's own live raid roster headcount that cycle, computed
// off the same live rosters the guild-side power calc already fetched, no extra reads.
// No floor (2026-09-03, direct instruction) — if no guild has signed up this cycle (or
// every signed-up guild's own live roster is currently empty), N is 0 and the Merc
// Faction counts zero mercenaries, same as any other 0-power entrant (see resolveCycle's
// own "skip the lottery entirely if every entrant has 0 power" guard).
function getMercFactionN(guildRosterLengths) {
    return guildRosterLengths.length > 0 ? Math.max(...guildRosterLengths) : 0;
}

// The live Merc Faction roster: every current mercenary whose persistent autoJoinSpudKeep
// toggle (/spud-keep-signup) is on, fetched fresh on every call — same "computed live off
// a persistent flag, no stored per-cycle list" shape raidFactory.getLiveRaidRoster already
// uses for guild raids (autoJoinRaids). Replaces the old push-on-signup/wiped-every-
// resolution spud_keep.mercenaryEntrants array, which required a fresh /spud-keep-signup
// every single cycle just to keep participating. dynamoHandler.getUsers() is a raw,
// whole-table scan (same cost/precedent as passivePotatoHandler's own per-tick use of it)
// — filtered here rather than via a guild's small memberList, since mercenaries aren't
// grouped anywhere else. Returns the same {id, username}[] shape mercenaryEntrants used
// to, so every downstream consumer is unchanged.
async function getLiveMercFactionRoster() {
    const allUsers = await dynamoHandler.getUsers();
    return allUsers
        .filter(u => u.isMercenary === true && u.autoJoinSpudKeep === true)
        .map(u => ({ id: u.userId, username: u.username }));
}

// Ranked by full computed power (getMemberRaidPower — workMultiplierAmount * (1 +
// rebirth% + companion%)), not the bare stat — the exact same per-member figure a guild
// roster's own members are ranked/weighted by. Missing/malformed entries (a lookup
// failure) are dropped, mirroring getLiveRaidRoster's own "excluded, not a throw"
// precedent. No padding if fewer than N signed up — however many actually did.
function selectTopNMercenaries(mercUserDetailsList, n) {
    return mercUserDetailsList
        .filter(Boolean)
        .sort((a, b) => getMemberRaidPower(b) - getMemberRaidPower(a))
        .slice(0, n);
}

// Splits the outgoing holder's pot payout proportionally by each participant's OWN raw
// workMultiplierAmount "at the time of the spud keep battle" (direct instruction,
// 2026-08-30) — re-fetched fresh here at resolution time, never reused from an earlier
// snapshot, matching this whole feature's "always read live" precedent (getLiveRaidRoster/
// getGuildEntrantBreakdown above do the same). Deliberately the raw workMultiplierAmount
// stat, not getMemberRaidPower's rebirth/companion-inflated figure — matches the user's
// own literal framing ("their multi") rather than the guild-raid "share" mode's broader
// definition of strength. Falls back to an even split only if every fetched participant's
// workMultiplierAmount is 0 (e.g. an all-fresh-account roster with nothing yet to weight
// against), so a payout is never silently dropped to 0 for everyone. Each share is
// credited to spudKeepPendingPotatoes via its own atomic ADD (dynamoHandler.addUserDatabase)
// — never straight to potatoes (direct instruction: a lump sum landing in every winner's
// liquid balance the instant the cycle resolves would make each daily reset a guaranteed
// rob target) — collected later, whenever the player chooses, via /spud-keep-collect.
// Returns the per-player shares (id/username/amount) so the result embed can show exactly
// who got what.
async function splitPotByWorkMulti(roster, potPotatoesPaid) {
    const userDetailsList = await Promise.all(roster.map(m => dynamoHandler.findUser(m.id, m.username)));
    const weights = userDetailsList.map(u => Math.max(0, toNumber(u && u.workMultiplierAmount)));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    const useEvenSplit = !(totalWeight > 0);

    const shares = roster.map((member, index) => {
        const ratio = useEvenSplit ? (1 / roster.length) : (weights[index] / totalWeight);
        return { id: member.id, username: member.username, amount: Math.floor(potPotatoesPaid * ratio) };
    });

    await Promise.all(shares
        .filter(s => s.amount > 0)
        .map(s => dynamoHandler.addUserDatabase(s.id, 'spudKeepPendingPotatoes', s.amount)));

    return shares;
}

// Whether `buff`'s CURRENT holder is this specific entrant — used both to exempt the
// holder from the attacker's bonus and to find the outgoing holder's own roster for the
// pot payout. A mercenary entrant matches purely on holderType (there's only ever one
// Merc Faction pseudo-entrant per cycle, so no id to compare); a guild entrant also needs
// its own guildId to match holderId.
function isCurrentHolderEntrant(buff, entrantType, entrantId) {
    if (!buff || !buff.holderType) return false;
    if (buff.holderType !== entrantType) return false;
    return entrantType === 'mercenary' ? true : buff.holderId === entrantId;
}

// One entrant per guildEntrants row, live at read time (never snapshotted) — a guild
// whose live roster is now empty (autoJoinRaids all toggled off, or the guild disbanded)
// naturally computes to 0 power, no special-casing needed.
async function getGuildEntrantBreakdown(guildId) {
    const guild = await dynamoHandler.findGuildById(guildId);
    if (!guild) return null;
    const roster = await getLiveRaidRoster(guild);
    const memberDetailsList = await Promise.all(roster.map(m => dynamoHandler.findUser(m.id, m.username)));
    const breakdown = getEffectiveRaidPowerBreakdown(memberDetailsList);
    return { guildId: guild.guildId, guildName: guild.guildName, roster, breakdown };
}

// Draws one winner from a cumulative-chance loop over `effectivePower` — same
// cumulative-roll shape raidFactory.rollWeightedTier already uses. Returns null if every
// entrant's effectivePower is 0 (nothing to weight against).
function rollLottery(weightedEntrants) {
    const total = weightedEntrants.reduce((sum, e) => sum + e.effectivePower, 0);
    if (!(total > 0)) return null;
    const roll = Math.random();
    let cumulative = 0;
    for (const entrant of weightedEntrants) {
        cumulative += entrant.effectivePower / total;
        if (roll < cumulative) return entrant;
    }
    return weightedEntrants[weightedEntrants.length - 1]; // floating-point safety net
}

// Everything a live view of this cycle's contest needs — shared, side-effect-free
// (no writes) computation reused by BOTH /current-spud-keep's read-only preview and
// resolveCycle's own resolution below, so the two never drift out of sync on how
// power/odds are computed. Re-derives every entrant's power fresh off live data (same
// "always read the roster fresh" precedent Guild Raid/guild buffs already follow) —
// nothing here is snapshotted at signup time.
async function buildEntrantPreview() {
    const spudKeep = await dynamoHandler.getStatDatabase("spud_keep") || { guildEntrants: [], potPotatoes: 0 };
    const currentBuff = await dynamoHandler.getActiveSpudKeepBuff();
    const cooldownBuff = await dynamoHandler.getActiveSpudKeepCooldownBuff();

    const guildEntrantIds = (spudKeep.guildEntrants || []).map(g => g.guildId);
    const guildEntries = (await Promise.all(guildEntrantIds.map(id => getGuildEntrantBreakdown(id)))).filter(Boolean);

    // Auto-re-enter the current holder if it's a guild not already in this cycle's
    // guildEntrants — "no action required to defend." Computed for this preview/
    // resolution only, never persisted back into guildEntrants (which is cleared
    // regardless at resolution). The Merc Faction needs no equivalent branch — it's a
    // structurally always-present pseudo-entrant every cycle, nothing to "forget."
    if (currentBuff && currentBuff.holderType === "guild" && currentBuff.holderId
        && !guildEntries.some(g => g.guildId === currentBuff.holderId)) {
        const holderEntry = await getGuildEntrantBreakdown(currentBuff.holderId);
        if (holderEntry) guildEntries.push(holderEntry);
    }

    const mercFactionN = getMercFactionN(guildEntries.map(g => g.roster.length));
    const mercenaryEntrants = await getLiveMercFactionRoster();
    const mercUserDetails = await Promise.all(mercenaryEntrants.map(m => dynamoHandler.findUser(m.id, m.username)));
    const countedMercs = selectTopNMercenaries(mercUserDetails, mercFactionN);
    const mercBreakdown = getEffectiveRaidPowerBreakdown(countedMercs);

    const entrants = [
        ...guildEntries.map(g => ({
            type: 'guild', id: g.guildId, name: g.guildName,
            roster: g.roster, breakdown: g.breakdown
        })),
        {
            type: 'mercenary', id: null, name: 'The Merc Faction',
            roster: countedMercs.map(u => ({ id: u.userId, username: u.username })),
            breakdown: mercBreakdown,
            mercFactionN, mercSignedUpCount: mercenaryEntrants.length, mercCountedCount: countedMercs.length
        }
    ];

    const consecutiveHoldCycles = toNumber(currentBuff && currentBuff.consecutiveHoldCycles);
    const attackerBonusMultiplier = getAttackerBonusMultiplier(consecutiveHoldCycles);

    // World Boss's workMulti buff (2026-09-04, direct instruction) — applied uniformly to
    // every entrant BEFORE the Attacker's Bonus split (unlike that bonus, this isn't a
    // targeted-at-challengers mechanic — it's a real, current strength boost that applies
    // equally whether you're holding the Keep or attacking it), same "fetched once,
    // multiplied in separately" shape startRaid.js/mercenaryFactory.js use rather than
    // folded into raidFactory.getEffectiveRaidPowerBreakdown itself (reused as-is by
    // Tower's entry gate, which deliberately excludes it).
    const worldBuffPercent = await getWorldBuffWorkMultiPercent();

    const weightedEntrants = entrants.map(e => {
        const isHolder = isCurrentHolderEntrant(currentBuff, e.type, e.id);
        const power = e.breakdown.effectivePower * (1 + worldBuffPercent);
        return {
            ...e,
            power,
            isHolder,
            effectivePower: isHolder ? power : power * attackerBonusMultiplier
        };
    });
    const totalWeightedPower = weightedEntrants.reduce((sum, e) => sum + e.effectivePower, 0);
    const withChance = weightedEntrants.map(e => ({
        ...e,
        chancePercent: totalWeightedPower > 0 ? e.effectivePower / totalWeightedPower : 0
    }));

    return {
        spudKeep, currentBuff, cooldownBuff, entrants: withChance,
        consecutiveHoldCycles, attackerBonusPercent: attackerBonusMultiplier - 1
    };
}

// The full daily resolution (`spudKeepFactory.resolveCycle()`, called from
// backgroundEvents.js's existing 4am UTC cron) — see roadmap.md's own numbered
// resolution flow for the derivation of every step below.
async function resolveCycle() {
    const preview = await buildEntrantPreview();
    const { spudKeep, currentBuff, entrants, consecutiveHoldCycles } = preview;

    // Step 5's edge case: if every entrant's RAW power is 0 (nobody signed up at all,
    // including no live holder roster), skip the lottery entirely — no resolution, no
    // buff write, nothing about the Keep's state changes (including
    // consecutiveHoldCycles, left untouched) until a future cycle has a nonzero entrant.
    const totalRawPower = entrants.reduce((sum, e) => sum + e.power, 0);
    if (!(totalRawPower > 0)) {
        return { skipped: true };
    }

    // Step 6 — roll (effectivePower already carries the attacker's bonus baked in).
    const winner = rollLottery(entrants);

    // Step 7 — grant both halves of the bundle buff, replacing outright even on a
    // successful defense (fresh expiresAt, zero coverage gap). Both values are computed
    // off newConsecutiveHoldCycles (not the flat SpudKeep.*_BUFF_VALUE constants) so an
    // unbroken hold compounds — see getCompoundingBuffValue above.
    const isSameHolder = isCurrentHolderEntrant(currentBuff, winner.type, winner.id);
    const newConsecutiveHoldCycles = isSameHolder ? consecutiveHoldCycles + 1 : 0;
    const expiresAt = Date.now() + SpudKeep.CONTEST_INTERVAL_SECONDS * 1000;
    const holderType = winner.type;
    const holderId = winner.type === 'guild' ? winner.id : null;
    const holderName = winner.name;
    const passiveBuffValue = getCompoundingBuffValue(SpudKeep.PASSIVE_BUFF_VALUE, SpudKeep.PASSIVE_BUFF_PER_HOLD_CYCLE, SpudKeep.PASSIVE_BUFF_MAX_VALUE, newConsecutiveHoldCycles);
    const cooldownBuffValue = getCompoundingBuffValue(SpudKeep.COOLDOWN_BUFF_VALUE, SpudKeep.COOLDOWN_BUFF_PER_HOLD_CYCLE, SpudKeep.COOLDOWN_BUFF_MAX_VALUE, newConsecutiveHoldCycles);

    await dynamoHandler.setActiveSpudKeepBuff({
        holderType, holderId, holderName,
        buffType: SpudKeep.PASSIVE_BUFF_TYPE, value: passiveBuffValue,
        expiresAt, consecutiveHoldCycles: newConsecutiveHoldCycles
    });
    await dynamoHandler.setActiveSpudKeepCooldownBuff({
        holderType, holderId, holderName,
        buffType: SpudKeep.COOLDOWN_BUFF_TYPE, value: cooldownBuffValue,
        expiresAt
    });

    // Step 7b — split the accruing pot ONE TIME among the OUTGOING holder's own roster
    // this cycle (a guild's live raid roster, or the Merc Faction's counted top-N),
    // weighted by each participant's own workMultiplierAmount at this exact resolution
    // moment (splitPotByWorkMulti above) — using potPotatoes exactly as read back at the
    // top of buildEntrantPreview (never re-read). The pot is potato-only (no separate
    // starch counter — every starch-denominated tax contribution was already converted to
    // potatoes at credit time, see spudKeepFactory.convertStarchesToPotatoesForPot). No
    // previous holder at all (pre-first-ever-resolution) skips this entirely — nothing
    // could have accrued. An empty outgoing roster (holder's guild disbanded/emptied
    // mid-cycle) forfeits the pot instead — discarded, not paid to anyone, not rolled
    // forward (see step 8's subtraction below).
    let potPotatoesPaid = 0, outgoingHolderName = null, potForfeited = false, payoutShares = [];
    if (currentBuff && currentBuff.holderType) {
        outgoingHolderName = currentBuff.holderName;
        const outgoingEntrant = entrants.find(e => isCurrentHolderEntrant(currentBuff, e.type, e.id));
        const outgoingRoster = outgoingEntrant ? outgoingEntrant.roster : [];
        const potPotatoes = toNumber(spudKeep.potPotatoes);

        if (outgoingRoster.length > 0) {
            if (potPotatoes > 0) payoutShares = await splitPotByWorkMulti(outgoingRoster, potPotatoes);
        } else if (potPotatoes > 0) {
            potForfeited = true;
        }
        potPotatoesPaid = potPotatoes;
    }

    // Step 8 — clear the per-cycle guild entrant list AND subtract exactly what was just
    // paid out (or forfeited) from the pot — never a blind `set potPotatoes = 0`. A
    // concurrent tax event's own addStatFields ADD landing between buildEntrantPreview's
    // own read and this write is NOT destroyed, since subtracting a known exact amount
    // commutes with a concurrent ADD regardless of ordering. Nothing to clear on the
    // mercenary side anymore — the Merc Faction roster is read live off each mercenary's
    // own persistent autoJoinSpudKeep toggle (getLiveMercFactionRoster), not a per-cycle
    // list that needs wiping.
    await dynamoHandler.updateStatFields("spud_keep", { guildEntrants: [], lastResolvedAt: Date.now() });
    if (potPotatoesPaid > 0) {
        await dynamoHandler.addStatFields("spud_keep", { potPotatoes: -potPotatoesPaid });
    }

    // Step 9 — participation counter: every guild entrant's own live roster (auto-
    // re-entered holder included), and the Merc Faction's counted top-N only — never
    // every signed-up mercenary, never server-wide (a deliberately narrower scope than
    // the buff grant above, which IS server-wide).
    await Promise.all(entrants
        .filter(e => e.roster.length > 0)
        .map(e => raidFactory.incrementCounter(e.roster, 'spudKeepAttemptCount')));

    return {
        skipped: false,
        winner: { type: winner.type, id: winner.id, name: winner.name },
        holderChanged: !isSameHolder,
        consecutiveHoldCycles: newConsecutiveHoldCycles,
        expiresAt,
        passiveBuffValue,
        cooldownBuffValue,
        attackerBonusPercent: preview.attackerBonusPercent,
        entrants: entrants.map(e => ({
            type: e.type, id: e.id, name: e.name, power: e.power, effectivePower: e.effectivePower,
            chancePercent: e.chancePercent, isHolder: e.isHolder, breakdown: e.breakdown,
            ...(e.type === 'mercenary' ? { mercFactionN: e.mercFactionN, mercSignedUpCount: e.mercSignedUpCount, mercCountedCount: e.mercCountedCount } : {})
        })),
        potPotatoesPaid,
        potForfeited,
        outgoingHolderName,
        payoutShares
    };
}

module.exports = {
    isSpudKeepBuffLiveForUser,
    isSpudKeepHolderLive,
    splitTaxForSpudKeepPot,
    convertStarchesToPotatoesForPot,
    creditSpudKeepPot,
    getAttackerBonusMultiplier,
    getCompoundingBuffValue,
    getMercFactionN,
    getLiveMercFactionRoster,
    selectTopNMercenaries,
    splitPotByWorkMulti,
    isCurrentHolderEntrant,
    rollLottery,
    buildEntrantPreview,
    resolveCycle
}
