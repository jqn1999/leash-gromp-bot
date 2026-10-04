// Stat Bounty (2026-09-10, direct instruction — "Add a stat bounty for mercs as an option
// in take bounty. It should be very similar to guild stat raids with 50% chance for .2
// multi and costing 300k"). Same "mock at the boundary this command actually touches"
// approach takeBountyCooldownSkip.test.js already uses — dynamoHandler is mocked,
// mercenaryFactory/raidFactory/companionFactory/cooldownFactory are left real.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Bounty } = require('../../../utils/constants');
const { callback } = require('../takeBounty');

const fakeClient = { user: { id: 'house-account' } };

function fakeInteraction(optionValues = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
        },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 1000000,
        totalEarnings: 1000,
        totalLosses: 0,
        starches: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        mercenaryNotoriety: 0,
        bountyTimer: 0,
        workMultiplierAmount: 90,
        passiveAmount: 100000,
        bankCapacity: 1000000,
        guildId: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        achievements: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateIfNewRecord.mockResolvedValue();
    dynamoHandler.addUserDatabase.mockResolvedValue();
    dynamoHandler.addStatFields.mockResolvedValue();
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined); // no live holder
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/take-bounty mode:stat', () => {
    test('insufficient potatoes rejects up front and makes no writes at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ potatoes: Bounty.STAT_BOUNTY_COST - 1 }));
        const interaction = fakeInteraction({ mode: 'stat' });

        await callback(fakeClient, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Stat Bounty costs'));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();
    });

    test('exactly enough potatoes is allowed through the affordability gate (boundary)', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ potatoes: Bounty.STAT_BOUNTY_COST }));
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.99)     // Metal Potato Meddley trigger MISS (>= 1% chance)
            .mockReturnValueOnce(0.999999) // win check fails (loss)
            .mockReturnValueOnce(0);       // flavor index
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        expect(dynamoHandler.updateUserFields).toHaveBeenCalled();
    });

    test('a win charges the cost, grants +0.2 workMultiplierAmount, updates sweetPotatoBuffs.workMultiplierAmount, and increments mercenaryBountyWinCount', async () => {
        const user = baseUser({ mercenaryBountyWinCount: 3 });
        // Captured BEFORE the call — the chain loop now mutates the SAME userDetails object
        // dynamoHandler.findUser resolved to (2026-10-03 chain write-count rewrite, needed so
        // later links of a chain see earlier links' own results), so `user` itself no longer
        // reflects its pre-call values once callback() returns.
        const originalPotatoes = user.potatoes;
        const originalTotalLosses = user.totalLosses;
        const originalWorkMultiplierAmount = user.workMultiplierAmount;
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.99) // Metal Potato Meddley trigger MISS
            .mockReturnValueOnce(0)    // win check succeeds (< 0.5)
            .mockReturnValueOnce(0)    // flavor index
            .mockReturnValueOnce(0.99); // cooldown skip roll miss (Rank 1 has 0% skip chance anyway)
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Cost charged (unconditionally) — the write that carries `potatoes`.
        const potatoWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => 'potatoes' in setAttrs);
        expect(potatoWrite).toBeDefined();
        expect(potatoWrite[1].potatoes).toBe(originalPotatoes - Bounty.STAT_BOUNTY_COST);
        expect(potatoWrite[1].totalLosses).toBe(originalTotalLosses - Bounty.STAT_BOUNTY_COST);

        // Win counter incremented via the atomic ADD path (addAttributes), same as every
        // other Bounty win.
        const winCountWrite = dynamoHandler.updateUserFields.mock.calls.find(([, , addAttrs]) => addAttrs && 'mercenaryBountyWinCount' in addAttrs);
        expect(winCountWrite).toBeDefined();
        expect(winCountWrite[2].mercenaryBountyWinCount).toBe(1);

        // The actual stat grant — reuses raidFactory.handleStatSplit, which re-reads the
        // user (mocked to the same object) and writes workMultiplierAmount +
        // sweetPotatoBuffs.workMultiplierAmount together.
        const statGrantWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'workMultiplierAmount' in setAttrs);
        expect(statGrantWrite).toBeDefined();
        expect(statGrantWrite[1].workMultiplierAmount).toBeCloseTo(originalWorkMultiplierAmount + Bounty.STAT_BOUNTY_REWARD);
        expect(statGrantWrite[1].sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(Bounty.STAT_BOUNTY_REWARD);

        const resultEmbed = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].embeds[0];
        expect(resultEmbed.data.title).toContain('Stat Bounty');
        expect(resultEmbed.data.description).toBe('Success!');
    });

    test('a loss charges the cost but grants no stat and does not increment the win counter', async () => {
        const user = baseUser();
        // Captured BEFORE the call — see the first test's own comment on why `user` can no
        // longer be read post-call for its pre-call value.
        const originalPotatoes = user.potatoes;
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.99)     // Metal Potato Meddley trigger MISS
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0);       // flavor index
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const potatoWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => 'potatoes' in setAttrs);
        expect(potatoWrite).toBeDefined();
        expect(potatoWrite[1].potatoes).toBe(originalPotatoes - Bounty.STAT_BOUNTY_COST);

        const winCountWrite = dynamoHandler.updateUserFields.mock.calls.find(([, , addAttrs]) => addAttrs && 'mercenaryBountyWinCount' in addAttrs);
        expect(winCountWrite).toBeUndefined();

        const statGrantWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'workMultiplierAmount' in setAttrs);
        expect(statGrantWrite).toBeUndefined();

        const resultEmbed = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].embeds[0];
        expect(resultEmbed.data.description).toBe('Failed.');
    });

    test('cooldown skip is only ever rolled on a win, never on a loss', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ mode: 'stat' });
        // Only 3 Math.random calls provided (Meddley trigger + win check + flavor index) — if
        // a skip roll were attempted on this loss, a 4th call would be needed and the mock
        // would return undefined, which Math.random consumers here would coerce oddly;
        // instead we assert no crash AND that bountyTimer was set to "now" (full cooldown),
        // not backdated.
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.99)     // Metal Potato Meddley trigger MISS
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0);       // flavor index
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const bountyTimerWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => setAttrs && 'bountyTimer' in setAttrs);
        expect(bountyTimerWrite).toBeDefined();
        expect(bountyTimerWrite[1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
        // No chained follow-up attempt happened (a skip would auto-chain another attempt).
        const bountyTimerWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => setAttrs && 'bountyTimer' in setAttrs);
        expect(bountyTimerWrites).toHaveLength(1);
    });

    test('a win with the skip roll hitting backdates the cooldown and auto-chains one more attempt', async () => {
        // Rank 6 (525 wins) has a real cooldownReductionPercent > 0 to actually roll against.
        // 2026-10-03 chain write-count rewrite: the whole 2-link chain now produces exactly
        // ONE dynamoHandler.updateUserFields call, carrying the FINAL link's own bountyTimer
        // (the chained attempt's loss resets it to a real full cooldown) — not one write per
        // link the way the pre-rewrite version produced.
        const user = baseUser({ mercenaryBountyWinCount: 525, potatoes: 10_000_000 });
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.99) // Metal Potato Meddley trigger MISS
            .mockReturnValueOnce(0)    // win check succeeds
            .mockReturnValueOnce(0)    // flavor index
            .mockReturnValueOnce(0)    // skip roll HIT
            .mockReturnValueOnce(0.5)  // pickSkipSource attribution
            // Chained link (isChainedReply=true) resolves as a LOSS, ending the chain there:
            .mockReturnValueOnce(0.99)     // Metal Potato Meddley trigger MISS
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0);       // flavor index
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const bountyTimerWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => setAttrs && 'bountyTimer' in setAttrs);
        expect(bountyTimerWrites).toHaveLength(1); // one write for the whole 2-link chain
        // The final (chained, loss) link's own full cooldown is what actually got written —
        // the first link's own backdated-to-ready-now value was only ever an in-memory
        // intermediate, overwritten the instant the chain's 2nd link resolved.
        expect(bountyTimerWrites[0][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
        // Two full resolutions still happened — one editReply (link 1) and one followUp
        // (the chained link), matching the message-sequence the old per-link-write version
        // produced.
        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.followUp).toHaveBeenCalled();
    });

    // Metal Potato Meddley for Stat Bounty (2026-10-03, direct instruction) — same flat 1%
    // roll as the regular ladder's own Meddley, reusing Bounty's own Band I numbers doubled
    // and Guild Stat Raid's own power-ratio-capped-at-50% success formula. See
    // mercenaryFactory.resolveStatBounty's own comment for the full mechanic.
    test('a Meddley hit costs nothing, pays doubled Band I potatoes, and grants all three permanent stats', async () => {
        const user = baseUser({ workMultiplierAmount: 90 }); // successChance = 90/900 = .1 (difficulty rescaled to 45% for solo play)
        const originalPotatoes = user.potatoes;
        const originalTotalEarnings = user.totalEarnings;
        const originalWorkMultiplierAmount = user.workMultiplierAmount;
        const originalPassiveAmount = user.passiveAmount;
        const originalBankCapacity = user.bankCapacity;
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.005) // Metal Potato Meddley trigger HIT (< 1%)
            .mockReturnValueOnce(0)     // win check: .045 > 0 -> win
            .mockReturnValueOnce(0.5)   // reward rangeRoll -> 1.0
            .mockReturnValueOnce(0.99); // cooldown skip roll miss (Rank 1 has 0% skip chance anyway)
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Exactly one of these writes carries the chain's own aggregated result — a second
        // write (achievements, e.g. first_million) can legitimately follow from
        // achievementFactory.checkAndUnlock, left real (not mocked) in this file.
        const [, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls.find(([, s]) => 'potatoes' in s);

        // Costs nothing — potatoes only move by the reward, never STAT_BOUNTY_COST.
        const expectedReward = Math.round(4500000 * 2 * 1.0 * 1.00); // Band I reward (rescaled) doubled, rank 1 -> 1.00x
        expect(setFields.potatoes).toBe(originalPotatoes + expectedReward);
        expect(setFields.totalEarnings).toBe(originalTotalEarnings + expectedReward);
        expect(setFields.totalLosses).toBe(0);
        expect(addFields.mercenaryBountyWinCount).toBe(1);

        // All three permanent stat grants, doubled — not just workMultiplierAmount.
        expect(setFields.workMultiplierAmount).toBeCloseTo(originalWorkMultiplierAmount + 4.0);
        expect(setFields.passiveAmount).toBe(originalPassiveAmount + 2000000);
        expect(setFields.bankCapacity).toBe(originalBankCapacity + 20000000);
        expect(setFields.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(4.0);
        expect(setFields.sweetPotatoBuffs.passiveAmount).toBe(2000000);
        expect(setFields.sweetPotatoBuffs.bankCapacity).toBe(20000000);

        const resultEmbed = interaction.editReply.mock.calls[0][0].embeds[0];
        expect(resultEmbed.data.title).toContain('Metal Potato Meddley');
        expect(resultEmbed.data.description).toBe('Success!');
        const potatoesField = resultEmbed.data.fields.find(f => f.name === 'Potatoes Gained:');
        expect(potatoesField).toBeDefined();
        expect(potatoesField.value).toContain(expectedReward.toLocaleString());
        const costField = resultEmbed.data.fields.find(f => f.name === 'Potatoes Spent:');
        expect(costField.value).toContain('Nothing');
    });

    test('a Meddley loss costs nothing at all, overriding the normal STAT_BOUNTY_COST charge', async () => {
        const user = baseUser({ workMultiplierAmount: 90 });
        const originalPotatoes = user.potatoes;
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.005)     // Metal Potato Meddley trigger HIT
            .mockReturnValueOnce(0.999999); // win check fails
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields.potatoes).toBe(originalPotatoes); // unchanged — costs nothing
        expect(setFields.totalLosses).toBe(0);
        expect(addFields).not.toHaveProperty('mercenaryBountyWinCount');
        expect(setFields).not.toHaveProperty('workMultiplierAmount');

        const resultEmbed = interaction.editReply.mock.calls[0][0].embeds[0];
        expect(resultEmbed.data.description).toBe('Failed.');
    });
});
