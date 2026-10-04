// Cooldown-skip overhaul (2026-09-05, direct instruction) — same conversion as
// takeBountyCooldownSkip.test.js, applied to /rob-npc: Mercenary Rank's
// cooldownReductionPercent and Spud Keep's holder-wide perk are now a single combined
// chance to skip npcRobTimer entirely, auto-chaining another attempt on a hit. Per explicit
// follow-up instruction ("on a loss there is no cooldown skip and no auto trigger"), neither
// source is even rolled on a loss/whiff.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { RobNpc, Work } = require('../../../utils/constants');
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
        // Reward-roll-coupled risk (2026-09-09) — the reward roll is now Math.random()'s
        // FIRST call (it nudges this attempt's own odds before the win check runs), so both
        // need mocking now to force a deterministic whiff (Tier I is whiff-only, no penalty roll).
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0.5)        // reward roll -> midpoint, zero spread adjustment
            .mockReturnValueOnce(0.999999);  // win check fails
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
            .mockReturnValueOnce(0)    // reward roll -> .8x (also doubles as the reward variance roll)
            .mockReturnValueOnce(0)    // win check -> hit
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
        // 2026-10-03 chain write-count rewrite: the whole 2-link chain now produces exactly
        // ONE dynamoHandler.updateUserFields call, carrying the FINAL (chained, whiff) link's
        // own full cooldown — not one write per link the way the pre-rewrite recursive
        // version produced.
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15 })); // Rank 2, cooldownReductionPercent 0.06
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });
        const randomSpy = jest.spyOn(Math, 'random')
            .mockReturnValueOnce(0)    // reward roll -> .8x (also doubles as the reward variance roll)
            .mockReturnValueOnce(0)    // win check -> hit
            .mockReturnValueOnce(0)    // skip roll HIT (< 0.06)
            .mockReturnValueOnce(0.5)  // pickSkipSource attribution (only mercenaryRank active)
            // Chained link (isChainedReply=true) resolves as a whiff, ending the chain there —
            // needs its OWN reward roll (first call again) before its own win check now.
            .mockReturnValueOnce(0.5)       // chained link's reward roll -> midpoint
            .mockReturnValueOnce(0.999999); // chained link's win check fails
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const heistWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'npcRobTimer' in setAttrs);
        expect(heistWrites).toHaveLength(1);
        expect(heistWrites[0][1].npcRobTimer).toBeGreaterThanOrEqual(Date.now() - 100);
        expect(interaction.followUp).toHaveBeenCalled();
    });

    // Chain-cap-hit-on-its-own-skip fix (2026-10-03, direct instruction — see
    // takeBountyCooldownSkip.test.js's identical test for the full writeup; same bug, same
    // fix, this is /rob-npc's own copy). Before this fix, a skip roll landing on the call
    // that hits the chain cap left npcRobTimer at "ready now" with no further auto-chain —
    // a free extra Heist via a manual re-run.
    test('a skip roll hitting on every single link all the way to the chain cap overwrites npcRobTimer to a real cooldown instead of leaving it ready-now', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ mercenaryBountyWinCount: 15 })); // Rank 2, cooldownReductionPercent 0.06
        const interaction = fakeInteraction({ 'heist-type': 'market_stall' });

        // One win-and-skip-hit resolution: reward roll(0), win check(0), skip roll HIT(0),
        // pickSkipSource(.5) — the same 4-value sequence the "skip roll hitting" test above
        // uses for its own first (hit) resolution.
        const perHitRoll = [0, 0, 0, 0.5];
        const totalLinks = Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH + 1;
        const allRolls = Array(totalLinks).fill(perHitRoll).flat();
        const randomSpy = jest.spyOn(Math, 'random');
        allRolls.forEach(v => randomSpy.mockReturnValueOnce(v));
        try {
            await callback({}, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // 2026-10-03 chain write-count rewrite — the whole capped chain (totalLinks real
        // resolutions) now produces exactly ONE write, carrying the chain-cap fix's own
        // real full cooldown (not backdated) rather than a separate overwrite write.
        const heistWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'npcRobTimer' in setAttrs);
        expect(heistWrites).toHaveLength(1);
        const finalWrite = heistWrites[0][1];
        expect(finalWrite.npcRobTimer).toBeGreaterThanOrEqual(Date.now() - 100);

        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.followUp.mock.calls.length).toBeGreaterThanOrEqual(totalLinks - 1);
    });
});
