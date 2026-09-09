// Cooldown-skip overhaul (2026-09-05, direct instruction) — Mercenary Rank's
// cooldownReductionPercent and Spud Keep's holder-wide perk used to deterministically shave
// Bounty's cooldown; both are now a single combined chance to skip the cooldown entirely,
// auto-chaining another attempt on a hit (mirrors /work's workCooldownSkipChance pattern).
// Per explicit follow-up instruction ("on a loss there is no cooldown skip and no auto
// trigger"), NEITHER source is even rolled on a loss — a loss always resets the full
// Bounty.BOUNTY_TIMER_SECONDS. Same "mock at the boundary this command actually touches"
// approach takeBountyTax.test.js already uses — spudKeepFactory/mercenaryFactory are left
// real, only dynamoHandler is mocked.
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
        potatoes: 1000,
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

describe('/take-bounty cooldown skip', () => {
    test('a loss never rolls a skip at all — full cooldown, no chain, Spud Keep not even queried', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15, workMultiplierAmount: 0.1 })); // Rank 2, near-zero success chance
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // scenario index
            .mockReturnValueOnce(0);       // penalty rangeRoll
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        expect(dynamoHandler.getActiveSpudKeepCooldownBuff).not.toHaveBeenCalled();
        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(1); // no chain
        expect(bountyWrites[0][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
    });

    test('a win with the skip roll missing gets the FULL cooldown, no chain', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15 })); // Rank 2, cooldownReductionPercent 0.06
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99) // yukon miss
            .mockReturnValueOnce(0.99); // skip roll miss (>= 0.06)
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(1); // no chain
        expect(bountyWrites[0][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);

        // 2026-09-05, player-reported: a miss should still show the % chance that was
        // actually rolled, not leave the player wondering.
        const resultEmbed = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].embeds[0];
        const cooldownField = resultEmbed.data.fields.find(f => f.name.includes('Cooldown Skip Chance'));
        expect(cooldownField).toBeDefined();
        expect(cooldownField.value).toContain('6%');
    });

    test('a win with the skip roll hitting clears the cooldown to ready-now and auto-chains one more attempt', async () => {
        const user = baseUser({ mercenaryBountyWinCount: 15 }); // Rank 2, cooldownReductionPercent 0.06
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99) // yukon miss
            .mockReturnValueOnce(0)    // skip roll HIT (< 0.06)
            .mockReturnValueOnce(0.5)  // pickSkipSource attribution (only mercenaryRank active -> irrelevant value)
            // Chained attempt (isChainedReply=true) resolves as a LOSS, ending the chain there:
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // scenario index
            .mockReturnValueOnce(0);       // penalty rangeRoll
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Two full resolutions happened — two separate bounty writes (first + chained).
        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(2);

        // First resolution: bountyTimer backdated the FULL cooldown (ready immediately).
        expect(bountyWrites[0][1].bountyTimer).toBeLessThanOrEqual(Date.now() - Bounty.BOUNTY_TIMER_SECONDS * 1000 + 100);
        // Chained (loss) resolution: full cooldown again, no further chaining.
        expect(bountyWrites[1][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
    });

    // Mercenary Buff's bountyTimer category (systems/mercenary-bounties.md#mercenary-buff) —
    // a 3rd skip-chance source alongside mercenaryRank/spudKeep. Rank 1 has a 0%
    // cooldownReductionPercent and Spud Keep is mocked un-held, so this isolates the new
    // source cleanly: only mercenaryBuff (3% at Rank 1) can possibly win the roll or the
    // attribution here.
    test('the new mercenaryBuff source participates in the combined roll and gets correctly attributed on a win', async () => {
        const user = baseUser({ mercenaryBountyWinCount: 0, mercenaryBuff: 'bountyTimer' }); // Rank 1, cooldownReductionPercent 0
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99) // yukon miss
            .mockReturnValueOnce(0)    // skip roll HIT (< 0.03, only mercenaryBuff is active)
            .mockReturnValueOnce(0.5)  // pickSkipSource attribution — only mercenaryBuff active, so any value picks it
            // Chained attempt (isChainedReply=true) resolves as a LOSS, ending the chain there:
            .mockReturnValueOnce(0.999999)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(2); // hit + one chained attempt
        expect(bountyWrites[0][1].bountyTimer).toBeLessThanOrEqual(Date.now() - Bounty.BOUNTY_TIMER_SECONDS * 1000 + 100);

        const resultEmbed = interaction.editReply.mock.calls[0][0].embeds[0];
        const skipField = resultEmbed.data.fields.find(f => f.name.includes('Mercenary Buff'));
        expect(skipField).toBeDefined();
    });
});
