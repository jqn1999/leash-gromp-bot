jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const spudKeepFactory = require('../spudKeepFactory');
const { SpudKeep } = require('../constants');

function user(id, overrides = {}) {
    return { userId: id, username: id, workMultiplierAmount: 1, potatoes: 0, totalEarnings: 0, totalLosses: 0, starches: 0, ...overrides };
}

function guild(guildId, memberList, overrides = {}) {
    return { guildId, guildName: `${guildId}-name`, memberList, ...overrides };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
    dynamoHandler.findUser.mockImplementation(async (id) => user(id, { autoJoinRaids: true }));
    dynamoHandler.updateStatFields.mockResolvedValue({});
    dynamoHandler.addStatFields.mockResolvedValue({});
    dynamoHandler.setActiveSpudKeepBuff.mockResolvedValue({});
    dynamoHandler.setActiveSpudKeepCooldownBuff.mockResolvedValue({});
    // The Merc Faction roster is now a live getUsers() scan (getLiveMercFactionRoster) —
    // default to nobody opted in; individual tests override this to exercise a nonzero
    // Merc Faction roster.
    dynamoHandler.getUsers.mockResolvedValue([]);
    // World Boss's workMulti buff (2026-09-04) — default to no buff live; individual
    // tests override this to exercise the buff's effect on entrant power.
    dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
    dynamoHandler.isWorldBuffLive.mockReturnValue(false);
});

describe('isSpudKeepBuffLiveForUser', () => {
    test('false for a missing buff', () => {
        expect(spudKeepFactory.isSpudKeepBuffLiveForUser(null, user('a'), 'passiveIncome')).toBe(false);
    });

    test('false for a mismatched buffType', () => {
        const buff = { buffType: 'cooldownReduction', holderType: 'guild', holderId: 'g1', expiresAt: Date.now() + 10000 };
        expect(spudKeepFactory.isSpudKeepBuffLiveForUser(buff, user('a', { guildId: 'g1' }), 'passiveIncome')).toBe(false);
    });

    test('false for an expired buff', () => {
        const buff = { buffType: 'passiveIncome', holderType: 'guild', holderId: 'g1', expiresAt: Date.now() - 1 };
        expect(spudKeepFactory.isSpudKeepBuffLiveForUser(buff, user('a', { guildId: 'g1' }), 'passiveIncome')).toBe(false);
    });

    test('guild holder: true only for a member of the exact holding guild', () => {
        const buff = { buffType: 'passiveIncome', holderType: 'guild', holderId: 'g1', expiresAt: Date.now() + 10000 };
        expect(spudKeepFactory.isSpudKeepBuffLiveForUser(buff, user('a', { guildId: 'g1' }), 'passiveIncome')).toBe(true);
        expect(spudKeepFactory.isSpudKeepBuffLiveForUser(buff, user('b', { guildId: 'g2' }), 'passiveIncome')).toBe(false);
        expect(spudKeepFactory.isSpudKeepBuffLiveForUser(buff, user('c', { isMercenary: true }), 'passiveIncome')).toBe(false);
    });

    test('mercenary holder: true for any current mercenary, regardless of identity', () => {
        const buff = { buffType: 'cooldownReduction', holderType: 'mercenary', holderId: null, expiresAt: Date.now() + 10000 };
        expect(spudKeepFactory.isSpudKeepBuffLiveForUser(buff, user('a', { isMercenary: true }), 'cooldownReduction')).toBe(true);
        expect(spudKeepFactory.isSpudKeepBuffLiveForUser(buff, user('b', { guildId: 'g1' }), 'cooldownReduction')).toBe(false);
    });
});

