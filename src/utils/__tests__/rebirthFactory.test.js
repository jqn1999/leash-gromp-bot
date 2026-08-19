const { checkRebirthEligibility, computeRebirthState } = require('../rebirthFactory');
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
        // rebirth's flat bonus — never the old maxed total, never zero.
        expect(result.workMultiplierAmount).toBe(1 + 5 + Rebirth.WORK_MULTI_BONUS);
        expect(result.passiveAmount).toBe(0 + 10000 + Rebirth.PASSIVE_BONUS);
        expect(result.bankCapacity).toBe(0 + 100000 + Rebirth.BANK_CAPACITY_BONUS);
        expect(result.maxStarches).toBe(25000);
    });

    test('sweetPotatoBuffs carries forward and gains the flat rebirth bonus, rather than resetting', () => {
        const user = maxedUser();
        const result = computeRebirthState(user);
        expect(result.sweetPotatoBuffs).toEqual({
            workMultiplierAmount: 5 + Rebirth.WORK_MULTI_BONUS,
            passiveAmount: 10000 + Rebirth.PASSIVE_BONUS,
            bankCapacity: 100000 + Rebirth.BANK_CAPACITY_BONUS
        });
    });

    test('increments rebirthCount from whatever it already was, defaulting a missing/undefined count to 0 first', () => {
        expect(computeRebirthState(maxedUser({ rebirthCount: 4 })).rebirthCount).toBe(5);
        expect(computeRebirthState(maxedUser({ rebirthCount: undefined })).rebirthCount).toBe(1);
    });

    test('two consecutive rebirths stack the bonus additively, not just repeat the same value', () => {
        const afterFirst = computeRebirthState(maxedUser());
        const secondInput = maxedUser({
            sweetPotatoBuffs: afterFirst.sweetPotatoBuffs,
            rebirthCount: afterFirst.rebirthCount,
        });
        const afterSecond = computeRebirthState(secondInput);

        expect(afterSecond.sweetPotatoBuffs.workMultiplierAmount).toBe(afterFirst.sweetPotatoBuffs.workMultiplierAmount + Rebirth.WORK_MULTI_BONUS);
        expect(afterSecond.rebirthCount).toBe(2);
    });
});
