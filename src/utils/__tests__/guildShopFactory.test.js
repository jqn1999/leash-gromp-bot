// guildShopFactory — tier/status/purchase logic for /guild-upgrade's two guild-bank-funded
// shops. Mirrors shopFactory.test.js's structure. attemptGuildShopBuy is the directly-
// testable purchase function extracted out of guildBuy.js's old immediate-purchase
// callback (see guildBuy.js's own comment) so this covers the actual buy logic without
// needing to mock an awaitMessageComponent collector.
jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const {
    GUILD_SHOP_ID_BY_SELECT,
    GUILD_SHOP_TIER_STATUS,
    getGuildShopBaseValue,
    getNextItemFromShop,
    getGuildShopTierStatus,
    formatGuildShopValue,
    attemptGuildShopBuy,
    PERSONAL_BANK_CAPACITY_CEILING,
    getAllMemberDetails,
    getGuildMemberBankCapacityBonus,
    getEffectiveGuildBankCapacity,
} = require('../guildShopFactory');
const { guildShops, shops, REGRADE_CAPS, Bank } = require('../constants');

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        guildVersion: 3,
        bankStored: 0,
        bankCapacity: 0,
        memberCap: 5,
        ...overrides,
    };
}

describe('GUILD_SHOP_ID_BY_SELECT', () => {
    test('every command choice maps to a real shopId in guildShops', () => {
        Object.values(GUILD_SHOP_ID_BY_SELECT).forEach(shopId => {
            expect(guildShops.find(s => s.shopId === shopId)).toBeDefined();
        });
    });
});

describe('getGuildShopBaseValue', () => {
    test('bankCapacity subtracts bankCapacityBonus back out', () => {
        const guild = guildFixture({ bankCapacity: 19000000, bankCapacityBonus: 9000000 });
        expect(getGuildShopBaseValue(guild, 'bankCapacity')).toBe(10000000);
    });

    test('bankCapacity treats a missing/non-finite bonus as 0', () => {
        const guild = guildFixture({ bankCapacity: 10000000 });
        expect(getGuildShopBaseValue(guild, 'bankCapacity')).toBe(10000000);
    });

    test('memberCap is used directly, no bonus subtracted', () => {
        const guild = guildFixture({ memberCap: 8 });
        expect(getGuildShopBaseValue(guild, 'memberCap')).toBe(8);
    });
});

describe('getNextItemFromShop (threshold-based, not exact-match)', () => {
    const bankShop = guildShops.find(s => s.shopId === 'bankCapacity');

    test('returns the first tier whose amount exceeds the current base, on an exact boundary', () => {
        const item = getNextItemFromShop(bankShop, 0);
        expect(item).toBe(bankShop.items[0]);
    });

    // Regression coverage carried over from guildIdReferenceErrorFixes.test.js — a guild
    // whose base capacity has drifted off a tier boundary (e.g. from a Guild Contract
    // reward applied before bankCapacityBonus tracking existed) must still resolve to the
    // correct next tier instead of reporting "already maxed out!".
    test('still finds the next tier when the base value has drifted off a tier boundary', () => {
        const item = getNextItemFromShop(bankShop, 9000000); // between 0 and tier0's 10,000,000
        expect(item).toBe(bankShop.items[0]);
    });

    test('returns -1 once every tier has been bought past the last one\'s amount', () => {
        const item = getNextItemFromShop(bankShop, 999999999999);
        expect(item).toBe(-1);
    });
});

describe('getGuildShopTierStatus', () => {
    const bankShop = guildShops.find(s => s.shopId === 'bankCapacity');
    const [tier0, tier1, tier2] = bankShop.items;

    test('a tier already surpassed (amount <= base) is OWNED', () => {
        const nextItem = getNextItemFromShop(bankShop, tier1.amount);
        expect(getGuildShopTierStatus(tier0, tier1.amount, nextItem)).toBe(GUILD_SHOP_TIER_STATUS.OWNED);
    });

    test('the tier returned by getNextItemFromShop is NEXT, even off a drifted boundary', () => {
        const nextItem = getNextItemFromShop(bankShop, 9000000);
        expect(nextItem).toBe(tier0);
        expect(getGuildShopTierStatus(tier0, 9000000, nextItem)).toBe(GUILD_SHOP_TIER_STATUS.NEXT);
    });

    test('a tier further out than the next purchasable one is LOCKED', () => {
        const nextItem = getNextItemFromShop(bankShop, tier0.currentAmount);
        expect(getGuildShopTierStatus(tier2, tier0.currentAmount, nextItem)).toBe(GUILD_SHOP_TIER_STATUS.LOCKED);
    });

    test('every tier is OWNED once maxed out (nextItem is -1)', () => {
        const nextItem = getNextItemFromShop(bankShop, 999999999999);
        expect(nextItem).toBe(-1);
        expect(getGuildShopTierStatus(tier0, 999999999999, nextItem)).toBe(GUILD_SHOP_TIER_STATUS.OWNED);
    });
});