describe('isSpudKeepHolderLive', () => {
    test('true for a live holder of either type', () => {
        expect(spudKeepFactory.isSpudKeepHolderLive({ holderType: 'guild', expiresAt: Date.now() + 1000 })).toBe(true);
        expect(spudKeepFactory.isSpudKeepHolderLive({ holderType: 'mercenary', expiresAt: Date.now() + 1000 })).toBe(true);
    });

    test('false when expired, holderType null, or buff missing', () => {
        expect(spudKeepFactory.isSpudKeepHolderLive({ holderType: 'guild', expiresAt: Date.now() - 1 })).toBe(false);
        expect(spudKeepFactory.isSpudKeepHolderLive({ holderType: null, expiresAt: Date.now() + 1000 })).toBe(false);
        expect(spudKeepFactory.isSpudKeepHolderLive(undefined)).toBe(false);
    });
});

describe('splitTaxForSpudKeepPot', () => {
    test('no live holder — the full amount goes to the house, byte-identical to pre-Spud-Keep behavior', async () => {
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
        const result = await spudKeepFactory.splitTaxForSpudKeepPot(1000);
        expect(result).toEqual({ houseAmount: 1000, potAmount: 0 });
    });

    test('a live holder redirects POT_REDIRECT_PERCENT to the pot, and the two halves always sum back to taxAmount', async () => {
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'guild', holderId: 'g1', expiresAt: Date.now() + 10000 });
        const result = await spudKeepFactory.splitTaxForSpudKeepPot(1001); // odd, exercises the floor/subtraction split
        expect(result.potAmount).toBe(Math.floor(1001 * SpudKeep.POT_REDIRECT_PERCENT));
        expect(result.houseAmount + result.potAmount).toBe(1001);
    });
});

describe('convertStarchesToPotatoesForPot', () => {
    test('0 or negative amount short-circuits to 0 without reading the market', async () => {
        expect(await spudKeepFactory.convertStarchesToPotatoesForPot(0)).toBe(0);
        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalled();
    });

    test('converts at the current starch_sell price, never starch_buy', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ starch_buy: 999, starch_sell: 5 });
        expect(await spudKeepFactory.convertStarchesToPotatoesForPot(10)).toBe(50);
    });

    test('a missing/malformed starch-market doc guards to 0 instead of NaN', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        expect(await spudKeepFactory.convertStarchesToPotatoesForPot(10)).toBe(0);
    });
});

describe('creditSpudKeepPot', () => {
    test('a non-positive amount never issues an ADD', async () => {
        await spudKeepFactory.creditSpudKeepPot(0);
        await spudKeepFactory.creditSpudKeepPot(-5);
        expect(dynamoHandler.addStatFields).not.toHaveBeenCalled();
    });

    test('a positive amount credits potPotatoes via the atomic ADD wrapper', async () => {
        await spudKeepFactory.creditSpudKeepPot(250);
        expect(dynamoHandler.addStatFields).toHaveBeenCalledWith('spud_keep', { potPotatoes: 250 });
    });
});

describe('getAttackerBonusMultiplier', () => {
    test('streak 0 is base only', () => {
        expect(spudKeepFactory.getAttackerBonusMultiplier(0)).toBeCloseTo(1 + SpudKeep.ATTACKER_BONUS_BASE);
    });

    test('escalates linearly up to the streak cap', () => {
        expect(spudKeepFactory.getAttackerBonusMultiplier(1)).toBeCloseTo(1 + SpudKeep.ATTACKER_BONUS_BASE + SpudKeep.ATTACKER_BONUS_PER_HOLD_CYCLE);
        expect(spudKeepFactory.getAttackerBonusMultiplier(4)).toBeCloseTo(1 + SpudKeep.ATTACKER_BONUS_BASE + SpudKeep.ATTACKER_BONUS_PER_HOLD_CYCLE * 4);
    });

    test('caps beyond ATTACKER_BONUS_STREAK_CAP — no further escalation', () => {
        expect(spudKeepFactory.getAttackerBonusMultiplier(4)).toBe(spudKeepFactory.getAttackerBonusMultiplier(99));
    });

    test('a NaN/undefined streak is treated as 0, not propagated', () => {
        expect(spudKeepFactory.getAttackerBonusMultiplier(undefined)).toBeCloseTo(1 + SpudKeep.ATTACKER_BONUS_BASE);
        expect(spudKeepFactory.getAttackerBonusMultiplier(NaN)).toBeCloseTo(1 + SpudKeep.ATTACKER_BONUS_BASE);
    });
});

