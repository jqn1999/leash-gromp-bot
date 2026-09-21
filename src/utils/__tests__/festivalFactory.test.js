// Seasonal Festivals (systems/seasonal-festivals.md) — covers the fixed complete
// 3-objective set per festival (not a rotated subset like Quests), the lazy currency
// expiry by festivalId tag mismatch (both on the earning side and the spend-gate side),
// the 3-gate shop purchase validation (each gate's own rejection case), the Encounter
// Voucher mechanism (a regression test that redemption never touches workCount/cooldown/
// the scenario counter Quests/Achievements key off), and the odds-override composing
// ALONGSIDE (not replacing) whatever chances EventFactory's own hourly roll already
// produced.
jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const festivalFactory = require('../festivalFactory');
const { FestivalTemplates, FestivalShop } = require('../constants');
const { WORK_SCENARIO_INDICES } = require('../eventFactory');

function liveFestival(overrides = {}) {
    return {
        festivalId: 'harvest_festival',
        startsAt: Date.now() - 1000,
        endsAt: Date.now() + 10 * 24 * 60 * 60 * 1000,
        objectiveIds: FestivalTemplates.harvest_festival.map(t => t.id),
        oddsOverride: { scenario: 'sweet', multiplier: 1.5 },
        ...overrides,
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'u1',
        username: 'Tester',
        potatoes: 1000,
        totalEarnings: 1000,
        workMultiplierAmount: 2,
        passiveAmount: 1000,
        bankCapacity: 1000,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        workCount: 10,
        workScenarioCounts: { sweet: 0, companion: 0, poison: 0, taro: 0, goldenYam: 0 },
        festivalQuests: {},
        festivalTokens: 0,
        festivalTokensFestivalId: null,
        festivalShop: null,
        festivalCosmetics: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('isFestivalLive', () => {
    test('null/undefined festival, or a null festivalId, is never live', () => {
        expect(festivalFactory.isFestivalLive(null)).toBe(false);
        expect(festivalFactory.isFestivalLive({ festivalId: null, endsAt: Date.now() + 10000 })).toBe(false);
    });

    test('a festival past its own endsAt is not live even with a real festivalId', () => {
        expect(festivalFactory.isFestivalLive({ festivalId: 'harvest_festival', endsAt: Date.now() - 1000 })).toBe(false);
    });

    test('a real festivalId with a future endsAt is live', () => {
        expect(festivalFactory.isFestivalLive(liveFestival())).toBe(true);
    });
});

describe('FestivalTemplates — fixed complete 3-objective set, not a rotated subset', () => {
    test('every festival has exactly 3 objectives', () => {
        for (const festivalId of Object.keys(FestivalTemplates)) {
            expect(FestivalTemplates[festivalId]).toHaveLength(3);
        }
    });

    test('checkAndClaimFestivalQuests baselines and checks ALL 3 objectives in one call, never a subset', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(liveFestival());
        const userDetails = baseUser({ workCount: 5, workScenarioCounts: { sweet: 2, companion: 1 } });

        const result = await festivalFactory.checkAndClaimFestivalQuests(userDetails, userDetails);

        // Nothing crossed a tier yet, but a fresh baseline should have been snapshotted for
        // every one of the 3 harvest_festival templates in the very same call.
        expect(result.completedObjectives).toHaveLength(0);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(Object.keys(calledFields.festivalQuests)).toEqual(
            expect.arrayContaining(FestivalTemplates.harvest_festival.map(t => t.id))
        );
        expect(Object.keys(calledFields.festivalQuests)).toHaveLength(3);
    });

    test('a fresh baseline uses the pre-action value, so the revealing action still counts as progress', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(liveFestival());
        const previousUserDetails = baseUser({ workScenarioCounts: { sweet: 0, companion: 0 } });
        const userDetails = baseUser({ workScenarioCounts: { sweet: 10, companion: 0 } });

        const result = await festivalFactory.checkAndClaimFestivalQuests(userDetails, previousUserDetails);

        expect(result.completedObjectives.map(o => o.id)).toContain('festival_harvest_sweet');
    });

    test('returns nothing and writes nothing when no festival is live', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(null);
        const userDetails = baseUser({ workCount: 1000 });

        const result = await festivalFactory.checkAndClaimFestivalQuests(userDetails, userDetails);

        expect(result.completedObjectives).toHaveLength(0);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});

describe('Festival Tokens — lazy expiry by festivalId tag mismatch', () => {
    test('getSpendableFestivalTokens reads 0 when the stored tag is a past festival', () => {
        const userDetails = baseUser({ festivalTokens: 9999, festivalTokensFestivalId: 'frost_fair' });
        expect(festivalFactory.getSpendableFestivalTokens(userDetails, liveFestival())).toBe(0);
    });

    test('getSpendableFestivalTokens reads the real balance when the tag matches the live festival', () => {
        const userDetails = baseUser({ festivalTokens: 250, festivalTokensFestivalId: 'harvest_festival' });
        expect(festivalFactory.getSpendableFestivalTokens(userDetails, liveFestival())).toBe(250);
    });

    test('getSpendableFestivalTokens reads 0 when no festival is live at all, regardless of balance', () => {
        const userDetails = baseUser({ festivalTokens: 250, festivalTokensFestivalId: 'harvest_festival' });
        expect(festivalFactory.getSpendableFestivalTokens(userDetails, null)).toBe(0);
    });

    test('earning during a NEW festival overwrites a stale balance instead of adding to it', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(liveFestival({ festivalId: 'frost_fair' }));
        // Leftover from a past, already-ended Harvest Festival — should be treated as 0,
        // not carried forward, the moment this player earns a Frost Fair token.
        const userDetails = baseUser({
            festivalTokens: 9999,
            festivalTokensFestivalId: 'harvest_festival',
            workCount: 100,
        });

        await festivalFactory.checkAndClaimFestivalQuests(userDetails, baseUser({ workCount: 0 }));

        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        // Tier 1 of festival_frost_work (threshold 100) pays 15 tokens — the stale 9999
        // must NOT have been added to this.
        expect(calledFields.festivalTokens).toBe(15);
        expect(calledFields.festivalTokensFestivalId).toBe('frost_fair');
    });
});

