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
const { Bounty, Work } = require('../../../utils/constants');
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
        // 2026-10-03 chain write-count rewrite: the whole 2-link chain now produces exactly
        // ONE dynamoHandler.updateUserFields call for this player's own record, carrying
        // the FINAL link's own bountyTimer — not one write per link the way the pre-rewrite
        // recursive version produced.
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
            // Chained link (isChainedReply=true) resolves as a LOSS, ending the chain there:
            .mockReturnValueOnce(0.999999) // win check fails
            .mockReturnValueOnce(0)        // scenario index
            .mockReturnValueOnce(0);       // penalty rangeRoll
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(1); // one write for the whole 2-link chain

        // The final (chained, loss) link's own full cooldown is what actually got written —
        // the first link's own backdated-to-ready-now value was only ever an in-memory
        // intermediate, overwritten the instant the chain's 2nd link resolved.
        expect(bountyWrites[0][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
        // Two full resolutions still happened — one editReply (link 1) and at least one
        // followUp (the chained link's own result; achievementFactory/questFactory are left
        // real in this file, so a genuine first-win unlock can add further followUps on top
        // — not asserted exactly here, that's achievements.md's own test surface).
        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.followUp).toHaveBeenCalled();
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

        // 2026-10-03 chain write-count rewrite — one write for the whole 2-link chain now,
        // carrying the final (chained, loss) link's own full cooldown.
        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(1);
        expect(bountyWrites[0][1].bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);

        const resultEmbed = interaction.editReply.mock.calls[0][0].embeds[0];
        const skipField = resultEmbed.data.fields.find(f => f.name.includes('Mercenary Buff'));
        expect(skipField).toBeDefined();
    });

    // Chain-cap-hit-on-its-own-skip fix (2026-10-03, direct instruction: "if it chains 5
    // times even if the last one says it skips again and doesn't auto trigger, it should
    // actually set the work cooldown to the usual 5 minutes instead of letting them use the
    // command again") — resolveBountyCooldownSkip backdates bountyTimer to "ready now" the
    // instant a skip roll hits, with zero awareness of chainDepth; only runBountyAttempt's
    // OWN post-resolution check knows the cap was reached. Before this fix, a skip roll
    // landing on the very call that hits the cap left bountyTimer at "ready now" even though
    // no further auto-chain happened — a free extra attempt via a manual re-run. Rolls a HIT
    // on every single link through the cap, so the chain's LAST call is itself a hit that
    // gets capped rather than terminating some other way (a miss/loss), isolating this exact
    // bug from the already-covered "the chain just happens to end in a loss" case above.
    test('a skip roll hitting on every single link all the way to the chain cap overwrites bountyTimer to a real cooldown instead of leaving it ready-now', async () => {
        const user = baseUser({ mercenaryBountyWinCount: 15 }); // Rank 2, cooldownReductionPercent 0.06
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });

        // One win-and-skip-hit resolution: win check(0), scenario index(0), reward
        // rangeRoll(0), stat-reward miss(.99), yukon miss(.99), skip roll HIT(0),
        // pickSkipSource(.5) — the exact same 7-value sequence the "skip roll hitting"
        // test above uses for its own first (hit) resolution. Repeated once per link,
        // MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH + 1 times total (chainDepth runs
        // 0..5 inclusive before the cap check at chainDepth===5 stops it).
        const perHitRoll = [0, 0, 0, 0.99, 0.99, 0, 0.5];
        const totalLinks = Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH + 1;
        const allRolls = Array(totalLinks).fill(perHitRoll).flat();
        const randomSpy = jest.spyOn(Math, 'random');
        allRolls.forEach(v => randomSpy.mockReturnValueOnce(v));
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // 2026-10-03 chain write-count rewrite — the whole capped chain (totalLinks real
        // resolutions) now produces exactly ONE write, carrying the chain-cap fix's own
        // real full cooldown (not backdated) rather than a separate overwrite write.
        const bountyWrites = dynamoHandler.updateUserFields.mock.calls.filter(([, setAttrs]) => 'bountyTimer' in setAttrs);
        expect(bountyWrites).toHaveLength(1);
        const finalWrite = bountyWrites[0][1];
        expect(finalWrite.bountyTimer).toBeGreaterThanOrEqual(Date.now() - 100);
        expect(finalWrite.bountyTimer).toBeLessThan(Date.now() - Bounty.BOUNTY_TIMER_SECONDS * 1000 + 100 + Bounty.BOUNTY_TIMER_SECONDS * 1000);

        // Every link but the LAST one still genuinely said "skipped!" on its own result
        // embed — only the final persisted cooldown value changed there, not the per-link
        // narration. The very last link's own embed is covered by its own dedicated test
        // below (2026-10-04) instead, since it no longer says "skipped!" at all. At least
        // totalLinks-1 followUps (the chained links' own results) — not asserted exactly,
        // since achievementFactory/questFactory are left real here and a genuine unlock
        // can add further followUps on top.
        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.followUp.mock.calls.length).toBeGreaterThanOrEqual(totalLinks - 1);
    });

    // 2026-10-04, direct instruction: "make sure the skip text says something about how
    // they reached the max amount of skips, timer not reduced" — same fix as /work's own
    // copy (workCooldownSkipChainCap.test.js). Reuses the exact same roll sequence as the
    // test just above (a hit on every link through the cap), checking the FINAL link's
    // own embed content instead of the write/call-count side effects.
    test('the final capped link\'s own embed explicitly says the chain cap was hit and the cooldown was not reduced', async () => {
        const user = baseUser({ mercenaryBountyWinCount: 15 });
        dynamoHandler.findUser.mockResolvedValue(user);
        const interaction = fakeInteraction({ mode: 'baby' });

        const perHitRoll = [0, 0, 0, 0.99, 0.99, 0, 0.5];
        const totalLinks = Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH + 1;
        const allRolls = Array(totalLinks).fill(perHitRoll).flat();
        const randomSpy = jest.spyOn(Math, 'random');
        allRolls.forEach(v => randomSpy.mockReturnValueOnce(v));
        try {
            await callback(fakeClient, interaction);
        } finally {
            randomSpy.mockRestore();
        }

        // Searches every followUp rather than assuming the LAST one is the chain's own
        // final embed — achievementFactory/questFactory are left real here, so a genuine
        // unlock can add its own followUp(s) on top, after the chain's own messages.
        const capField = interaction.followUp.mock.calls
            .map(([payload]) => payload.embeds?.[0]?.data?.fields?.find(f => f.name.includes('Chain Cap Reached')))
            .find(Boolean);
        expect(capField).toBeDefined();
        expect(capField.value).toContain(`${Work.MAX_BOUNTY_RAID_COOLDOWN_SKIP_CHAIN_LENGTH}`);
        expect(capField.value.toLowerCase()).toContain('not');
    });
});
