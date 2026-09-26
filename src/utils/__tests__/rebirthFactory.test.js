const { checkRebirthEligibility, getRebirthBonusPercent, getLiveRebirthPercent, previewRebirthBonus, computeRebirthState, healBaseDrift } = require('../rebirthFactory');
const { Rebirth, Bank, Starch } = require('../constants');

function maxedUser(overrides = {}) {
    return {
        // Base (shop-purchased) + regrade exactly at the max for all three tracks, plus
        // a small pre-existing sweetPotatoBuffs so the base-value math has to actually
        // subtract it out rather than coincidentally working with buffs at 0.
        workMultiplierAmount: 100 + 500 + 5,       // shop max 100 + regrade max 500 + buff 5
        passiveAmount: 60000000 + 600000000 + 10000,
        bankCapacity: 1000000000 + 103000000000 + 100000,
        maxStarches: 200000,
        sweetPotatoBuffs: { workMultiplierAmount: 5, passiveAmount: 10000, bankCapacity: 100000 },
        regrades: {
            workMulti: { regradeAmount: 500, failStack: 0 },
            passiveAmount: { regradeAmount: 600000000, failStack: 0 },
            bankCapacity: { regradeAmount: 103000000000, failStack: 0 }
        },
        rebirthCount: 0,
        ...overrides,
    };
}

describe('checkRebirthEligibility', () => {
    test('a brand-new account is missing every requirement', () => {
        const fresh = {
            workMultiplierAmount: 1, passiveAmount: 0, bankCapacity: 0, maxStarches: 250,
            sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 }
            },
        };
        const result = checkRebirthEligibility(fresh);
        expect(result.eligible).toBe(false);
        expect(result.missing).toHaveLength(7);
    });

    test('fully maxed base shops and regrades are eligible, regardless of sweetPotatoBuffs on top', () => {
        const result = checkRebirthEligibility(maxedUser());
        expect(result).toEqual({ eligible: true, missing: [] });
    });

    test('sweetPotatoBuffs does not count toward the base-shop requirement — one buff point short of true shop-max base is still ineligible', () => {
        // workMultiplierAmount here is buff-inflated to LOOK maxed, but the underlying
        // base (effective - buffs - regrade) is 99, one short of the shop's real max of
        // 100 — the exact bug class this check exists to prevent (a player using an
        // earned buff to skip actually finishing the shop).
        const almostMaxed = maxedUser({
            workMultiplierAmount: 99 + 500 + 5, // base 99, not 100
        });
        const result = checkRebirthEligibility(almostMaxed);
        expect(result.eligible).toBe(false);
        expect(result.missing).toEqual(['Work Multiplier shop']);
    });

    test('reports every unmet requirement, not just the first', () => {
        const onlyWorkMultiDone = maxedUser({
            passiveAmount: 100000,
            bankCapacity: 100000,
            maxStarches: 250,
            regrades: {
                workMulti: { regradeAmount: 500, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 }
            },
        });
        const result = checkRebirthEligibility(onlyWorkMultiDone);
        expect(result.eligible).toBe(false);
        expect(result.missing).toEqual(expect.arrayContaining([
            'Passive Income shop', 'Bank Capacity shop', 'Starch Capacity shop',
            'Passive Income regrade', 'Bank Capacity regrade'
        ]));
        expect(result.missing).not.toContain('Work Multiplier shop');
        expect(result.missing).not.toContain('Work Multiplier regrade');
    });

    // Starch shop grew from 5 tiers (max 10,000) to 7 (max 50,000) on 2026-09-12, direct
    // instruction — rebirth's own eligibility check reads the shop's last tier dynamically
    // (getShopMax('starchShop')), so this bar moved too, on purpose (confirmed with the
    // player rather than assumed): a roster that was rebirth-ready at the old 10,000 cap
    // is no longer ready until they've bought the new 25,000/50,000 tiers as well.
    test('the old 5-tier max (10,000) no longer satisfies the Starch Capacity shop requirement — the new tiers raised the bar', () => {
        const result = checkRebirthEligibility(maxedUser({ maxStarches: 10000 }));
        expect(result.eligible).toBe(false);
        expect(result.missing).toEqual(['Starch Capacity shop']);
    });

    test('the new 7-tier max (50,000) satisfies the Starch Capacity shop requirement', () => {
        const result = checkRebirthEligibility(maxedUser({ maxStarches: 50000 }));
        expect(result.eligible).toBe(true);
    });
});

