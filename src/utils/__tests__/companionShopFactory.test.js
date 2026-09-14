// Companion Shop (roadmap.md item 92, 2026-09-14) — a personal, rotating NPC storefront.
// Covers the 8pm ET rotation boundary (same shape as dailyStreakFactory's/workFactory's
// own boundary tests), the seeded/deterministic roll (never Heirloom, matches
// CompanionShop.RARITY_ODDS' cumulative shape), the lazy tag-mismatch reset, and the
// actual purchase write (potato path, starch path, and every rejection case).
jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const companionShopFactory = require('../companionShopFactory');
const { CompanionShop, CompanionMarket, CompanionRarity } = require('../constants');

beforeEach(() => {
    jest.clearAllMocks();
});

describe('getDailyTag — 8pm ET boundary', () => {
    test('a moment before 8pm ET stays on the current Eastern calendar day', () => {
        // 7:59pm ET on 2026-09-14 (EDT, UTC-4) is 23:59 UTC the same day.
        expect(companionShopFactory.getDailyTag(new Date('2026-09-14T23:59:00Z'))).toBe('2026-09-14');
    });

    test('a moment at/after 8pm ET rolls to the next day', () => {
        // 8:00pm ET on 2026-09-14 is 00:00 UTC on 2026-09-15.
        expect(companionShopFactory.getDailyTag(new Date('2026-09-15T00:00:00Z'))).toBe('2026-09-15');
    });
});

describe('getWeeklyTag — 8pm ET Monday boundary', () => {
    test('Monday before 8pm ET still belongs to last week', () => {
        // Monday 2026-09-14, 7:59pm ET = 2026-09-14T23:59:00Z.
        expect(companionShopFactory.getWeeklyTag(new Date('2026-09-14T23:59:00Z'))).toBe('9/7/2026');
    });

    test('Monday at/after 8pm ET belongs to the new week', () => {
        // Monday 2026-09-14, 8:00pm ET = 2026-09-15T00:00:00Z.
        expect(companionShopFactory.getWeeklyTag(new Date('2026-09-15T00:00:00Z'))).toBe('9/14/2026');
    });
});

describe('rollShopRarity', () => {
    test('walks CompanionShop.RARITY_ODDS\' own cumulative thresholds, never Heirloom', () => {
        expect(companionShopFactory.rollShopRarity(0)).toBe(CompanionRarity.COMMON);
        expect(companionShopFactory.rollShopRarity(CompanionShop.RARITY_ODDS.common - 0.0001)).toBe(CompanionRarity.COMMON);
        expect(companionShopFactory.rollShopRarity(CompanionShop.RARITY_ODDS.common)).toBe(CompanionRarity.RARE);
        expect(companionShopFactory.rollShopRarity(CompanionShop.RARITY_ODDS.rare)).toBe(CompanionRarity.LEGENDARY);
        expect(companionShopFactory.rollShopRarity(CompanionShop.RARITY_ODDS.legendary)).toBe(CompanionRarity.MYTHIC);
        expect(companionShopFactory.rollShopRarity(0.9999999)).toBe(CompanionRarity.MYTHIC);
    });
});

describe('getShopOffering', () => {
    test('is fully deterministic for the same (userId, tag, slotIndex)', () => {
        const a = companionShopFactory.getShopOffering('user-1', 'daily:2026-09-14', 0);
        const b = companionShopFactory.getShopOffering('user-1', 'daily:2026-09-14', 0);
        expect(a).toEqual(b);
    });

    test('a different slotIndex or tag can roll a different offering', () => {
        const a = companionShopFactory.getShopOffering('user-1', 'daily:2026-09-14', 0);
        const b = companionShopFactory.getShopOffering('user-1', 'daily:2026-09-14', 1);
        const c = companionShopFactory.getShopOffering('user-1', 'daily:2026-09-15', 0);
        // Not a strict guarantee any single pair differs, but across all three at least
        // one comparison should — otherwise the seed isn't actually incorporating tag/slot.
        expect([JSON.stringify(a) !== JSON.stringify(b), JSON.stringify(a) !== JSON.stringify(c)]).toContain(true);
    });

    test('never rolls Heirloom, and every companion resolves to a real roster entry', () => {
        const companionFactory = require('../companionFactory');
        for (let i = 0; i < 500; i++) {
            const offering = companionShopFactory.getShopOffering(`user-${i}`, 'weekly:9/7/2026', i % 6);
            expect(offering.rarity).not.toBe(CompanionRarity.HEIRLOOM);
            expect(companionFactory.getCompanionById(offering.companionId)).not.toBeNull();
        }
    });

    test('potatoPrice is anchored to CompanionMarket.MINIMUM_PRICE times that rarity\'s own multiplier, within variance', () => {
        for (let i = 0; i < 200; i++) {
            const offering = companionShopFactory.getShopOffering(`user-${i}`, 'daily:2026-09-14', i % 3);
            const base = CompanionMarket.MINIMUM_PRICE[offering.rarity] * CompanionShop.PRICE_MULTIPLIER[offering.rarity];
            const min = base * (1 - CompanionShop.PRICE_VARIANCE);
            const max = base * (1 + CompanionShop.PRICE_VARIANCE);
            expect(offering.potatoPrice).toBeGreaterThanOrEqual(Math.round(min) - 1);
            expect(offering.potatoPrice).toBeLessThanOrEqual(Math.round(max) + 1);
        }
    });
});

