// Cooldown-skip overhaul (2026-09-05, direct instruction) — same conversion as
// takeBountyCooldownSkip.test.js, applied to /rob-npc: Mercenary Rank's
// cooldownReductionPercent and Spud Keep's holder-wide perk are now a single combined
// chance to skip npcRobTimer entirely, auto-chaining another attempt on a hit. Per explicit
// follow-up instruction ("on a loss there is no cooldown skip and no auto trigger"), neither
// source is even rolled on a loss/whiff.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { RobNpc } = require('../../../utils/constants');
const { callback } = require('../robNpc');

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
        potatoes: 1000,
        totalEarnings: 1000,
        totalLosses: 0,
        starches: 0,
        isMercenary: true,
        mercenaryBountyWinCount: 0,
        mercenaryHeistWinCount: 0,
        mercenaryNotoriety: 0,
        npcRobTimer: 0,
        workMultiplierAmount: 90,
        passiveAmount: 100000,
        bankCapacity: 1000000,
        guildId: 0,
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
    dynamoHandler.getActiveSpudKeepBuff.mockResolvedValue(undefined);
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined); // no live holder
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/rob-npc cooldown skip', () => {
    test('a whiff never rolls a skip at all — full cooldown, no chain, Spud Keep not even queried', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15 })); // Rank 2
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValueOnce(0.999999); // win check fails (Tier I is whiff-only, no penalty roll)
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        expect(dynamoHandler.getActiveSpudKeepCooldownBuff).not.toHaveBeenCalled();
        const heistWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'npcRobTimer' in setAttrs);
        expect(heistWrites).toHaveLength(1); // no chain
        expect(heistWrites[0][1].npcRobTimer).toBeGreaterThanOrEqual(Date.now() - 100);
    });

    test('a win with the skip roll missing gets the FULL cooldown, no chain', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15 })); // Rank 2, cooldownReductionPercent 0.06
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // reward multiplier rangeRoll
            .mockReturnValueOnce(0.99); // skip roll miss (>= 0.06)
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const heistWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'npcRobTimer' in setAttrs);
        expect(heistWrites).toHaveLength(1);
        expect(heistWrites[0][1].npcRobTimer).toBeGreaterThanOrEqual(Date.now() - 100);

        // 2026-09-05, player-reported: a miss should still show the % chance that was
        // actually rolled, not leave the player wondering.
        const resultEmbed = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].embeds[0];
        const cooldownField = resultEmbed.data.fields.find(f => f.name.includes('Cooldown Skip Chance'));
        expect(cooldownField).toBeDefined();
        expect(cooldownField.value).toContain('6%');
    });

    test('a win with the skip roll hitting clears the cooldown to ready-now and auto-chains one more attempt', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15 })); // Rank 2, cooldownReductionPercent 0.06
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // reward multiplier rangeRoll
            .mockReturnValueOnce(0)    // skip roll HIT (< 0.06)
            .mockReturnValueOnce(0.5)  // pickSkipSource attribution (only mercenaryRank active)
            // Chained attempt (isChainedReply=true) resolves as a whiff, ending the chain there:
            .mockReturnValueOnce(0.999999); // win check fails
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const heistWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'npcRobTimer' in setAttrs);
        expect(heistWrites).toHaveLength(2);
        expect(heistWrites[0][1].npcRobTimer).toBeLessThanOrEqual(Date.now() - RobNpc.NPC_ROB_TIMER_SECONDS * 1000 + 100);
        expect(heistWrites[1][1].npcRobTimer).toBeGreaterThanOrEqual(Date.now() - 100);
        expect(interaction.followUp).toHaveBeenCalled();
    });
});