describe('getRebirthBonusPercent', () => {
    test('0 rebirths (never rebirthed) is 0%', () => {
        expect(getRebirthBonusPercent(0)).toBe(0);
        expect(getRebirthBonusPercent(undefined)).toBe(0);
    });

    test('rebirth count 1 is the base percent', () => {
        expect(getRebirthBonusPercent(1)).toBe(Rebirth.BASE_BONUS_PERCENT);
    });

    test('each rebirth count after 1 adds one step', () => {
        expect(getRebirthBonusPercent(2)).toBeCloseTo(Rebirth.BASE_BONUS_PERCENT + Rebirth.BONUS_PERCENT_STEP);
        expect(getRebirthBonusPercent(5)).toBeCloseTo(Rebirth.BASE_BONUS_PERCENT + 4 * Rebirth.BONUS_PERCENT_STEP);
    });

    test('holds at MAX_BONUS_PERCENT once reached, never exceeds it', () => {
        const rebirthAtCap = Math.round((Rebirth.MAX_BONUS_PERCENT - Rebirth.BASE_BONUS_PERCENT) / Rebirth.BONUS_PERCENT_STEP) + 1;
        expect(getRebirthBonusPercent(rebirthAtCap)).toBeCloseTo(Rebirth.MAX_BONUS_PERCENT);
        expect(getRebirthBonusPercent(rebirthAtCap + 10)).toBeCloseTo(Rebirth.MAX_BONUS_PERCENT);
    });

    test('does not stack across multiple rebirths — it is a lookup on the current count, not a running sum', () => {
        // rebirth count 3's own percent, NOT percent(1) + percent(2) + percent(3).
        const sumOfAll = getRebirthBonusPercent(1) + getRebirthBonusPercent(2) + getRebirthBonusPercent(3);
        expect(getRebirthBonusPercent(3)).not.toBeCloseTo(sumOfAll);
        expect(getRebirthBonusPercent(3)).toBeCloseTo(0.24);
    });
});

describe('getLiveRebirthPercent', () => {
    test('0 for a user who has never rebirthed', () => {
        expect(getLiveRebirthPercent(maxedUser({ rebirthCount: 0 }))).toBe(0);
    });

    test('matches getRebirthBonusPercent for the user\'s current rebirthCount when no companion is active', () => {
        const user = maxedUser({ rebirthCount: 3 });
        expect(getLiveRebirthPercent(user)).toBeCloseTo(getRebirthBonusPercent(3));
    });

    test('an unequipped user (no companions field) does not throw', () => {
        const user = maxedUser({ rebirthCount: 2 });
        delete user.companions;
        expect(() => getLiveRebirthPercent(user)).not.toThrow();
        expect(getLiveRebirthPercent(user)).toBeCloseTo(getRebirthBonusPercent(2));
    });

    test('Mochi active amplifies the live percent by +20%, recomputed fresh (not tied to a "moment of rebirth")', () => {
        const user = maxedUser({
            rebirthCount: 1,
            companions: { owned: [{ instanceId: 'mochi-a', id: 'mochi', workCount: 0 }], active: 'mochi-a', ownedCount: 1, mythicOwnedCount: 1 }
        });
        expect(getLiveRebirthPercent(user)).toBeCloseTo(0.05 * 1.20);
    });
});

describe('previewRebirthBonus', () => {
    test('a fresh account previews current 0% going to 5% at rebirth #1', () => {
        const preview = previewRebirthBonus(maxedUser({ rebirthCount: 0 }));
        expect(preview.rebirthNumber).toBe(1);
        expect(preview.currentPercent).toBe(0);
        expect(preview.nextPercent).toBeCloseTo(0.05);
    });

    test('a returning rebirther previews their current live percent going up to the next step', () => {
        const preview = previewRebirthBonus(maxedUser({ rebirthCount: 1 }));
        expect(preview.rebirthNumber).toBe(2);
        expect(preview.currentPercent).toBeCloseTo(0.05);
        expect(preview.nextPercent).toBeCloseTo(0.145);
    });
});