describe('resolveShopState', () => {
    test('a null companionShop resets both periods fresh', () => {
        const state = companionShopFactory.resolveShopState(null, new Date('2026-09-14T12:00:00Z'));
        expect(state.dailyPurchasedSlots).toEqual([]);
        expect(state.weeklyPurchasedSlots).toEqual([]);
    });

    test('a matching dailyTag keeps dailyPurchasedSlots, a stale weeklyTag resets weeklyPurchasedSlots', () => {
        const now = new Date('2026-09-14T12:00:00Z');
        const dailyTag = companionShopFactory.getDailyTag(now);
        const state = companionShopFactory.resolveShopState({
            dailyTag,
            dailyPurchasedSlots: [0, 1],
            weeklyTag: 'stale-week',
            weeklyPurchasedSlots: [2]
        }, now);
        expect(state.dailyPurchasedSlots).toEqual([0, 1]);
        expect(state.weeklyPurchasedSlots).toEqual([]);
    });
});

function starchDoc(sellPrice) {
    return { starch_sell: sellPrice };
}

describe('buildShopView', () => {
    test('returns DAILY_SLOT_COUNT/WEEKLY_SLOT_COUNT slots, flags purchased and affordability', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(starchDoc(100));
        const userDetails = {
            potatoes: 10_000_000,
            starches: 0,
            companionShop: { dailyTag: null, dailyPurchasedSlots: [], weeklyTag: null, weeklyPurchasedSlots: [] }
        };

        const view = await companionShopFactory.buildShopView('user-1', userDetails, new Date('2026-09-14T12:00:00Z'));

        expect(view.dailySlots).toHaveLength(CompanionShop.DAILY_SLOT_COUNT);
        expect(view.weeklySlots).toHaveLength(CompanionShop.WEEKLY_SLOT_COUNT);
        for (const slot of view.dailySlots) {
            expect(slot.purchased).toBe(false);
            expect(typeof slot.affordable).toBe('boolean');
        }
    });

    test('a starch-priced slot is unaffordable when the user has 0 starches, regardless of potatoes', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(starchDoc(100));
        const userDetails = {
            potatoes: 999_999_999,
            starches: 0,
            companionShop: { dailyTag: null, dailyPurchasedSlots: [], weeklyTag: null, weeklyPurchasedSlots: [] }
        };

        const view = await companionShopFactory.buildShopView('user-1', userDetails, new Date('2026-09-14T12:00:00Z'));
        const starchSlots = [...view.dailySlots, ...view.weeklySlots].filter(s => s.currencyField === 'starches');
        // Deterministic seed for 'user-1' is expected to produce at least one starch slot
        // across 9 total slots at a 20% per-slot chance — not a hard guarantee, but a
        // regression here would mean STARCH_CHANCE broke entirely, worth asserting on.
        expect(starchSlots.length).toBeGreaterThan(0);
        for (const slot of starchSlots) {
            expect(slot.affordable).toBe(false);
        }
    });
});