describe('formatGuildShopValue', () => {
    test('bankCapacity formats as a plain potato amount', () => {
        expect(formatGuildShopValue('bankCapacity', 10000000)).toBe('10,000,000 potatoes');
    });

    test('memberCap formats with a members suffix', () => {
        expect(formatGuildShopValue('memberCap', 8)).toBe('8 members');
    });
});

describe('attemptGuildShopBuy', () => {
    const bankShop = guildShops.find(s => s.shopId === 'bankCapacity');
    const memberCapShop = guildShops.find(s => s.shopId === 'memberCap');

    beforeEach(() => {
        jest.clearAllMocks();
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
    });

    test('fails cleanly when the guild can\'t be looked up', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(null);
        const result = await attemptGuildShopBuy(7, 'bank-capacity');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/database error/);
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('fails with a clear reason when the shop is already maxed for this guild', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ memberCap: 25 }));
        const result = await attemptGuildShopBuy(7, 'member-cap');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/already maxed out/);
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    test('fails with the missing-amount reason when the guild bank can\'t afford the next tier', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 100, bankCapacity: 0 }));
        const result = await attemptGuildShopBuy(7, 'bank-capacity');
        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/does not have enough/);
        expect(dynamoHandler.updateGuildFieldsWithLock).not.toHaveBeenCalled();
    });

    // The actual player complaint that prompted this whole rework: the old immediate-
    // purchase flow never showed the cost paid, only the after-value. Both must be visible.
    test('on success, deducts cost and writes bankStored + the target field in ONE guarded call, message states cost and resulting value', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: bankShop.items[0].cost + 500, bankCapacity: 0 }));
        const result = await attemptGuildShopBuy(7, 'bank-capacity');

        expect(result.ok).toBe(true);
        expect(result.message).toContain(`${bankShop.items[0].cost.toLocaleString()} potatoes`);
        expect(result.message).toContain(`${bankShop.items[0].amount.toLocaleString()} potatoes`);
        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledTimes(1);
        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, {
            bankStored: 500,
            bankCapacity: bankShop.items[0].amount,
        });
    });

    test('bankCapacity purchase re-adds bankCapacityBonus on top of the new tier value', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            bankStored: 2000000,
            bankCapacity: 18000000,
            bankCapacityBonus: 9000000, // base = 9,000,000 — drifted off every tier boundary
        }));
        const result = await attemptGuildShopBuy(7, 'bank-capacity');

        expect(result.ok).toBe(true);
        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, {
            bankStored: 1000000,
            bankCapacity: 19000000, // next tier's amount (10,000,000) + untouched bonus (9,000,000)
        });
    });

    test('member-cap purchase writes memberCap directly, no bonus involved', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 10000000, memberCap: 5 }));
        const result = await attemptGuildShopBuy(7, 'member-cap');

        expect(result.ok).toBe(true);
        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledWith(7, 3, {
            bankStored: 10000000 - memberCapShop.items[0].cost,
            memberCap: memberCapShop.items[0].amount,
        });
    });

    // Concurrency regression coverage, mirroring guildCompanionDonate.test.js's own
    // updateGuildFieldsWithLock lost-race test — two Co-Leaders buying near-simultaneously
    // must not both land a purchase against the same stale read.
    test('reports a clean retry message (without a second write) when the guarded write loses the race', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ bankStored: 10000000, memberCap: 5 }));
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(false);

        const result = await attemptGuildShopBuy(7, 'member-cap');

        expect(result.ok).toBe(false);
        expect(result.message).toMatch(/guild changed/);
        expect(dynamoHandler.updateGuildFieldsWithLock).toHaveBeenCalledTimes(1);
    });
});