describe('computeRebirthState', () => {
    test('wipes potatoes, bankStored, and every regrade track back to zero', () => {
        const result = computeRebirthState(maxedUser({ potatoes: 999999999, bankStored: 888888888 }));
        expect(result.potatoes).toBe(0);
        expect(result.bankStored).toBe(0);
        expect(result.regrades).toEqual({
            workMulti: { regradeAmount: 0, failStack: 0 },
            passiveAmount: { regradeAmount: 0, failStack: 0 },
            bankCapacity: { regradeAmount: 0, failStack: 0 }
        });
    });

    test('resets each grindable stat to its base default plus sweetPotatoBuffs UNCHANGED — no rebirth bonus baked in anymore', () => {
        const user = maxedUser();
        const result = computeRebirthState(user);

        expect(result.workMultiplierAmount).toBe(1 + 5);
        expect(result.passiveAmount).toBe(0 + 10000);
        expect(result.bankCapacity).toBe(Bank.STARTING_CAPACITY + 100000);
        expect(result.maxStarches).toBe(Starch.STARTING_CAPACITY);
    });

    test('sweetPotatoBuffs carries forward exactly as-is — rebirth no longer writes into it', () => {
        const user = maxedUser();
        const result = computeRebirthState(user);
        expect(result.sweetPotatoBuffs).toEqual(user.sweetPotatoBuffs);
    });

    test('increments rebirthCount from whatever it already was, defaulting a missing/undefined count to 0 first', () => {
        expect(computeRebirthState(maxedUser({ rebirthCount: 4 })).rebirthCount).toBe(5);
        expect(computeRebirthState(maxedUser({ rebirthCount: undefined })).rebirthCount).toBe(1);
    });

    test('the reward is purely rebirthCount going up — the live percentage for the new count is bigger than the old one', () => {
        const before = maxedUser({ rebirthCount: 1 });
        const after = computeRebirthState(before);
        expect(getLiveRebirthPercent(before)).toBeCloseTo(getRebirthBonusPercent(1));
        expect(getLiveRebirthPercent({ ...before, rebirthCount: after.rebirthCount })).toBeCloseTo(getRebirthBonusPercent(2));
        expect(getRebirthBonusPercent(2)).toBeGreaterThan(getRebirthBonusPercent(1));
    });
});

