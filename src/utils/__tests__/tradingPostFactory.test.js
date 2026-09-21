jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { resolveTradingPostScope, isScopeGuild, hasAnyLivePotion, findPotionById, getDailyTag, hasBoughtToday, computePotionPrice, getDailyRotation, attemptPurchasePotion } = require('../tradingPostFactory');
const { Potions } = require('../constants');

// This player's own daily rotation is used throughout — attemptPurchasePotion only ever
// accepts a potionId that's actually in TODAY's rotation for the buyer, so every
// happy-path test below buys off this rotation rather than an arbitrary catalog id.
const rotation = getDailyRotation('u1');
const workPotion = rotation.find(p => p.effectType === 'workMulti');
const timerPotion = rotation.find(p => p.effectType === 'workTimer');
const passivePotion = rotation.find(p => p.effectType === 'passiveAmount');
// Any workMulti-line potion NOT offered in u1's rotation today — used to test the
// off-rotation rejection.
const offRotationWorkPotion = Potions.CATALOG.find(p => p.effectType === 'workMulti' && p.id !== workPotion.id);

function freshUser(overrides = {}) {
    return {
        potatoes: 10000000,
        guildId: 0,
        isMercenary: false,
        activePotion: null,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('resolveTradingPostScope', () => {
    test('a mercenary resolves to the fixed "merc" scope, regardless of guildId', () => {
        expect(resolveTradingPostScope({ isMercenary: true, guildId: 0 })).toBe('merc');
    });

    test('a guilded, non-mercenary player resolves to guild#<id>', () => {
        expect(resolveTradingPostScope({ isMercenary: false, guildId: 'g1' })).toBe('guild#g1');
    });

    test('neither guilded nor a mercenary resolves to null', () => {
        expect(resolveTradingPostScope({ isMercenary: false, guildId: 0 })).toBeNull();
    });
});

describe('isScopeGuild', () => {
    test('true for a guild# scope key', () => {
        expect(isScopeGuild('guild#g1')).toBe(true);
    });

    test('false for the merc scope key or null', () => {
        expect(isScopeGuild('merc')).toBe(false);
        expect(isScopeGuild(null)).toBe(false);
    });
});

describe('hasAnyLivePotion', () => {
    test('false when there is no potion at all', () => {
        expect(hasAnyLivePotion(null)).toBe(false);
    });

    test('false once expiresAt has passed, regardless of effectType', () => {
        expect(hasAnyLivePotion({ effectType: 'workMulti', expiresAt: Date.now() - 1000 })).toBe(false);
    });

    test('true for any still-live potion', () => {
        expect(hasAnyLivePotion({ effectType: 'passiveAmount', expiresAt: Date.now() + 1000 })).toBe(true);
    });
});

describe('findPotionById', () => {
    test('returns the matching catalog entry', () => {
        expect(findPotionById(workPotion.id)).toBe(workPotion);
    });

    test('returns null for an unknown id', () => {
        expect(findPotionById('not-a-real-potion')).toBeNull();
    });
});

describe('getDailyTag — 8pm ET boundary (same shape as companionShopFactory.js\'s own)', () => {
    test('a moment before 8pm ET stays on the current Eastern calendar day', () => {
        // 7:59pm ET on 2026-09-14 (EDT, UTC-4) is 23:59 UTC the same day.
        expect(getDailyTag(new Date('2026-09-14T23:59:00Z'))).toBe('2026-09-14');
    });

    test('a moment at/after 8pm ET rolls to the next day', () => {
        // 8:00pm ET on 2026-09-14 is 00:00 UTC on 2026-09-15.
        expect(getDailyTag(new Date('2026-09-15T00:00:00Z'))).toBe('2026-09-15');
    });
});

describe('hasBoughtToday — lazy reset, one purchase per potion per Eastern trading day', () => {
    const now = new Date('2026-09-14T12:00:00Z'); // stays 2026-09-14 either side of 8pm ET
    const today = getDailyTag(now);

    test('false with no record at all', () => {
        expect(hasBoughtToday(freshUser(), workPotion.id, now)).toBe(false);
    });

    test('false when today\'s record exists but doesn\'t include this potionId', () => {
        const user = freshUser({ tradingPostDailyPurchases: { dailyTag: today, potionIds: [timerPotion.id] } });
        expect(hasBoughtToday(user, workPotion.id, now)).toBe(false);
    });

    test('true when today\'s record includes this exact potionId', () => {
        const user = freshUser({ tradingPostDailyPurchases: { dailyTag: today, potionIds: [workPotion.id] } });
        expect(hasBoughtToday(user, workPotion.id, now)).toBe(true);
    });

    test('a STALE record (yesterday\'s tag) reads as false, even for a potionId it lists', () => {
        const user = freshUser({ tradingPostDailyPurchases: { dailyTag: '2026-09-13', potionIds: [workPotion.id] } });
        expect(hasBoughtToday(user, workPotion.id, now)).toBe(false);
    });
});

describe('computePotionPrice — floor(priceFloor + pricePerPoint/pricePct * userDetails[priceStat])', () => {
    test('a pricePerPoint line (workDraught, Tier I) at a couple of sample stat values', () => {
        const potion = Potions.CATALOG.find(p => p.id === 'workDraught');
        expect(computePotionPrice(potion, { workMultiplierAmount: 0 })).toBe(5000);
        expect(computePotionPrice(potion, { workMultiplierAmount: 10 })).toBe(5000 + 250 * 10);
        expect(computePotionPrice(potion, { workMultiplierAmount: 42 })).toBe(Math.floor(5000 + 250 * 42));
    });

    test('a pricePerPoint line at Tier III (workDraughtIII) scales off the same stat with its own floor/rate', () => {
        const potion = Potions.CATALOG.find(p => p.id === 'workDraughtIII');
        expect(computePotionPrice(potion, { workMultiplierAmount: 0 })).toBe(15000);
        expect(computePotionPrice(potion, { workMultiplierAmount: 20 })).toBe(15000 + 1500 * 20);
    });

    test('a pricePct line (hoardersBrew, Tier I) scales off passiveAmount', () => {
        const potion = Potions.CATALOG.find(p => p.id === 'hoardersBrew');
        expect(computePotionPrice(potion, { passiveAmount: 0 })).toBe(1000);
        expect(computePotionPrice(potion, { passiveAmount: 500000 })).toBe(Math.floor(1000 + 0.0012 * 500000));
    });

    test('a pricePct line at Tier III (hoardersBrewIII) uses its own floor/rate', () => {
        const potion = Potions.CATALOG.find(p => p.id === 'hoardersBrewIII');
        expect(computePotionPrice(potion, { passiveAmount: 1000000 })).toBe(Math.floor(3000 + 0.0065 * 1000000));
    });

    test('quickstepTonic prices off workMultiplierAmount despite its own effectType being workTimer', () => {
        const potion = Potions.CATALOG.find(p => p.id === 'quickstepTonic');
        expect(potion.effectType).toBe('workTimer');
        expect(potion.priceStat).toBe('workMultiplierAmount');
        expect(computePotionPrice(potion, { workMultiplierAmount: 8, passiveAmount: 999999 })).toBe(3000 + 450 * 8);
    });

    test('a missing/NaN priceStat value guards to 0 rather than propagating NaN', () => {
        const potion = Potions.CATALOG.find(p => p.id === 'workDraught');
        expect(computePotionPrice(potion, {})).toBe(5000);
        expect(computePotionPrice(potion, { workMultiplierAmount: 'not-a-number' })).toBe(5000);
    });
});

describe('getDailyRotation', () => {
    test('always returns exactly one potion per TradingPostRotation.SLOT_EFFECT_TYPES entry', () => {
        const result = getDailyRotation('some-user');
        expect(result).toHaveLength(3);
        expect(result.map(p => p.effectType).sort()).toEqual(['passiveAmount', 'workMulti', 'workTimer'].sort());
    });

    test('is deterministic for the same userId + dailyTag', () => {
        const now = new Date('2026-09-21T12:00:00Z');
        const first = getDailyRotation('same-user', now);
        const second = getDailyRotation('same-user', now);
        expect(first.map(p => p.id)).toEqual(second.map(p => p.id));
    });

    test('two different users can get different rotations on the same day', () => {
        const now = new Date('2026-09-21T12:00:00Z');
        const a = getDailyRotation('user-a', now).map(p => p.id);
        const b = getDailyRotation('user-b', now).map(p => p.id);
        // Not guaranteed to differ in every slot, but at least confirms independence —
        // both rotations are still individually valid (one per effect type).
        expect(a).toHaveLength(3);
        expect(b).toHaveLength(3);
    });

    test('a new dailyTag (a different day) can roll a different rotation than the prior day', () => {
        const day1 = getDailyRotation('rolling-user', new Date('2026-09-21T12:00:00Z')).map(p => p.id);
        const day2 = getDailyRotation('rolling-user', new Date('2026-09-14T12:00:00Z')).map(p => p.id);
        // Both remain individually valid regardless of whether they happen to match.
        expect(day1).toHaveLength(3);
        expect(day2).toHaveLength(3);
    });
});

describe('attemptPurchasePotion', () => {
    test('fails cleanly when the user can\'t be looked up', async () => {
        dynamoHandler.findUser.mockResolvedValue(null);
        const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/database error/);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('fails cleanly for an unknown potion id', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser());
        const result = await attemptPurchasePotion('u1', 'user1', 'not-a-real-potion');
        expect(result.ok).toBe(false);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects a player with no resolved scope (neither guilded nor a mercenary)', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({ guildId: 0, isMercenary: false }));
        const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/guild.*mercenary/i);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    // Daily rotation (2026-09-21) — a potionId that isn't in today's rotation for this
    // buyer gets rejected before price/affordability is even considered (e.g. a stale
    // embed, or a hand-crafted customId for an off-rotation tier).
    test('rejects a potionId that is not in today\'s rotation for this buyer', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({ guildId: 'g1' }));
        const result = await attemptPurchasePotion('u1', 'user1', offRotationWorkPotion.id);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/rotation/i);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects with a clear shortfall message when unaffordable', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({ guildId: 'g1', potatoes: 100 }));
        const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/don't have enough/);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('with no active potion, grants a brand new activePotion and deducts the live computed price', async () => {
        const before = Date.now();
        const user = freshUser({ guildId: 'g1', potatoes: 10000000, activePotion: null, workMultiplierAmount: 15 });
        dynamoHandler.findUser.mockResolvedValue(user);
        const price = computePotionPrice(workPotion, user);

        const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);

        expect(result.ok).toBe(true);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [userId, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(userId).toBe('u1');
        expect(setAttributes.potatoes).toBe(10000000 - price);
        expect(setAttributes.activePotion).toMatchObject({
            potionId: workPotion.id,
            effectType: workPotion.effectType,
            value: workPotion.value,
        });
        expect(setAttributes.activePotion.expiresAt).toBeGreaterThanOrEqual(before + workPotion.durationSeconds * 1000);
    });

    // Purchase rule (systems/trading-post.md "Purchase rule") — same effectType while one
    // is active EXTENDS expiresAt by the new potion's own durationSeconds, never re-rolling
    // value.
    test('buying the SAME effect type while one is active extends expiresAt without re-rolling value', async () => {
        const originalExpiresAt = Date.now() + 1000;
        dynamoHandler.findUser.mockResolvedValue(freshUser({
            guildId: 'g1',
            activePotion: { potionId: workPotion.id, effectType: workPotion.effectType, value: workPotion.value, expiresAt: originalExpiresAt },
        }));

        const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);

        expect(result.ok).toBe(true);
        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.activePotion.value).toBe(workPotion.value);
        expect(setAttributes.activePotion.expiresAt).toBe(originalExpiresAt + workPotion.durationSeconds * 1000);
    });

    // Buying a DIFFERENT effectType while one is active is rejected outright — no partial
    // refund, no silent overwrite.
    test('buying a DIFFERENT effect type while one is active is rejected outright, naming what\'s active', async () => {
        const originalExpiresAt = Date.now() + 3600000;
        dynamoHandler.findUser.mockResolvedValue(freshUser({
            guildId: 'g1',
            activePotion: { potionId: workPotion.id, effectType: workPotion.effectType, value: workPotion.value, expiresAt: originalExpiresAt },
        }));

        const result = await attemptPurchasePotion('u1', 'user1', timerPotion.id);

        expect(result.ok).toBe(false);
        expect(result.message).toContain(workPotion.name);
        expect(result.message).toContain(`<t:${Math.floor(originalExpiresAt / 1000)}:R>`);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    // An EXPIRED active potion of a different type is not "already active" — a fresh
    // purchase of a different effect type should succeed cleanly, same as having no potion
    // at all.
    test('an expired potion of a different type does not block a new purchase', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({
            guildId: 'g1',
            activePotion: { potionId: workPotion.id, effectType: workPotion.effectType, value: workPotion.value, expiresAt: Date.now() - 1000 },
        }));

        const result = await attemptPurchasePotion('u1', 'user1', timerPotion.id);

        expect(result.ok).toBe(true);
        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.activePotion.effectType).toBe(timerPotion.effectType);
    });

    test('works identically for a mercenary (merc scope, not just guild scope)', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({ guildId: 0, isMercenary: true, activePotion: null }));
        const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);
        expect(result.ok).toBe(true);
    });

    // Daily stock limit (2026-09-21) — one purchase per potionId per Eastern trading day,
    // still holds against the new tiered ids exactly as it did against the original 3.
    describe('daily purchase limit', () => {
        test('rejects a potion already bought today, without touching potatoes/activePotion', async () => {
            const today = getDailyTag();
            dynamoHandler.findUser.mockResolvedValue(freshUser({
                guildId: 'g1',
                tradingPostDailyPurchases: { dailyTag: today, potionIds: [workPotion.id] },
            }));

            const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);

            expect(result.ok).toBe(false);
            expect(result.message).toMatch(/already bought.*today/i);
            expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        });

        test('a successful purchase records today\'s tag and this potionId', async () => {
            dynamoHandler.findUser.mockResolvedValue(freshUser({ guildId: 'g1', activePotion: null }));

            await attemptPurchasePotion('u1', 'user1', workPotion.id);

            const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setAttributes.tradingPostDailyPurchases).toEqual({ dailyTag: getDailyTag(), potionIds: [workPotion.id] });
        });

        test('buying a second potion the same day appends to, not replaces, today\'s list', async () => {
            const today = getDailyTag();
            dynamoHandler.findUser.mockResolvedValue(freshUser({
                guildId: 'g1',
                activePotion: null,
                tradingPostDailyPurchases: { dailyTag: today, potionIds: [timerPotion.id] },
            }));

            await attemptPurchasePotion('u1', 'user1', passivePotion.id);

            const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setAttributes.tradingPostDailyPurchases).toEqual({ dailyTag: today, potionIds: [timerPotion.id, passivePotion.id] });
        });

        test('a STALE list (yesterday\'s tag) is not carried forward — starts fresh, and does not block the purchase', async () => {
            dynamoHandler.findUser.mockResolvedValue(freshUser({
                guildId: 'g1',
                activePotion: null,
                tradingPostDailyPurchases: { dailyTag: '2020-01-01', potionIds: [workPotion.id] },
            }));

            const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);

            expect(result.ok).toBe(true);
            const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setAttributes.tradingPostDailyPurchases).toEqual({ dailyTag: getDailyTag(), potionIds: [workPotion.id] });
        });

        test('same-type extension purchase still counts against the daily limit (records the tag/potionId too)', async () => {
            const originalExpiresAt = Date.now() + 1000;
            dynamoHandler.findUser.mockResolvedValue(freshUser({
                guildId: 'g1',
                activePotion: { potionId: workPotion.id, effectType: workPotion.effectType, value: workPotion.value, expiresAt: originalExpiresAt },
            }));

            const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);

            expect(result.ok).toBe(true);
            const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setAttributes.tradingPostDailyPurchases.potionIds).toContain(workPotion.id);
        });

        test('a Tier II id (still today\'s rotated potion, if applicable) is tracked by its own exact id, not folded into its Tier I sibling', async () => {
            // Regardless of which tier u1's actual rotation rolled for workMulti today,
            // hasBoughtToday/attemptPurchasePotion track the EXACT rotated id — confirms a
            // tiered id is never conflated with another tier of the same line.
            dynamoHandler.findUser.mockResolvedValue(freshUser({
                guildId: 'g1',
                activePotion: null,
                tradingPostDailyPurchases: { dailyTag: getDailyTag(), potionIds: [] },
            }));

            await attemptPurchasePotion('u1', 'user1', workPotion.id);

            const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setAttributes.tradingPostDailyPurchases.potionIds).toEqual([workPotion.id]);
        });
    });
});