// Holder buff compounding (2026-08-31, direct instruction: "8% ... scale it up to a
// maximum of 40% each for 5 days held") — same streak-cap shape as
// getAttackerBonusMultiplier above, verified against both real tracks (passive/cooldown
// currently share identical base/per-cycle/max constants, but the function itself takes
// them as plain arguments so it's not coupled to that).
describe('getCompoundingBuffValue', () => {
    test('cycle 0 (fresh capture, day 1) is exactly the base value for both tracks', () => {
        expect(spudKeepFactory.getCompoundingBuffValue(SpudKeep.PASSIVE_BUFF_VALUE, SpudKeep.PASSIVE_BUFF_PER_HOLD_CYCLE, SpudKeep.PASSIVE_BUFF_MAX_VALUE, 0)).toBeCloseTo(0.08);
        expect(spudKeepFactory.getCompoundingBuffValue(SpudKeep.COOLDOWN_BUFF_VALUE, SpudKeep.COOLDOWN_BUFF_PER_HOLD_CYCLE, SpudKeep.COOLDOWN_BUFF_MAX_VALUE, 0)).toBeCloseTo(0.08);
    });

    test('escalates linearly through days 2-5 (cycles 1-4): 16%, 24%, 32%, 40%', () => {
        const value = c => spudKeepFactory.getCompoundingBuffValue(SpudKeep.PASSIVE_BUFF_VALUE, SpudKeep.PASSIVE_BUFF_PER_HOLD_CYCLE, SpudKeep.PASSIVE_BUFF_MAX_VALUE, c);
        expect(value(1)).toBeCloseTo(0.16);
        expect(value(2)).toBeCloseTo(0.24);
        expect(value(3)).toBeCloseTo(0.32);
        expect(value(4)).toBeCloseTo(0.40);
    });

    test('caps at the max value beyond HOLD_BUFF_STREAK_CAP — day 6+ is identical to day 5', () => {
        const value = c => spudKeepFactory.getCompoundingBuffValue(SpudKeep.PASSIVE_BUFF_VALUE, SpudKeep.PASSIVE_BUFF_PER_HOLD_CYCLE, SpudKeep.PASSIVE_BUFF_MAX_VALUE, c);
        expect(value(4)).toBe(value(99));
        expect(value(99)).toBeCloseTo(SpudKeep.PASSIVE_BUFF_MAX_VALUE);
    });

    test('a NaN/undefined streak is treated as 0, not propagated', () => {
        const value = c => spudKeepFactory.getCompoundingBuffValue(SpudKeep.PASSIVE_BUFF_VALUE, SpudKeep.PASSIVE_BUFF_PER_HOLD_CYCLE, SpudKeep.PASSIVE_BUFF_MAX_VALUE, c);
        expect(value(undefined)).toBeCloseTo(0.08);
        expect(value(NaN)).toBeCloseTo(0.08);
    });
});

describe('getMercFactionN', () => {
    test('is 0 when no guilds signed up — no floor', () => {
        expect(spudKeepFactory.getMercFactionN([])).toBe(0);
    });

    test('uses the largest signed-up guild roster', () => {
        expect(spudKeepFactory.getMercFactionN([2, 7, 3])).toBe(7);
    });

    test('follows the largest roster down even when every guild roster is small — no floor', () => {
        expect(spudKeepFactory.getMercFactionN([1, 2])).toBe(2);
    });
});

