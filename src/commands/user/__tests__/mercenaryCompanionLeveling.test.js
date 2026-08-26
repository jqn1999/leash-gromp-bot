// Mercenary Companion Leveling (roadmap #59) — direct instruction: "work on merc companion
// and how it levels via Merc stuff now. Have it level during heists and bounties. Also
// account for the longer cooldown of bounties and heists and how much experience it
// should give the companion." Before this, a mercenary's equipped companion only leveled
// through /work or Scavenging; /take-bounty and /rob-npc granted nothing.
//
// The actual grant math (companionFactory.getCooldownScaledWorkCountGrant/
// levelActiveCompanion) is unit-tested directly in companionFactory.test.js — this file
// drives each real command callback end-to-end against a minimal mocked
// interaction/dynamoHandler (same "mock at the boundary this command actually touches"
// approach rivalNotorietyAccrual.test.js already uses) to lock in that both commands
// actually call it, unconditionally on win/loss, and compose correctly with Yukon's own
// same-turn companion write.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Bounty, RobNpc, Work, MercenaryRank, CompanionLeveling } = require('../../../utils/constants');

// Both cooldown-scaled AND pulled back by REALISTIC_PLAY_DISCOUNT (direct instruction:
// "instead of a pure 12x and 6x do 8x and 4x since people aren't generally perfectly
// working every 5 minutes anyway") — see companionFactory.getCooldownScaledWorkCountGrant.
const BOUNTY_GRANT = Math.max(1, Math.round((Bounty.BOUNTY_TIMER_SECONDS / Work.WORK_TIMER_SECONDS) * CompanionLeveling.REALISTIC_PLAY_DISCOUNT));
const HEIST_GRANT = Math.max(1, Math.round((RobNpc.NPC_ROB_TIMER_SECONDS / Work.WORK_TIMER_SECONDS) * CompanionLeveling.REALISTIC_PLAY_DISCOUNT));

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
        npcRobTimer: 0,
        workMultiplierAmount: 90, // comfortably clears Tier I's success cap
        passiveAmount: 100000,
        bankCapacity: 1000000,
        guildId: 0,
        companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 },
        achievements: [],
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateIfNewRecord.mockResolvedValue();
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/take-bounty levels the active companion, cooldown-scaled against /work, on win or loss', () => {
    const { callback } = require('../takeBounty');

    test('a win bumps the active companion by the Bounty-scaled grant', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ tier: 'I' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99); // yukon miss
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10 + BOUNTY_GRANT);
    });

    test('a loss still bumps the active companion by the same grant — unconditional on outcome', async () => {
        const user = baseUser({ workMultiplierAmount: 0.1 }); // near-zero success chance
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ tier: 'I' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // scenario index
            .mockReturnValueOnce(0);       // penalty rangeRoll
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10 + BOUNTY_GRANT);
    });

    test('does nothing to companions when nothing is equipped', async () => {
        const user = baseUser({ companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 } });
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ tier: 'I' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned).toEqual([]);
        expect(setAttributes.companions.active).toBeNull();
    });

    // Regression coverage for a real composition bug this feature had to avoid: Yukon's own
    // award write and the companion-leveling write both touch `companions`, which is always
    // a full SET, never a deep merge — writing them separately would let whichever lands
    // last silently erase the other. Both effects (leveled active instance + new Yukon
    // instance) must land in the SAME final companions object.
    test('a same-turn Yukon pull composes with the leveling bump instead of overwriting it', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ tier: 'I' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0);   // yukon HIT
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        // The pre-existing Sprout is still there, leveled...
        const sprout = setAttributes.companions.owned.find(c => c.id === 'sprout');
        expect(sprout.workCount).toBe(10 + BOUNTY_GRANT);
        // ...and a brand-new Yukon instance is ALSO present in that same write.
        const yukon = setAttributes.companions.owned.find(c => c.id === 'yukon');
        expect(yukon).toBeDefined();
        expect(yukon.workCount).toBe(0);
    });
});

describe('/rob-npc levels the active companion, cooldown-scaled against /work, on any outcome', () => {
    const { callback } = require('../robNpc');

    test('a win bumps the active companion by the Heist-scaled grant', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ 'heist-type': 'corner_store' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees a hit
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10 + HEIST_GRANT);
    });

    test('a whiff still bumps the active companion by the same grant — unconditional on outcome', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ 'heist-type': 'corner_store' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // guarantees a whiff
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10 + HEIST_GRANT);
    });

    // Every tier shares the same cooldown (RobNpc.NPC_ROB_TIMER_SECONDS) — the leveling
    // grant should be identical regardless of which tier was picked, matching the
    // time-investment framing (not a risk/tier-scaled reward).
    test('the grant is the same across every heist tier', async () => {
        for (const tier of RobNpc.TIERS) {
            const winsRequired = MercenaryRank.THRESHOLDS.find(t => t.rank === tier.rankRequired).winsRequired;
            const user = baseUser({ mercenaryBountyWinCount: winsRequired });
            dynamoHandler.findUser.mockResolvedValue(user);
            const interaction = fakeInteraction({ 'heist-type': tier.key });
            const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // guarantees a whiff/loss, no extra rolls to mock
            try {
                await callback({}, interaction);
            } finally {
                randomSpy.mockRestore();
            }

            const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
            expect(setAttributes.companions.owned[0].workCount).toBe(10 + HEIST_GRANT);
        }
    });

    test('does nothing to companions when nothing is equipped', async () => {
        const user = baseUser({ companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 } });
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ 'heist-type': 'corner_store' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned).toEqual([]);
        expect(setAttributes.companions.active).toBeNull();
    });
});
