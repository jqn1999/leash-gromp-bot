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
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
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
        expect(potatoWrite[1].potatoes).toBe(user.potatoes - Bounty.STAT_BOUNTY_COST);
        expect(potatoWrite[1].totalLosses).toBe(user.totalLosses - Bounty.STAT_BOUNTY_COST);

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
        expect(statGrantWrite[1].workMultiplierAmount).toBeCloseTo(user.workMultiplierAmount + Bounty.STAT_BOUNTY_REWARD);
        expect(statGrantWrite[1].sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(Bounty.STAT_BOUNTY_REWARD);

        const resultEmbed = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].embeds[0];
        expect(resultEmbed.data.title).toContain('Stat Bounty');
        expect(resultEmbed.data.description).toBe('Success!');
    });

    test('a loss charges the cost but grants no stat and does not increment the win counter', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0);       // flavor index
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const potatoWrite = dynamoHandler.updateUserFields.mock.calls.find(([, setAttrs]) => 'potatoes' in setAttrs);
        expect(potatoWrite).toBeDefined();
        expect(potatoWrite[1].potatoes).toBe(user.potatoes - Bounty.STAT_BOUNTY_COST);

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
        // Only 2 Math.random calls provided (win check + flavor index) — if a skip roll were
        // attempted on this loss, a 3rd call would be needed and the mock would return
        // undefined, which Math.random consumers here would coerce oddly; instead we assert
        // no crash AND that bountyTimer was set to "now" (full cooldown), not backdated.
        const randomSpy = jest.spyOn(Math, 'random')
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
        const user = baseUser({ mercenaryBountyWinCount: 525, potatoes: 10_000_000 });
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'stat' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check succeeds
            .mockReturnValueOnce(0)    // flavor index
            .mockReturnValueOnce(0)    // skip roll HIT
            .mockReturnValueOnce(0.5)  // pickSkipSource attribution
            // Chained attempt (isChainedReply=true) resolves as a LOSS, ending the chain there:
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0);       // flavor index
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const bountyTimerWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => setAttrs && 'bountyTimer' in setAttrs);
        expect(bountyTimerWrites).toHaveLength(2); // first hit + one chained attempt
        expect(bountyTimerWrites[0][1].bountyTimer).toBeLessThanOrEqual(Date.now() - Bounty.BOUNTY_TIMER_SECONDS * 1000 + 100);
        expect(bountyTimerWrites[1][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
    });
});