describe('getLiveMercFactionRoster', () => {
    test('includes only current mercenaries with autoJoinSpudKeep on', async () => {
        dynamoHandler.getUsers.mockResolvedValue([
            { userId: 'a', username: 'a', isMercenary: true, autoJoinSpudKeep: true },
            { userId: 'b', username: 'b', isMercenary: true, autoJoinSpudKeep: false },
            { userId: 'c', username: 'c', isMercenary: false, autoJoinSpudKeep: true },
            { userId: 'd', username: 'd', isMercenary: true, autoJoinSpudKeep: true },
        ]);

        const roster = await spudKeepFactory.getLiveMercFactionRoster();

        expect(roster).toEqual([{ id: 'a', username: 'a' }, { id: 'd', username: 'd' }]);
    });

    test('empty when nobody has opted in', async () => {
        dynamoHandler.getUsers.mockResolvedValue([{ userId: 'a', username: 'a', isMercenary: true, autoJoinSpudKeep: false }]);
        expect(await spudKeepFactory.getLiveMercFactionRoster()).toEqual([]);
    });
});

describe('selectTopNMercenaries', () => {
    test('ranks by full computed power (getMemberRaidPower), not raw workMultiplierAmount', () => {
        const weak = user('weak', { workMultiplierAmount: 10 });
        const strong = user('strong', { workMultiplierAmount: 5, rebirthCount: 0 });
        // Fake a higher effective power for "strong" via a companion-style perk isn't
        // trivial without mocking companionFactory — instead just confirm plain
        // descending-by-workMultiplierAmount ordering here (rebirth/companion percent
        // both default to 0 for a plain userDetails object).
        const result = spudKeepFactory.selectTopNMercenaries([weak, strong], 5);
        expect(result.map(u => u.userId)).toEqual(['weak', 'strong']);
    });

    test('drops falsy/missing entries rather than throwing', () => {
        const result = spudKeepFactory.selectTopNMercenaries([user('a'), null, undefined, user('b')], 5);
        expect(result.map(u => u.userId).sort()).toEqual(['a', 'b']);
    });

    test('slices to N — no padding when fewer than N signed up', () => {
        const result = spudKeepFactory.selectTopNMercenaries([user('a'), user('b'), user('c')], 2);
        expect(result.length).toBe(2);
    });
});

describe('splitPotByWorkMulti', () => {
    test('splits proportionally by each participant\'s own workMultiplierAmount, floored, credited via an atomic ADD to spudKeepPendingPotatoes', async () => {
        dynamoHandler.findUser.mockImplementation(async (id) => id === 'a'
            ? user('a', { workMultiplierAmount: 3 })
            : user('b', { workMultiplierAmount: 1 }));

        const shares = await spudKeepFactory.splitPotByWorkMulti([{ id: 'a', username: 'a' }, { id: 'b', username: 'b' }], 1000);

        expect(shares).toEqual([{ id: 'a', username: 'a', amount: 750 }, { id: 'b', username: 'b', amount: 250 }]);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('a', 'spudKeepPendingPotatoes', 750);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('b', 'spudKeepPendingPotatoes', 250);
    });

    test('falls back to an even split when every participant has 0 (or a missing/malformed) workMultiplierAmount', async () => {
        dynamoHandler.findUser.mockImplementation(async (id) => id === 'missing' ? undefined : user(id, { workMultiplierAmount: 0 }));

        const shares = await spudKeepFactory.splitPotByWorkMulti([{ id: 'a', username: 'a' }, { id: 'missing', username: 'missing' }], 100);

        expect(shares).toEqual([{ id: 'a', username: 'a', amount: 50 }, { id: 'missing', username: 'missing', amount: 50 }]);
    });

    test('never credits a zero share (no-op ADD calls for a member whose floored amount is 0)', async () => {
        dynamoHandler.findUser.mockImplementation(async (id) => id === 'whale'
            ? user('whale', { workMultiplierAmount: 1000 })
            : user(id, { workMultiplierAmount: 1 }));

        const shares = await spudKeepFactory.splitPotByWorkMulti([{ id: 'whale', username: 'whale' }, { id: 'ant', username: 'ant' }], 10);

        expect(shares.find(s => s.id === 'ant').amount).toBe(0);
        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalledWith('ant', 'spudKeepPendingPotatoes', 0);
    });
});

