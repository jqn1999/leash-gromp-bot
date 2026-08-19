const { checkRebirthEligibility, getRebirthBonusPercent, getLiveRebirthPercent, previewRebirthBonus, computeRebirthState } = require('../rebirthFactory');
const { Rebirth } = require('../constants');

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
            workMultiplierAmount: 1, passiveAmount: 0, bankCapacity: 0, maxStarches: 25000,
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
            maxStarches: 25000,
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
            companions: { owned: [{ id: 'mochi', level: 1 }], active: 'mochi', ownedCount: 1, mythicOwnedCount: 1 }
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
        expect(result.bankCapacity).toBe(0 + 100000);
        expect(result.maxStarches).toBe(25000);
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