describe('attemptPurchaseFestivalSlot — 3-gate fail-closed validation', () => {
    test('gate 1: rejects outright when no festival is live, without even looking up the user', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(null);

        const result = await festivalFactory.attemptPurchaseFestivalSlot('u1', 'Tester', 'harvest_cosmetic_banner');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/festival has ended/);
        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
    });

    test('gate 2: rejects when the player\'s own stored shop reference is a past, already-ended festival', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(liveFestival());
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            festivalShop: { festivalId: 'frost_fair', purchasedSlots: [] },
            festivalTokens: 9999,
            festivalTokensFestivalId: 'frost_fair',
        }));

        const result = await festivalFactory.attemptPurchaseFestivalSlot('u1', 'Tester', 'harvest_cosmetic_banner');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/shop has already closed/);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('gate 3: rejects on insufficient balance, and separately on a stale (tag-mismatched) leftover balance', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(liveFestival());

        // Genuinely insufficient.
        dynamoHandler.findUser.mockResolvedValue(baseUser({ festivalTokens: 10, festivalTokensFestivalId: 'harvest_festival' }));
        const insufficient = await festivalFactory.attemptPurchaseFestivalSlot('u1', 'Tester', 'harvest_cosmetic_banner');
        expect(insufficient.ok).toBe(false);
        expect(insufficient.message).toMatch(/only have 10/);

        // A large leftover balance from a past festival (no stored festivalShop yet, so
        // gate 2 never fires) must still read as spendable-zero here, not as 5000.
        dynamoHandler.findUser.mockResolvedValue(baseUser({ festivalShop: null, festivalTokens: 5000, festivalTokensFestivalId: 'frost_fair' }));
        const stale = await festivalFactory.attemptPurchaseFestivalSlot('u1', 'Tester', 'harvest_cosmetic_banner');
        expect(stale.ok).toBe(false);
        expect(stale.message).toMatch(/only have 0/);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('a successful cosmetic purchase deducts tokens, marks the item purchased, and grants the cosmetic', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(liveFestival());
        dynamoHandler.findUser.mockResolvedValue(baseUser({ festivalTokens: 1000, festivalTokensFestivalId: 'harvest_festival' }));

        const result = await festivalFactory.attemptPurchaseFestivalSlot('u1', 'Tester', 'harvest_cosmetic_banner');

        expect(result.ok).toBe(true);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.festivalTokens).toBe(1000 - 60);
        expect(calledFields.festivalShop.purchasedSlots).toEqual(['harvest_cosmetic_banner']);
        expect(calledFields.festivalCosmetics).toEqual(['harvest_festival_banner']);
    });

    test('rejects re-buying an item already purchased this festival', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(liveFestival());
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            festivalTokens: 1000,
            festivalTokensFestivalId: 'harvest_festival',
            festivalShop: { festivalId: 'harvest_festival', purchasedSlots: ['harvest_cosmetic_banner'] },
        }));

        const result = await festivalFactory.attemptPurchaseFestivalSlot('u1', 'Tester', 'harvest_cosmetic_banner');

        expect(result.ok).toBe(false);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});