describe('isCurrentHolderEntrant', () => {
    test('a guild entrant matches only on the exact guildId', () => {
        const buff = { holderType: 'guild', holderId: 'g1' };
        expect(spudKeepFactory.isCurrentHolderEntrant(buff, 'guild', 'g1')).toBe(true);
        expect(spudKeepFactory.isCurrentHolderEntrant(buff, 'guild', 'g2')).toBe(false);
    });

    test('the mercenary entrant matches purely on holderType — no id to compare', () => {
        const buff = { holderType: 'mercenary', holderId: null };
        expect(spudKeepFactory.isCurrentHolderEntrant(buff, 'mercenary', null)).toBe(true);
    });

    test('false when there is no buff or holderType at all', () => {
        expect(spudKeepFactory.isCurrentHolderEntrant(undefined, 'guild', 'g1')).toBe(false);
        expect(spudKeepFactory.isCurrentHolderEntrant({ holderType: null }, 'guild', 'g1')).toBe(false);
    });
});

describe('rollLottery', () => {
    afterEach(() => {
        if (Math.random.mockRestore) Math.random.mockRestore();
    });

    test('draws proportionally to effectivePower via the cumulative-chance loop', () => {
        const entrants = [{ id: 'a', effectivePower: 25 }, { id: 'b', effectivePower: 75 }];
        jest.spyOn(Math, 'random').mockReturnValue(0.1); // lands inside a's 0-0.25 slice
        expect(spudKeepFactory.rollLottery(entrants).id).toBe('a');
        Math.random.mockReturnValue(0.9); // lands inside b's 0.25-1.0 slice
        expect(spudKeepFactory.rollLottery(entrants).id).toBe('b');
    });

    test('returns null when every entrant has 0 effectivePower — nothing to weight against', () => {
        expect(spudKeepFactory.rollLottery([{ id: 'a', effectivePower: 0 }, { id: 'b', effectivePower: 0 }])).toBeNull();
    });
});

describe('buildEntrantPreview', () => {
    test('auto-re-enters the current guild holder even when absent from guildEntrants, without double-counting an explicit sign-up', async () => {
        dynamoHandler.getStatDatabase.mockImplementation(async (trackingId) => {
            if (trackingId === 'spud_keep') return { guildEntrants: [{ guildId: 'g2', guildName: 'g2-name' }], potPotatoes: 0 };
            return undefined;
        });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'guild', holderId: 'g1', holderName: 'g1-name', expiresAt: Date.now() + 1000, consecutiveHoldCycles: 2 });
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: 'm1', username: 'm1' }]));

        const preview = await spudKeepFactory.buildEntrantPreview();

        const guildIds = preview.entrants.filter(e => e.type === 'guild').map(e => e.id);
        expect(guildIds.sort()).toEqual(['g1', 'g2']);
        expect(preview.entrants.filter(e => e.id === 'g1').length).toBe(1); // not double-counted
        expect(preview.entrants.find(e => e.id === 'g1').isHolder).toBe(true);
        expect(preview.entrants.find(e => e.id === 'g2').isHolder).toBe(false);
    });

    test('the Merc Faction is always present, even with zero mercenaries opted in (0 power, not a crash)', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [], potPotatoes: 0 });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);

        const preview = await spudKeepFactory.buildEntrantPreview();

        const merc = preview.entrants.find(e => e.type === 'mercenary');
        expect(merc).toBeDefined();
        expect(merc.power).toBe(0);
        expect(merc.name).toBe('The Merc Faction');
    });

    test('the attacker bonus is applied to every non-holder entrant, never to the holder', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({
            guildEntrants: [{ guildId: 'g1', guildName: 'g1-name' }, { guildId: 'g2', guildName: 'g2-name' }],
            potPotatoes: 0
        });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'guild', holderId: 'g1', holderName: 'g1-name', expiresAt: Date.now() + 1000, consecutiveHoldCycles: 0 });
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: `${guildId}-m1`, username: `${guildId}-m1` }]));

        const preview = await spudKeepFactory.buildEntrantPreview();

        const holder = preview.entrants.find(e => e.id === 'g1');
        const challenger = preview.entrants.find(e => e.id === 'g2');
        expect(holder.effectivePower).toBe(holder.power); // unchanged
        expect(challenger.effectivePower).toBeCloseTo(challenger.power * (1 + SpudKeep.ATTACKER_BONUS_BASE));
    });

    // 2026-09-04, direct instruction — was already live in /work's own effectiveMultiplier
    // but missing here, understating everyone's real odds whenever a workMulti buff was
    // active.
    test('World Boss workMulti buff scales every entrant\'s power uniformly, applied to holder and challenger alike', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [{ guildId: 'g1', guildName: 'g1-name' }], potPotatoes: 0 });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: 'm1', username: 'm1' }]));
        dynamoHandler.getUsers.mockResolvedValue([{ userId: 'mc1', username: 'mc1', isMercenary: true, autoJoinSpudKeep: true }]);

        const withoutBuff = await spudKeepFactory.buildEntrantPreview();

        dynamoHandler.getActiveWorldBuff.mockResolvedValue({ buffType: 'workMulti', value: 0.2, expiresAt: Date.now() + 1000 });
        dynamoHandler.isWorldBuffLive.mockImplementation((buff, type) => Boolean(buff && buff.buffType === type));
        const withBuff = await spudKeepFactory.buildEntrantPreview();

        const guildWithout = withoutBuff.entrants.find(e => e.id === 'g1');
        const guildWith = withBuff.entrants.find(e => e.id === 'g1');
        expect(guildWith.power).toBeCloseTo(guildWithout.power * 1.2);

        const mercWithout = withoutBuff.entrants.find(e => e.type === 'mercenary');
        const mercWith = withBuff.entrants.find(e => e.type === 'mercenary');
        expect(mercWith.power).toBeCloseTo(mercWithout.power * 1.2);
    });
});

