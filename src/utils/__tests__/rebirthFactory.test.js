const { checkRebirthEligibility, getRebirthBonusPercent, previewRebirthBonus, computeRebirthState } = require('../rebirthFactory');
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
    test('rebirth #1 is the base percent', () => {
        expect(getRebirthBonusPercent(1)).toBe(Rebirth.BASE_BONUS_PERCENT);
    });

    test('each rebirth after the first adds one step', () => {
        expect(getRebirthBonusPercent(2)).toBeCloseTo(Rebirth.BASE_BONUS_PERCENT + Rebirth.BONUS_PERCENT_STEP);
        expect(getRebirthBonusPercent(5)).toBeCloseTo(Rebirth.BASE_BONUS_PERCENT + 4 * Rebirth.BONUS_PERCENT_STEP);
    });

    test('holds at MAX_BONUS_PERCENT once reached, never exceeds it', () => {
        const rebirthAtCap = Math.round((Rebirth.MAX_BONUS_PERCENT - Rebirth.BASE_BONUS_PERCENT) / Rebirth.BONUS_PERCENT_STEP) + 1;
        expect(getRebirthBonusPercent(rebirthAtCap)).toBeCloseTo(Rebirth.MAX_BONUS_PERCENT);
        expect(getRebirthBonusPercent(rebirthAtCap + 10)).toBeCloseTo(Rebirth.MAX_BONUS_PERCENT);
    });
});

describe('previewRebirthBonus', () => {
    test('rebirth #1 grants 5% of the current total on each track (605 / 660,010,000 / 104,000,100,000)', () => {
        const preview = previewRebirthBonus(maxedUser());
        expect(preview.rebirthNumber).toBe(1);
        expect(preview.effectivePercent).toBeCloseTo(0.05);
        expect(preview.workMultiplierGain).toBeCloseTo(30.25);
        expect(preview.passiveGain).toBe(33000500);
        expect(preview.bankCapacityGain).toBe(5200005000);
    });

    test('a later rebirth applies a bigger percent to a bigger total than rebirth #1', () => {
        const first = previewRebirthBonus(maxedUser({ rebirthCount: 0 }));
        const fifth = previewRebirthBonus(maxedUser({
            rebirthCount: 4,
            sweetPotatoBuffs: { workMultiplierAmount: 500, passiveAmount: 500000000, bankCapacity: 50000000000 }
        }));
        expect(fifth.basePercent).toBeGreaterThan(first.basePercent);
        expect(fifth.workMultiplierGain).toBeGreaterThan(first.workMultiplierGain);
    });

    test('an unequipped user (no companions field) gets the plain percent, no throw', () => {
        const user = maxedUser();
        delete user.companions;
        expect(() => previewRebirthBonus(user)).not.toThrow();
        expect(previewRebirthBonus(user).effectivePercent).toBeCloseTo(0.05);
    });

    test('Mochi active amplifies this rebirth\'s percent by +20%', () => {
        const user = maxedUser({
            companions: { owned: [{ id: 'mochi', level: 1 }], active: 'mochi', ownedCount: 1, mythicOwnedCount: 1 }
        });
        const preview = previewRebirthBonus(user);
        expect(preview.effectivePercent).toBeCloseTo(0.06);
        expect(preview.workMultiplierGain).toBeCloseTo(36.3);
        expect(preview.passiveGain).toBe(39600600);
        expect(preview.bankCapacityGain).toBe(6240006000);
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

    test('resets each grindable stat to its base default plus the (bonus-augmented) sweetPotatoBuffs — not to zero, and not left at its pre-rebirth value', () => {
        const user = maxedUser();
        const result = computeRebirthState(user);

        // base default 1 (work) / 0 (passive) / 0 (bank), plus old buff plus this
        // rebirth's percent-of-current-total gain — never the old maxed total, never zero.
        expect(result.workMultiplierAmount).toBeCloseTo(1 + 5 + 30.25);
        expect(result.passiveAmount).toBe(0 + 10000 + 33000500);
        expect(result.bankCapacity).toBe(0 + 100000 + 5200005000);
        expect(result.maxStarches).toBe(25000);
    });

    test('sweetPotatoBuffs carries forward and gains the percent-of-current-total bonus, rather than resetting', () => {
        const user = maxedUser();
        const result = computeRebirthState(user);
        expect(result.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(5 + 30.25);
        expect(result.sweetPotatoBuffs.passiveAmount).toBe(10000 + 33000500);
        expect(result.sweetPotatoBuffs.bankCapacity).toBe(100000 + 5200005000);
    });

    test('agrees exactly with previewRebirthBonus\'s prediction for the same input', () => {
        const user = maxedUser({ rebirthCount: 3 });
        const preview = previewRebirthBonus(user);
        const result = computeRebirthState(user);
        expect(result.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(user.sweetPotatoBuffs.workMultiplierAmount + preview.workMultiplierGain);
        expect(result.sweetPotatoBuffs.passiveAmount).toBe(user.sweetPotatoBuffs.passiveAmount + preview.passiveGain);
        expect(result.sweetPotatoBuffs.bankCapacity).toBe(user.sweetPotatoBuffs.bankCapacity + preview.bankCapacityGain);
        expect(result.rebirthCount).toBe(preview.rebirthNumber);
    });

    test('increments rebirthCount from whatever it already was, defaulting a missing/undefined count to 0 first', () => {
        expect(computeRebirthState(maxedUser({ rebirthCount: 4 })).rebirthCount).toBe(5);
        expect(computeRebirthState(maxedUser({ rebirthCount: undefined })).rebirthCount).toBe(1);
    });

    test('two consecutive rebirths grow both the percent AND the absolute gain — not a repeat of the same value', () => {
        const afterFirst = computeRebirthState(maxedUser());
        const secondInput = maxedUser({
            sweetPotatoBuffs: afterFirst.sweetPotatoBuffs,
            rebirthCount: afterFirst.rebirthCount,
        });
        const secondPreview = previewRebirthBonus(secondInput);
        const afterSecond = computeRebirthState(secondInput);

        expect(secondPreview.effectivePercent).toBeCloseTo(0.145); // rebirth #2
        expect(afterSecond.sweetPotatoBuffs.workMultiplierAmount).toBeGreaterThan(afterFirst.sweetPotatoBuffs.workMultiplierAmount);
        expect(afterSecond.sweetPotatoBuffs.workMultiplierAmount - afterFirst.sweetPotatoBuffs.workMultiplierAmount)
            .not.toBeCloseTo(afterFirst.sweetPotatoBuffs.workMultiplierAmount - 5); // second gain != first gain
        expect(afterSecond.rebirthCount).toBe(2);
    });

    test('Mochi active at rebirth amplifies the computed bonus by +20%', () => {
        const user = maxedUser({
            companions: { owned: [{ id: 'mochi', level: 1 }], active: 'mochi', ownedCount: 1, mythicOwnedCount: 1 }
        });
        const result = computeRebirthState(user);
        expect(result.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(5 + 36.3);
        expect(result.sweetPotatoBuffs.passiveAmount).toBe(10000 + 39600600);
        expect(result.sweetPotatoBuffs.bankCapacity).toBe(100000 + 6240006000);
    });

    test('no companion equipped applies the plain, unamplified bonus', () => {
        const user = maxedUser({ companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 } });
        const result = computeRebirthState(user);
        expect(result.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(5 + 30.25);
    });
});