describe('Encounter Vouchers — a pure bonus payout, never touching workCount/cooldown/Quest progress', () => {
    test('redeeming a Sweet Potato voucher applies the reward WITHOUT incrementing workCount, workTimer, or workScenarioCounts.sweet', async () => {
        dynamoHandler.getActiveFestival.mockResolvedValue(liveFestival());
        dynamoHandler.findUser.mockResolvedValue(baseUser({ festivalTokens: 1000, festivalTokensFestivalId: 'harvest_festival' }));

        const result = await festivalFactory.attemptPurchaseFestivalSlot('u1', 'Tester', 'harvest_voucher_sweet');

        expect(result.ok).toBe(true);
        expect(result.voucherResult).toBeTruthy();
        expect(result.voucherResult.result.statGrant).toHaveLength(1);

        // Every write this purchase produced (one from workFactory.handleSweetPotato's own
        // internal write, one from attemptPurchaseFestivalSlot's own currency/shop write)
        // must be free of the three progress-tracking fields a real /work call would set.
        for (const call of dynamoHandler.updateUserFields.mock.calls) {
            const [, setFields, addFields] = call;
            expect(setFields.workTimer).toBeUndefined();
            expect(setFields.workScenarioCounts).toBeUndefined();
            expect(addFields ? addFields.workCount : undefined).toBeUndefined();
        }

        // Currency/shop bookkeeping still happened normally.
        const shopWrite = dynamoHandler.updateUserFields.mock.calls.find(([, fields]) => fields.festivalShop);
        expect(shopWrite[1].festivalTokens).toBe(1000 - 150);
        expect(shopWrite[1].festivalShop.purchasedSlots).toEqual(['harvest_voucher_sweet']);
    });

    test('a real /work-equivalent call (trackProgress default true) still sets workTimer/workScenarioCounts/workCount — the voucher path is the only exception', async () => {
        const workFactory = require('../workFactory');
        const wf = new workFactory.WorkFactory();
        dynamoHandler.calculateWorkTimerValue.mockResolvedValue(123456);

        await wf.handleSweetPotato(baseUser());

        const [, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.workTimer).toBe(123456);
        expect(setFields.workScenarioCounts.sweet).toBe(1);
        expect(addFields.workCount).toBe(1);
    });
});

describe('applyFestivalOddsOverride — composes alongside EventFactory\'s own roll, never replaces it', () => {
    function sampleChances() {
        return [
            { type: WORK_SCENARIO_INDICES.GOLDEN, chance: 0.001 },
            { type: WORK_SCENARIO_INDICES.POISON, chance: 0.011 },
            { type: WORK_SCENARIO_INDICES.LARGE, chance: 0.051 },
            { type: WORK_SCENARIO_INDICES.METAL, chance: 0.061 },
            // SWEET's own raw width here is already 0.04 (double its 0.02 base) — standing
            // in for an EventFactory hourly SWEETX2 event already baked into this array.
            { type: WORK_SCENARIO_INDICES.SWEET, chance: 0.101 },
            { type: WORK_SCENARIO_INDICES.COMPANION, chance: 0.116 },
            { type: WORK_SCENARIO_INDICES.TARO, chance: 0.136 },
            { type: WORK_SCENARIO_INDICES.ANCIENT, chance: 0.1365 },
            { type: WORK_SCENARIO_INDICES.MIMIC, chance: 0.1465 },
            { type: WORK_SCENARIO_INDICES.GOLDEN_YAM, chance: 0.1475 },
            { type: WORK_SCENARIO_INDICES.REGULAR, chance: 1 },
        ];
    }

    test('null/invalid oddsOverride is a complete no-op', () => {
        const chances = sampleChances();
        expect(festivalFactory.applyFestivalOddsOverride(chances, null)).toBe(chances);
        expect(festivalFactory.applyFestivalOddsOverride(chances, { scenario: 'sweet', multiplier: 0 })).toBe(chances);
    });

    test('a 1.5x festival multiplier further widens an ALREADY-doubled hourly-event slice — the two stack, not replace', () => {
        const result = festivalFactory.applyFestivalOddsOverride(sampleChances(), { scenario: 'sweet', multiplier: 1.5 });

        const metal = result.find(r => r.type === WORK_SCENARIO_INDICES.METAL).chance;
        const sweet = result.find(r => r.type === WORK_SCENARIO_INDICES.SWEET).chance;
        // Final SWEET width = 0.04 (already-doubled base) * 1.5 = 0.06 — base(0.02) x
        // hourly(2.0) x festival(1.5) all compounded together, matching the design doc's
        // own "base × 1.5 festival × 2.0 hourly, not one replacing the other" example.
        expect(sweet - metal).toBeCloseTo(0.06);

        // Every scenario AFTER sweet shifts up by the same absolute amount the slice grew
        // by (0.02), preserving each of their own raw widths.
        const companion = result.find(r => r.type === WORK_SCENARIO_INDICES.COMPANION).chance;
        expect(companion).toBeCloseTo(0.136);
        const goldenYam = result.find(r => r.type === WORK_SCENARIO_INDICES.GOLDEN_YAM).chance;
        expect(goldenYam).toBeCloseTo(0.1675);

        // Regular still absorbs everything by staying pinned at 1 (its own effective share
        // shrinks instead).
        const regular = result.find(r => r.type === WORK_SCENARIO_INDICES.REGULAR).chance;
        expect(regular).toBe(1);
    });

    test('a scenario name not present in the chances table is a no-op', () => {
        const chances = sampleChances();
        const result = festivalFactory.applyFestivalOddsOverride(chances, { scenario: 'not-a-real-scenario', multiplier: 2 });
        expect(result).toBe(chances);
    });
});