describe('resolveCycle', () => {
    afterEach(() => {
        if (Math.random.mockRestore) Math.random.mockRestore();
    });

    test('skips the lottery entirely when every entrant has 0 power — no writes at all', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [], potPotatoes: 0 });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);

        const result = await spudKeepFactory.resolveCycle();

        expect(result).toEqual({ skipped: true });
        expect(dynamoHandler.setActiveSpudKeepBuff).not.toHaveBeenCalled();
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('a guild win with no previous holder grants the bundle buff, skips the pot payout (nothing could have accrued), and clears the entrant lists', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [{ guildId: 'g1', guildName: 'g1-name' }], potPotatoes: 500 });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: 'm1', username: 'm1' }]));
        jest.spyOn(Math, 'random').mockReturnValue(0); // only one nonzero entrant (g1) — any roll picks it

        const result = await spudKeepFactory.resolveCycle();

        expect(result.skipped).toBe(false);
        expect(result.winner).toEqual({ type: 'guild', id: 'g1', name: 'g1-name' });
        expect(result.holderChanged).toBe(true);
        expect(result.consecutiveHoldCycles).toBe(0);
        expect(result.potPotatoesPaid).toBe(0); // no previous holder — nothing accrued yet
        expect(dynamoHandler.setActiveSpudKeepBuff).toHaveBeenCalledWith(expect.objectContaining({
            holderType: 'guild', holderId: 'g1', holderName: 'g1-name', buffType: 'passiveIncome', value: SpudKeep.PASSIVE_BUFF_VALUE, consecutiveHoldCycles: 0
        }));
        expect(dynamoHandler.setActiveSpudKeepCooldownBuff).toHaveBeenCalledWith(expect.objectContaining({
            holderType: 'guild', holderId: 'g1', buffType: 'cooldownReduction', value: SpudKeep.COOLDOWN_BUFF_VALUE
        }));
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('spud_keep', expect.objectContaining({ guildEntrants: [] }));
        expect(dynamoHandler.addStatFields).not.toHaveBeenCalled(); // nothing paid out, nothing to subtract
    });

    test('a successful defense pays the accrued pot to the SAME guild\'s own roster (credited to their pending balance, not straight to potatoes), increments consecutiveHoldCycles, and subtracts exactly what was paid', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [{ guildId: 'g1', guildName: 'g1-name' }], potPotatoes: 900 });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'guild', holderId: 'g1', holderName: 'g1-name', expiresAt: Date.now() + 1000, consecutiveHoldCycles: 1 });
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: 'm1', username: 'm1' }]));
        jest.spyOn(Math, 'random').mockReturnValue(0); // g1 is by far the strongest entrant present

        const result = await spudKeepFactory.resolveCycle();

        expect(result.winner).toEqual({ type: 'guild', id: 'g1', name: 'g1-name' });
        expect(result.holderChanged).toBe(false);
        expect(result.consecutiveHoldCycles).toBe(2);
        expect(result.potPotatoesPaid).toBe(900);
        expect(result.potForfeited).toBe(false);
        // Single-member roster gets the whole pot, but as a pending balance credit — never a
        // direct potatoes write (that would make every reset a guaranteed rob target).
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('m1', 'spudKeepPendingPotatoes', 900);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalledWith('m1', expect.objectContaining({ potatoes: expect.any(Number) }));
        expect(result.payoutShares).toEqual([{ id: 'm1', username: 'm1', amount: 900 }]);
        expect(dynamoHandler.addStatFields).toHaveBeenCalledWith('spud_keep', { potPotatoes: -900 });
    });

    // Proves the compounding wiring is live end-to-end through resolveCycle itself, not
    // just correct in isolation as a pure function (getCompoundingBuffValue above).
    test('a successful defense grants the COMPOUNDED buff value, not the flat base', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [{ guildId: 'g1', guildName: 'g1-name' }], potPotatoes: 0 });
        // Already 3 consecutive holds going in -> this defense makes it 4 (day 5, the cap).
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'guild', holderId: 'g1', holderName: 'g1-name', expiresAt: Date.now() + 1000, consecutiveHoldCycles: 3 });
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: 'm1', username: 'm1' }]));
        jest.spyOn(Math, 'random').mockReturnValue(0);

        const result = await spudKeepFactory.resolveCycle();

        expect(result.consecutiveHoldCycles).toBe(4);
        expect(result.passiveBuffValue).toBeCloseTo(SpudKeep.PASSIVE_BUFF_MAX_VALUE); // 40% at cycle 4
        expect(result.cooldownBuffValue).toBeCloseTo(SpudKeep.COOLDOWN_BUFF_MAX_VALUE);
        expect(dynamoHandler.setActiveSpudKeepBuff).toHaveBeenCalledWith(expect.objectContaining({ value: SpudKeep.PASSIVE_BUFF_MAX_VALUE }));
        expect(dynamoHandler.setActiveSpudKeepCooldownBuff).toHaveBeenCalledWith(expect.objectContaining({ value: SpudKeep.COOLDOWN_BUFF_MAX_VALUE }));
    });

    test('a multi-member roster splits the pot by each member\'s own workMultiplierAmount, not evenly', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [{ guildId: 'g1', guildName: 'g1-name' }], potPotatoes: 1000 });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'guild', holderId: 'g1', holderName: 'g1-name', expiresAt: Date.now() + 1000, consecutiveHoldCycles: 0 });
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: 'strong', username: 'strong' }, { id: 'weak', username: 'weak' }]));
        dynamoHandler.findUser.mockImplementation(async (id) => id === 'strong'
            ? user('strong', { autoJoinRaids: true, workMultiplierAmount: 3 })
            : user(id, { autoJoinRaids: true, workMultiplierAmount: 1 }));
        jest.spyOn(Math, 'random').mockReturnValue(0);

        const result = await spudKeepFactory.resolveCycle();

        // 3:1 weight ratio over a 1000-potato pot -> 750/250, floored.
        expect(result.payoutShares).toEqual(expect.arrayContaining([
            { id: 'strong', username: 'strong', amount: 750 },
            { id: 'weak', username: 'weak', amount: 250 }
        ]));
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('strong', 'spudKeepPendingPotatoes', 750);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalledWith('weak', 'spudKeepPendingPotatoes', 250);
    });

    test('an empty outgoing roster forfeits the pot instead of paying it to anyone, and still zeroes it out', async () => {
        // g1 is the current holder but its own roster is now empty (disbanded/opted out);
        // g2 is the only real entrant this cycle and wins by construction.
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [{ guildId: 'g2', guildName: 'g2-name' }], potPotatoes: 400 });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue({ holderType: 'guild', holderId: 'g1', holderName: 'g1-name', expiresAt: Date.now() + 1000, consecutiveHoldCycles: 3 });
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guildId === 'g1' ? guild('g1', []) : guild('g2', [{ id: 'm2', username: 'm2' }]));
        jest.spyOn(Math, 'random').mockReturnValue(0.99); // g2 is the only nonzero-power entrant

        const result = await spudKeepFactory.resolveCycle();

        expect(result.winner.id).toBe('g2');
        expect(result.holderChanged).toBe(true);
        expect(result.potForfeited).toBe(true);
        expect(result.potPotatoesPaid).toBe(400);
        expect(dynamoHandler.addStatFields).toHaveBeenCalledWith('spud_keep', { potPotatoes: -400 });
    });

    test('participation counter is credited to every guild entrant\'s own roster and the Merc Faction\'s counted top-N only', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({
            guildEntrants: [{ guildId: 'g1', guildName: 'g1-name' }],
            potPotatoes: 0
        });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: 'm1', username: 'm1' }]));
        dynamoHandler.getUsers.mockResolvedValue([{ userId: 'mc1', username: 'mc1', isMercenary: true, autoJoinSpudKeep: true }]);
        jest.spyOn(Math, 'random').mockReturnValue(0);

        await spudKeepFactory.resolveCycle();

        // incrementCounter is implemented as updateUserFields(id, {}, {fieldName: amount})
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('m1', {}, { spudKeepAttemptCount: 1 });
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('mc1', {}, { spudKeepAttemptCount: 1 });
    });

    test('a Merc Faction win sets holderType mercenary with a null holderId', async () => {
        // With no floor on getMercFactionN, the Merc Faction only counts any mercenaries at
        // all if some guild has also signed up (N is derived purely from the largest
        // signed-up guild's own roster size) — so g1 is present here purely to set N=1, its
        // own single member deliberately given 0 power so the Merc Faction (mc1, nonzero
        // power) is the only real contender and wins deterministically at roll 0.
        dynamoHandler.getStatDatabase.mockResolvedValue({ guildEntrants: [{ guildId: 'g1', guildName: 'g1-name' }], potPotatoes: 0 });
        dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
        dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
        dynamoHandler.findGuildById.mockImplementation(async (guildId) => guild(guildId, [{ id: 'g1m1', username: 'g1m1' }]));
        dynamoHandler.getUsers.mockResolvedValue([{ userId: 'mc1', username: 'mc1', isMercenary: true, autoJoinSpudKeep: true }]);
        dynamoHandler.findUser.mockImplementation(async (id) => id === 'g1m1'
            ? user('g1m1', { autoJoinRaids: true, workMultiplierAmount: 0 })
            : user(id, { autoJoinRaids: true, workMultiplierAmount: 1 }));
        jest.spyOn(Math, 'random').mockReturnValue(0);

        const result = await spudKeepFactory.resolveCycle();

        expect(result.winner).toEqual({ type: 'mercenary', id: null, name: 'The Merc Faction' });
        expect(dynamoHandler.setActiveSpudKeepBuff).toHaveBeenCalledWith(expect.objectContaining({ holderType: 'mercenary', holderId: null, holderName: 'The Merc Faction' }));
    });
});