describe('attemptPurchaseSlot', () => {
    test('buys a potato-priced slot: deducts potatoes, awards the companion, marks the slot purchased', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(starchDoc(100));
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1',
            username: 'Tester',
            potatoes: 999_999_999,
            starches: 999_999_999,
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
            companionShop: { dailyTag: null, dailyPurchasedSlots: [], weeklyTag: null, weeklyPurchasedSlots: [] }
        });

        // Find a slot on this seed/date that's potato-priced to exercise that branch directly.
        const now = new Date('2026-09-14T12:00:00Z');
        const dailyTag = companionShopFactory.getDailyTag(now);
        let potatoSlotIndex = null;
        for (let i = 0; i < CompanionShop.DAILY_SLOT_COUNT; i++) {
            const offering = companionShopFactory.getShopOffering('user-1', `daily:${dailyTag}`, i);
            if (!offering.isStarch) {
                potatoSlotIndex = i;
                break;
            }
        }
        expect(potatoSlotIndex).not.toBeNull();

        const result = await companionShopFactory.attemptPurchaseSlot('user-1', 'Tester', 'daily', potatoSlotIndex, now);

        expect(result.ok).toBe(true);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.potatoes).toBeLessThan(999_999_999);
        expect(calledFields.companions.owned).toHaveLength(1);
        expect(calledFields.companionShop.dailyPurchasedSlots).toEqual([potatoSlotIndex]);
    });

    test('buys a starch-priced slot: deducts starches, not potatoes', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(starchDoc(100));
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1',
            username: 'Tester',
            potatoes: 999_999_999,
            starches: 999_999_999,
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
            companionShop: { dailyTag: null, dailyPurchasedSlots: [], weeklyTag: null, weeklyPurchasedSlots: [] }
        });

        const now = new Date('2026-09-14T12:00:00Z');
        const dailyTag = companionShopFactory.getDailyTag(now);
        let starchSlotIndex = null;
        for (let i = 0; i < CompanionShop.DAILY_SLOT_COUNT; i++) {
            const offering = companionShopFactory.getShopOffering('user-1', `daily:${dailyTag}`, i);
            if (offering.isStarch) {
                starchSlotIndex = i;
                break;
            }
        }
        expect(starchSlotIndex).not.toBeNull();

        const result = await companionShopFactory.attemptPurchaseSlot('user-1', 'Tester', 'daily', starchSlotIndex, now);

        expect(result.ok).toBe(true);
        const [, calledFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledFields.potatoes).toBeUndefined();
        expect(calledFields.starches).toBeLessThan(999_999_999);
    });

    test('rejects a slot already purchased this rotation without writing anything', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(starchDoc(100));
        const now = new Date('2026-09-14T12:00:00Z');
        const dailyTag = companionShopFactory.getDailyTag(now);
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1',
            username: 'Tester',
            potatoes: 999_999_999,
            starches: 999_999_999,
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
            companionShop: { dailyTag, dailyPurchasedSlots: [0], weeklyTag: null, weeklyPurchasedSlots: [] }
        });

        const result = await companionShopFactory.attemptPurchaseSlot('user-1', 'Tester', 'daily', 0, now);

        expect(result.ok).toBe(false);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects when the user cannot afford the slot', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(starchDoc(100));
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1',
            username: 'Tester',
            potatoes: 0,
            starches: 0,
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
            companionShop: { dailyTag: null, dailyPurchasedSlots: [], weeklyTag: null, weeklyPurchasedSlots: [] }
        });

        const result = await companionShopFactory.attemptPurchaseSlot('user-1', 'Tester', 'daily', 0, new Date('2026-09-14T12:00:00Z'));

        expect(result.ok).toBe(false);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects an out-of-range slot index', async () => {
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1', username: 'Tester', potatoes: 0, starches: 0,
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
            companionShop: { dailyTag: null, dailyPurchasedSlots: [], weeklyTag: null, weeklyPurchasedSlots: [] }
        });

        const result = await companionShopFactory.attemptPurchaseSlot('user-1', 'Tester', 'daily', 99, new Date('2026-09-14T12:00:00Z'));

        expect(result.ok).toBe(false);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects a starch-priced slot when the starch market doc is missing, without writing anything', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(null);
        const now = new Date('2026-09-14T12:00:00Z');
        const dailyTag = companionShopFactory.getDailyTag(now);
        dynamoHandler.findUser.mockResolvedValue({
            userId: 'user-1',
            username: 'Tester',
            potatoes: 999_999_999,
            starches: 999_999_999,
            companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
            companionShop: { dailyTag: null, dailyPurchasedSlots: [], weeklyTag: null, weeklyPurchasedSlots: [] }
        });

        let starchSlotIndex = null;
        for (let i = 0; i < CompanionShop.DAILY_SLOT_COUNT; i++) {
            const offering = companionShopFactory.getShopOffering('user-1', `daily:${dailyTag}`, i);
            if (offering.isStarch) {
                starchSlotIndex = i;
                break;
            }
        }
        expect(starchSlotIndex).not.toBeNull();

        const result = await companionShopFactory.attemptPurchaseSlot('user-1', 'Tester', 'daily', starchSlotIndex, now);

        expect(result.ok).toBe(false);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});