// Guild bank capacity's live member-contribution bonus (2026-09-30, direct instruction:
// "use a % of bank for everything shop and regrade up to the infinite but not the
// infinite"). getMemberBankCapacityContribution/getMainSafehouseCapacity's own live-bonus
// folding (companion/rebirth %) is already covered by safehouseFactory.test.js — these
// tests focus on what's NEW here: summing across a roster, substituting a finite ceiling
// for a maxed member instead of Infinity, and defending against a malformed/missing record.
describe('guild bank capacity member bonus', () => {
    function memberFixture(overrides = {}) {
        return {
            userId: 'm1', username: 'Member',
            bankCapacity: 1000000,
            regrades: { bankCapacity: { regradeAmount: 0, failStack: 0 } },
            companions: { owned: [], active: null, ownedCount: 0 },
            rebirthCount: 0,
            ...overrides,
        };
    }

    describe('PERSONAL_BANK_CAPACITY_CEILING', () => {
        test('equals the personal bank shop\'s own max tier plus the full regrade cap, derived live rather than a second hardcoded number', () => {
            const bankShop = shops.find(s => s.shopId === 'bankShop');
            const maxTier = bankShop.items[bankShop.items.length - 1];
            expect(PERSONAL_BANK_CAPACITY_CEILING).toBe(maxTier.amount + REGRADE_CAPS.bankCapacity);
        });
    });

    describe('getGuildMemberBankCapacityBonus', () => {
        test('sums each member\'s own live bank capacity at the configured percent', () => {
            const members = [memberFixture({ bankCapacity: 1000000 }), memberFixture({ bankCapacity: 2000000 })];
            const bonus = getGuildMemberBankCapacityBonus(members);
            expect(bonus).toBe(Math.round(3000000 * Bank.GUILD_MEMBER_BANK_CAPACITY_CONTRIBUTION_PERCENT));
        });

        // The whole point of the direct instruction ("up to the infinite but not the
        // infinite") — a member whose bank-capacity regrade is fully maxed returns
        // Infinity from getMainSafehouseCapacity; this must substitute the finite ceiling
        // instead, never propagate Infinity/NaN into the guild's own bonus.
        test('a member with a fully maxed bank-capacity regrade contributes the finite ceiling, not Infinity', () => {
            const maxedMember = memberFixture({ regrades: { bankCapacity: { regradeAmount: REGRADE_CAPS.bankCapacity, failStack: 0 } } });
            const bonus = getGuildMemberBankCapacityBonus([maxedMember]);
            expect(bonus).toBe(Math.round(PERSONAL_BANK_CAPACITY_CEILING * Bank.GUILD_MEMBER_BANK_CAPACITY_CONTRIBUTION_PERCENT));
            expect(Number.isFinite(bonus)).toBe(true);
        });

        test('a null/missing member record contributes 0 rather than throwing or poisoning the sum', () => {
            const members = [memberFixture({ bankCapacity: 1000000 }), null, undefined];
            const bonus = getGuildMemberBankCapacityBonus(members);
            expect(bonus).toBe(Math.round(1000000 * Bank.GUILD_MEMBER_BANK_CAPACITY_CONTRIBUTION_PERCENT));
        });

        // getMainSafehouseCapacity reads straight into `regrades.bankCapacity.regradeAmount`
        // with no guard of its own — a record missing that nested shape entirely (a test
        // fixture elsewhere in this codebase that never anticipated this new call path, or a
        // genuinely corrupted record) must still resolve to 0, not throw.
        test('a record missing the regrades.bankCapacity shape entirely contributes 0 rather than throwing', () => {
            const bareMember = { userId: 'm1', username: 'Member', bankCapacity: 1000000 };
            expect(() => getGuildMemberBankCapacityBonus([bareMember])).not.toThrow();
            expect(getGuildMemberBankCapacityBonus([bareMember])).toBe(0);
        });

        test('an empty roster contributes a 0 bonus', () => {
            expect(getGuildMemberBankCapacityBonus([])).toBe(0);
        });
    });

    describe('getEffectiveGuildBankCapacity', () => {
        test('adds the member bonus on top of the guild\'s own shop-purchased bankCapacity', () => {
            const guild = guildFixture({ bankCapacity: 2500000000 });
            expect(getEffectiveGuildBankCapacity(guild, 125000000)).toBe(2625000000);
        });

        test('a zero bonus leaves the guild\'s own bankCapacity unchanged', () => {
            const guild = guildFixture({ bankCapacity: 2500000000 });
            expect(getEffectiveGuildBankCapacity(guild, 0)).toBe(2500000000);
        });
    });

    describe('getAllMemberDetails', () => {
        test('fetches findUser for every member in guild.memberList, in order — the whole roster, not just autoJoinRaids members', async () => {
            const guild = guildFixture({
                memberList: [{ id: 'a', username: 'Alice' }, { id: 'b', username: 'Bob' }],
            });
            const aliceDetails = memberFixture({ userId: 'a', username: 'Alice' });
            const bobDetails = memberFixture({ userId: 'b', username: 'Bob' });
            dynamoHandler.findUser.mockImplementation(async (id) => (id === 'a' ? aliceDetails : id === 'b' ? bobDetails : undefined));

            const result = await getAllMemberDetails(guild);

            expect(dynamoHandler.findUser).toHaveBeenCalledWith('a', 'Alice');
            expect(dynamoHandler.findUser).toHaveBeenCalledWith('b', 'Bob');
            expect(result).toEqual([aliceDetails, bobDetails]);
        });
    });
});
