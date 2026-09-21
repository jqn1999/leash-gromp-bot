jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const { resolveTradingPostScope, isScopeGuild, hasAnyLivePotion, findPotionById, getDailyTag, hasBoughtToday, attemptPurchasePotion } = require('../tradingPostFactory');
const { Potions } = require('../constants');

const workPotion = Potions.CATALOG.find(p => p.effectType === 'workMulti');
const timerPotion = Potions.CATALOG.find(p => p.effectType === 'workTimer');
const passivePotion = Potions.CATALOG.find(p => p.effectType === 'passiveAmount');

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

    test('rejects with a clear shortfall message when unaffordable', async () => {
        dynamoHandler.findUser.mockResolvedValue(freshUser({ guildId: 'g1', potatoes: 100 }));
        const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/don't have enough/);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('with no active potion, grants a brand new activePotion and deducts the price', async () => {
        const before = Date.now();
        dynamoHandler.findUser.mockResolvedValue(freshUser({ guildId: 'g1', potatoes: 10000000, activePotion: null }));
        const result = await attemptPurchasePotion('u1', 'user1', workPotion.id);

        expect(result.ok).toBe(true);
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [userId, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(userId).toBe('u1');
        expect(setAttributes.potatoes).toBe(10000000 - workPotion.pricePotatoes);
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

    // Daily stock limit (2026-09-21) — one purchase per potionId per Eastern trading day.
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
    });
});