// dynamoHandler.findUser's own base-vs-shop-tier drift self-heal (root-caused 2026-09-23 —
// see that entry in roadmap.md and healBaseDrift's own comment) — a reward path that ever
// credited a stat's raw total without symmetrically crediting sweetPotatoBuffs strands the
// excess in getBaseValue's reconstruction forever, breaking /buy's and /regrade's exact-
// match tier lookups. These tests exercise healBaseDrift as the pure function it is;
// dynamoHandler.test.js covers that findUser actually calls it and persists the result.
describe('healBaseDrift', () => {
    function cleanUser(overrides = {}) {
        return {
            workMultiplierAmount: 1, passiveAmount: 0, bankCapacity: Bank.STARTING_CAPACITY,
            sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 }
            },
            ...overrides,
        };
    }

    test('a brand-new account (base sitting exactly at the pre-purchase default) needs no healing', () => {
        expect(healBaseDrift(cleanUser())).toBeNull();
    });

    test('a base sitting exactly on a real shop tier (mid-ladder) needs no healing', () => {
        // workShop tier 5 (currentAmount 10) -> amount 15; sitting exactly at 15 is clean.
        const user = cleanUser({ workMultiplierAmount: 15 });
        expect(healBaseDrift(user)).toBeNull();
    });

    test('a fully maxed account (base exactly at the top tier) needs no healing', () => {
        const user = cleanUser({ workMultiplierAmount: 100, bankCapacity: 1000000000 });
        expect(healBaseDrift(user)).toBeNull();
    });

    // Reproduces the exact reported case: work multi base sitting 0.8 ABOVE the top real
    // tier (100), from some past reward crediting the raw total without also crediting
    // sweetPotatoBuffs by the same amount.
    test('work multi base drifted above the top tier: folds the excess into sweetPotatoBuffs, total unchanged', () => {
        // Reported base 100.80 + sweetPotatoBuffs 47.60 + regrade 0 = total 148.40.
        const user = cleanUser({ workMultiplierAmount: 148.40, sweetPotatoBuffs: { workMultiplierAmount: 47.60, passiveAmount: 0, bankCapacity: 0 } });
        const healed = healBaseDrift(user);
        expect(healed).not.toBeNull();
        expect(healed.workMultiplierAmount).toBeCloseTo(48.40);
        // Reconstructing base off the healed sweetPotatoBuffs now lands exactly on tier 100.
        const newBase = user.workMultiplierAmount - healed.workMultiplierAmount - user.regrades.workMulti.regradeAmount;
        expect(newBase).toBeCloseTo(100);
    });

    // Reproduces the bank-capacity half of the exact reported case: base sitting between
    // two real tiers (50,000,000 and 250,000,000) rather than on either one.
    test('bank capacity base drifted between two tiers: folds the excess into sweetPotatoBuffs, total unchanged', () => {
        // Reported base 55,000,000 + sweetPotatoBuffs 565,471,986 + regrade 0 = total 620,471,986.
        const user = cleanUser({ bankCapacity: 620471986, sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 565471986 } });
        const healed = healBaseDrift(user);
        expect(healed).not.toBeNull();
        expect(healed.bankCapacity).toBe(570471986);
        const newBase = user.bankCapacity - healed.bankCapacity - user.regrades.bankCapacity.regradeAmount;
        expect(newBase).toBe(50000000);
    });

    test('heals multiple drifted stats in the same account in one call', () => {
        const user = cleanUser({
            workMultiplierAmount: 148.40,
            bankCapacity: 620471986,
            sweetPotatoBuffs: { workMultiplierAmount: 47.60, passiveAmount: 0, bankCapacity: 565471986 },
        });
        const healed = healBaseDrift(user);
        expect(healed.workMultiplierAmount).toBeCloseTo(48.40);
        expect(healed.bankCapacity).toBe(570471986);
    });

    test('the live total is byte-for-byte unchanged by healing — this only recategorizes, never grants or removes anything', () => {
        const user = cleanUser({ workMultiplierAmount: 148.40, sweetPotatoBuffs: { workMultiplierAmount: 47.60, passiveAmount: 0, bankCapacity: 0 } });
        const totalBefore = user.workMultiplierAmount;
        const healed = healBaseDrift(user);
        // healBaseDrift never touches workMultiplierAmount itself, only sweetPotatoBuffs —
        // reconstructing (new base + healed sweet + regrade) must land back on the exact
        // same total the account already had.
        const newBase = user.workMultiplierAmount - healed.workMultiplierAmount - user.regrades.workMulti.regradeAmount;
        const totalAfter = newBase + healed.workMultiplierAmount + user.regrades.workMulti.regradeAmount;
        expect(totalAfter).toBeCloseTo(totalBefore);
        expect(user.workMultiplierAmount).toBe(totalBefore); // untouched
    });

    // Tiny float noise (~1e-10, the realistic magnitude after many grants — see
    // workFactory.js's own SHOP_TIER_MATCH_TOLERANCE comment) must NOT trigger a heal on
    // every single findUser call for essentially every account in the game.
    test('does not heal float noise below the tolerance threshold', () => {
        const user = cleanUser({ workMultiplierAmount: 100 + 1e-10 });
        expect(healBaseDrift(user)).toBeNull();
    });

    // A base BELOW the account's own floor is the opposite problem (sweetPotatoBuffs/
    // regrade overcounted relative to the total) — healBaseDrift must never "fix" this by
    // folding MORE into sweetPotatoBuffs, which would only make the shortfall worse.
    test('does not touch an account whose base is impossibly below the pre-purchase default', () => {
        const user = cleanUser({ workMultiplierAmount: 10, sweetPotatoBuffs: { workMultiplierAmount: 20, passiveAmount: 0, bankCapacity: 0 } });
        expect(healBaseDrift(user)).toBeNull();
    });

    test('passiveAmount drift is healed the same way as the other two tracks', () => {
        // passiveIncomeShop tier 1 amount, per constants.js — drift it up by 12,345.
        const shops = require('../constants').shops;
        const passiveShop = shops.find(s => s.shopId === 'passiveIncomeShop');
        const tier1Amount = passiveShop.items[0].amount;
        const user = cleanUser({ passiveAmount: tier1Amount + 12345 });
        const healed = healBaseDrift(user);
        expect(healed.passiveAmount).toBe(12345);
    });
});
