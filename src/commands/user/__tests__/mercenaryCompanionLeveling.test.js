// Mercenary Companion Leveling (roadmap #59) — direct instruction: "work on merc companion
// and how it levels via Merc stuff now. Have it level during heists and bounties. Also
// account for the longer cooldown of bounties and heists and how much experience it
// should give the companion." Before this, a mercenary's equipped companion only leveled
// through /work or Scavenging; /take-bounty and /rob-npc granted nothing.
//
// Same-day follow-up, direct instruction: "Can we make it only yukon specific" (after
// confirming the first version leveled whichever companion happened to be equipped) — so
// these two commands now only level Yukon specifically; any other equipped companion is a
// no-op through them (still levels normally through /work or Scavenging as always).
//
// The actual grant math (companionFactory.getCooldownScaledWorkCountGrant/
// levelActiveCompanion, including the restrictToCompanionId gate) is unit-tested directly
// in companionFactory.test.js — this file drives each real command callback end-to-end
// against a minimal mocked interaction/dynamoHandler (same "mock at the boundary this
// command actually touches" approach rivalNotorietyAccrual.test.js already uses) to lock
// in that both commands actually call it correctly, unconditionally on win/loss, restricted
// to Yukon, and composing correctly with Yukon's own same-turn companion-award write.
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
        // Yukon equipped by default — the one companion these two commands actually level.
        companions: { owned: [{ instanceId: 'yukon-a', id: 'yukon', workCount: 10 }], active: 'yukon-a', ownedCount: 1, mythicOwnedCount: 1 },
        achievements: [],
        ...overrides,
    };
}

function sproutUser(overrides = {}) {
    return baseUser({
        companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 10 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 },
        ...overrides,
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateIfNewRecord.mockResolvedValue();
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1000000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
});

describe('/take-bounty levels an equipped Yukon, cooldown-scaled against /work, on win or loss', () => {
    const { callback } = require('../takeBounty');
    // A win now runs the new Bounty.WIN_TAX_PERCENT tax path, which credits the house
    // account via client.user.id — needs a real client fixture, not {}.
    const fakeClient = { user: { id: 'house-account' } };

    test('a win bumps Yukon by the Bounty-scaled grant', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0.99); // yukon miss (already owned/equipped — this is the drop roll, not the leveling)
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10 + BOUNTY_GRANT);
    });

    test('a loss still bumps Yukon by the same grant — unconditional on outcome', async () => {
        const user = baseUser({ workMultiplierAmount: 0.1 }); // near-zero success chance
        dynamoHandler.findUser.mockResolvedValue(user);
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

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10 + BOUNTY_GRANT);
    });

    // The actual point of the follow-up instruction: any OTHER equipped companion is a
    // no-op through this command now, even though it still levels normally through /work.
    test('a non-Yukon equipped companion does not level at all', async () => {
        const user = sproutUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0.99)
            .mockReturnValueOnce(0.99);
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10);
    });

    test('does nothing to companions when nothing is equipped', async () => {
        const user = baseUser({ companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 } });
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.999999)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);
        try {
            await callback(fakeClient, interaction);
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
    // last silently erase the other. Both effects (leveled active Yukon + a brand-new
    // second Yukon instance from the drop roll) must land in the SAME final companions
    // object.
    test('a same-turn duplicate Yukon pull composes with the leveling bump instead of overwriting it', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // win check
            .mockReturnValueOnce(0)    // scenario index
            .mockReturnValueOnce(0)    // reward rangeRoll
            .mockReturnValueOnce(0.99) // stat-reward miss
            .mockReturnValueOnce(0);   // yukon HIT (duplicate — already owned)
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        // The original, equipped Yukon is still there, leveled...
        expect(setAttributes.companions.owned).toHaveLength(2);
        const equippedYukon = setAttributes.companions.owned.find(c => c.instanceId === 'yukon-a');
        expect(equippedYukon.workCount).toBe(10 + BOUNTY_GRANT);
        // ...and a brand-new second Yukon instance is ALSO present in that same write.
        const newYukon = setAttributes.companions.owned.find(c => c.instanceId !== 'yukon-a');
        expect(newYukon).toBeDefined();
        expect(newYukon.workCount).toBe(0);
    });
});

describe('/rob-npc levels an equipped Yukon, cooldown-scaled against /work, on any outcome', () => {
    const { callback } = require('../robNpc');

    test('a win bumps Yukon by the Heist-scaled grant', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees a hit
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10 + HEIST_GRANT);
    });

    test('a whiff still bumps Yukon by the same grant — unconditional on outcome', async () => {
        const user = baseUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // guarantees a whiff
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10 + HEIST_GRANT);
    });

    test('a non-Yukon equipped companion does not level at all', async () => {
        const user = sproutUser();
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const [, setAttributes] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setAttributes.companions.owned[0].workCount).toBe(10);
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
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
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
