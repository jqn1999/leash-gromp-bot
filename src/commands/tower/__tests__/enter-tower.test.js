// Coverage for /enter-tower's entry gate reading FULL effective power (raw
// workMultiplierAmount + live rebirth/companion workMultiplierPercent bonuses) rather than
// just the raw stored stat — see tower.md's "Entry Gate Uses Effective Power" section. This
// reuses raidFactory.getMemberRaidPower, the exact same formula already used for a solo
// raider's own contribution, rather than a new one-off formula.
//
// towerFactory itself is mocked out here — exercising the actual run mechanics (Elite
// success chance, reward scaling) is towerFactory.test.js's job; this file is only
// concerned with what enter-tower.js computes and passes in at its two call sites (the gate
// check and the towerFactory constructor call).
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/towerFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { towerFactory } = require('../../../utils/towerFactory');
const { callback } = require('../enter-tower');
const tC = require('../../../utils/towerConstants');
const { Rebirth, awsConfigurations } = require('../../../utils/constants');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        reply: jest.fn().mockResolvedValue(),
        deferred: true,
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        // Last-resort fallback channel (2026-09-30) — see enter-tower.js's own
        // sendFallbackChannelMessage comment. Present on every fake interaction so tests that
        // don't care about it don't need their own stub; tests that DO care override
        // channel.send to reject/resolve as needed.
        channel: { send: jest.fn().mockResolvedValue() },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        workMultiplierAmount: 10,
        autoTowerContinue: false,
        canEnterTower: true,
        passiveAmount: 0,
        bankCapacity: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    towerFactory.mockImplementation(() => ({
        startRun: jest.fn().mockResolvedValue([[0, 0, 0, 0], 1, false]),
    }));
    // Defaults to a truthy (successful) write — dynamoHandler.updateUserFields resolves to
    // undefined on a real DynamoDB failure (see enter-tower.js's own comment on this), and
    // jest's automock would otherwise return undefined unconfigured, making every test look
    // like a failed write. Individual tests override this to simulate an actual failure.
    dynamoHandler.updateUserFields.mockResolvedValue({ Attributes: {} });
});

// Kill switch (2026-09-29) — TOWER_DISABLED in enter-tower.js short-circuits the callback
// before any of the logic these tests exercise ever runs. Confirmed separately below; every
// test in this describe block still documents real, correct behavior for when the flag flips
// back to false, so they're skipped (not deleted/rewritten) rather than left to fail against
// the disabled path. Un-skip this block in the same commit that flips TOWER_DISABLED back off.
describe.skip('normal gameplay (skipped while TOWER_DISABLED is true — see tower.md)', () => {
test('a player below ENTRY_GATE_MULTI on raw workMultiplierAmount alone is barred', () => {
    // rebirthCount 0 => 0% live rebirth bonus, so effective power === raw power here.
    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI - 1, rebirthCount: 0 }));
    const interaction = fakeInteraction();

    return callback({}, interaction).then(() => {
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('barred entry'));
        expect(towerFactory).not.toHaveBeenCalled();
    });
});

test('a player at or above ENTRY_GATE_MULTI on raw workMultiplierAmount with no rebirth/companion bonus enters normally (effective power === raw power, no regression)', async () => {
    const rawMulti = tC.ENTRY_GATE_MULTI;
    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: rawMulti, rebirthCount: 0 }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(interaction.editReply).not.toHaveBeenCalled();
    // Trailing 0/false (2026-09-13) — Bastion's towerRewardBonus/hasWard, both resolved from
    // baseUser()'s own companion-less state (no `companions` field at all) to their safe
    // "nothing equipped" defaults. See enterTowerBastion.test.js for coverage once a
    // companion is actually involved.
    expect(towerFactory).toHaveBeenCalledWith(interaction, 'User', rawMulti, false, 0, false);
});

test('a player below ENTRY_GATE_MULTI on raw workMultiplierAmount alone clears the gate once their live rebirth bonus is folded in, and towerFactory is constructed with the effective (not raw) power', async () => {
    // rebirthCount 6 -> BASE_BONUS_PERCENT + 5*BONUS_PERCENT_STEP = 0.05 + 0.475 = 52.5% live bonus.
    const rawMulti = 15; // below ENTRY_GATE_MULTI (20) on its own
    const rebirthCount = 6;
    const expectedPercent = Rebirth.BASE_BONUS_PERCENT + (rebirthCount - 1) * Rebirth.BONUS_PERCENT_STEP;
    const expectedEffectivePower = rawMulti * (1 + expectedPercent);
    expect(rawMulti).toBeLessThan(tC.ENTRY_GATE_MULTI);
    expect(expectedEffectivePower).toBeGreaterThanOrEqual(tC.ENTRY_GATE_MULTI); // sanity: this is actually the bug scenario

    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: rawMulti, rebirthCount }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringContaining('barred entry'));
    // Trailing 0/false — see the previous test's own comment on Bastion's two new args.
    expect(towerFactory).toHaveBeenCalledWith(interaction, 'User', expectedEffectivePower, false, 0, false);
});

// Auto-recovery (2026-09-11): a run that throws partway through used to strand the player
// (canEnterTower already flipped false, no other write to ever restore it) until the next
// day's 8pm ET reset — see tower.md's "/admin-reset-tower" section. Now the entry is
// restored automatically and the player is told plainly what happened.
test('a run that throws mid-climb restores canEnterTower and tells the player, instead of leaving them stuck', async () => {
    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
    towerFactory.mockImplementation(() => ({
        floor: 7,
        startRun: jest.fn().mockRejectedValue(new Error('boom')),
    }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'canEnterTower', false);
    expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'canEnterTower', true);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringMatching(/unexpected error.*floor 7.*enter-tower again/is),
    }));
    // The crashed run must never reach payout/leaderboard bookkeeping.
    expect(dynamoHandler.updateIfNewRecord).not.toHaveBeenCalled();
    expect(dynamoHandler.recordTowerLeaderboardEntry).not.toHaveBeenCalled();
});

// Ranking tiebreaker source (2026-09-23, direct instruction — see
// towerLeaderboardFactory.test.js's sortTowerLeaderboardEntries suite for how this actually
// gets used at ranking time). Confirms enter-tower.js reads elitesSurvivedCount off
// startRun()'s own return tuple (index 3) and passes it straight through as `elitesKilled`
// on a survived run.
test('a survived run records elitesKilled on the leaderboard entry, sourced from startRun\'s elitesSurvivedCount', async () => {
    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
    towerFactory.mockImplementation(() => ({
        // [run, floor, died, elitesSurvivedCount, towerCompanionHits, wardUsed]
        startRun: jest.fn().mockResolvedValue([[5000, 0, 0, 0], 42, false, 3, 0, false]),
    }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.recordTowerLeaderboardEntry).toHaveBeenCalledWith(expect.objectContaining({
        floor: 42,
        elitesKilled: 3,
        potatoes: 5000,
    }));
});

// Root-caused from a player's base stats (raw minus sweetPotatoBuffs minus regradeAmount)
// silently drifting off a valid shop tier over repeated Tower runs, breaking /buy's and
// /regrade's exact-match tier lookups (2026-09-23). processRewardPayouts used to fire FOUR
// separate, sequential, unconditional single-field updateUserDatabase calls (whose errors
// are swallowed by a bare .catch, never surfaced to this caller) instead of one atomic
// updateUserFields call — any one of those four failing after an earlier one landed would
// permanently desync the raw stat from sweetPotatoBuffs. These tests confirm the batched
// fix: exactly one updateUserFields call carries every granted stat, and the old
// updateUserDatabase path is never used for any of them.
describe('processRewardPayouts stat crediting (batched write)', () => {
    test('a run granting all three permanent stats plus potatoes writes them all in ONE updateUserFields call, never via updateUserDatabase', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            workMultiplierAmount: tC.ENTRY_GATE_MULTI,
            passiveAmount: 1000000,
            bankCapacity: 5000000,
            sweetPotatoBuffs: { workMultiplierAmount: 1, passiveAmount: 100, bankCapacity: 200 },
        }));
        towerFactory.mockImplementation(() => ({
            // [potatoes, workMultiplier, passiveIncome, bankCapacity] per towerConstants.js's PAYOUT indices.
            startRun: jest.fn().mockResolvedValue([[5000, 0.2, 300000, 2000000], 10, false]),
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [calledUserId, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(calledUserId).toBe('user-1');
        expect(setFields).toEqual({
            workMultiplierAmount: tC.ENTRY_GATE_MULTI + 0.2,
            passiveAmount: 1300000,
            bankCapacity: 7000000,
            sweetPotatoBuffs: { workMultiplierAmount: 1.2, passiveAmount: 300100, bankCapacity: 2000200 },
        });
        expect(addFields).toEqual({ potatoes: 5000, totalEarnings: 5000 });

        // The fragile per-field path this replaced must never fire for these stat writes.
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith('user-1', 'workMultiplierAmount', expect.anything());
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith('user-1', 'passiveAmount', expect.anything());
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith('user-1', 'bankCapacity', expect.anything());
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith('user-1', 'sweetPotatoBuffs', expect.anything());
        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();
    });

    test('a run granting only potatoes never touches the stat fields, and a run granting nothing makes no write at all', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI }));
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[5000, 0, 0, 0], 10, false]),
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(setFields).toEqual({});
        expect(addFields).toEqual({ potatoes: 5000, totalEarnings: 5000 });
    });

    test('a run granting nothing at all (a pure Encounter miss) makes no updateUserFields call', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI }));
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[0, 0, 0, 0], 10, false]),
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    // Direct instruction (2026-09-23, same-day follow-up to the batching fix above): "can
    // you make it include a msg to the player if it fails so they can notify an admin" —
    // batching into one call closes the partial-desync window, but a single DynamoDB write
    // can still fail outright (throttle, timeout, etc.), and updateUserFields swallows that
    // failure internally (resolves to undefined rather than throwing). Without this check
    // the player would see the run's results embed and have no idea the reward never saved.
    test('a failed updateUserFields write tells the player to notify an admin, with the exact reward numbers, and skips companion rewards', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI }));
        dynamoHandler.updateUserFields.mockResolvedValue(undefined);
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[5000, 0.2, 0, 0], 10, false]),
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const failureCall = interaction.followUp.mock.calls.find(([opts]) => opts.content?.includes('database error'));
        expect(failureCall).toBeTruthy();
        const [{ content, ephemeral }] = failureCall;
        expect(content).toContain('User');
        expect(content).toContain('admin');
        expect(ephemeral).toBe(true);
        const reportMatch = content.match(/```json\n([\s\S]+?)\n```/);
        expect(reportMatch).toBeTruthy();
        const report = JSON.parse(reportMatch[1]);
        expect(report).toEqual(expect.objectContaining({
            userId: 'user-1',
            floor: 10,
            died: false,
            rewards: { potatoes: 5000, workMultiplier: 0.2, passiveIncome: 0, bankCapacity: 0 },
        }));

        // The stat credit didn't land — no point also touching companion leveling/drops.
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith('user-1', 'companions', expect.anything());
    });

    // Direct instruction (2026-09-26, same-day follow-up): "have tower fail more obviously
    // if any writes fail to go through but still let the user know what stats they gained" —
    // the run's own results embed above is sent in the same celebratory style as a real
    // success, so a text-only failure followUp right after it was easy to skim past. A loud
    // red warning embed with the actual numbers broken into real fields makes it
    // unmistakable, without dropping the existing JSON block admins already copy-paste from.
    test('the failure notice includes a red warning embed with the actual reward numbers, not just the JSON block', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI }));
        dynamoHandler.updateUserFields.mockResolvedValue(undefined);
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[5000, 0.2, 0, 0], 10, false]),
        }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const failureCall = interaction.followUp.mock.calls.find(([opts]) => opts.content?.includes('database error'));
        expect(failureCall).toBeTruthy();
        const [{ embeds }] = failureCall;
        expect(embeds).toHaveLength(1);
        const embed = embeds[0];
        expect(embed.data.color).toBe(0xED4245); // Discord.js 'Red'
        expect(embed.data.title).toMatch(/not saved/i);
        const fieldValues = embed.data.fields.map(f => f.value).join(' ');
        expect(fieldValues).toContain('10'); // floor
        expect(fieldValues).toContain('5,000'); // potatoes
        expect(fieldValues).toContain('0.20'); // work multiplier
    });
});
}); // end describe.skip('normal gameplay ...')

test('TOWER_DISABLED replies with a maintenance message and never reads or writes anything', async () => {
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/temporarily disabled/i));
    expect(dynamoHandler.findUser).not.toHaveBeenCalled();
    expect(towerFactory).not.toHaveBeenCalled();
});

// Admin bypass (2026-09-29, direct instruction: "Allow admins to enter tower") — lets the
// team keep testing/reproducing the crash live while TOWER_DISABLED stays true for everyone
// else. Reuses the real awsConfigurations.devs list (constants.js isn't mocked in this file),
// not a hardcoded id, so this stays correct if that list ever changes.
describe('admin bypass while TOWER_DISABLED is true', () => {
    function adminInteraction() {
        const interaction = fakeInteraction();
        interaction.user = { id: awsConfigurations.devs[0], username: 'Admin', displayName: 'Admin' };
        return interaction;
    }

    test("a caller whose id is in awsConfigurations.devs bypasses the disabled message and runs the command normally", async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        const interaction = adminInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringMatching(/temporarily disabled/i));
        expect(towerFactory).toHaveBeenCalled();
    });

    // safeEditReply retry (2026-09-29, crash-hardening pass — towerFactory.js's own
    // safeEditReply, exercised here through the full callback since towerFactory itself is
    // mocked out in this file — see towerFactory.test.js for direct coverage of the retry
    // helper against the real class). A transient failure on the FIRST results-embed followUp
    // must not stop the reward from still being credited afterward.
    test('a failed results-embed followUp does not stop the reward from being credited afterward', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[5000, 0, 0, 0], 10, false, 0, 0, false]),
        }));
        const interaction = adminInteraction();
        interaction.followUp = jest.fn()
            .mockRejectedValueOnce(new Error('transient'))
            .mockResolvedValue();

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [, , addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addFields).toEqual({ potatoes: 5000, totalEarnings: 5000 });
    });

    // Post-run bookkeeping try/catch (2026-09-29, crash-hardening pass — see tower.md): a
    // throw AFTER the climb already finished for real (recordTowerLeaderboardEntry here, but
    // the same catch covers processRewardPayouts/updateIfNewRecord too) must NOT restore
    // canEnterTower — the entry was legitimately consumed and the reward was very likely
    // already credited by processRewardPayouts before this later step failed, so re-opening
    // today's entry would risk a second free run on top of one that already paid out.
    // Last test in this file to set a throwing mockImplementation on a shared dynamoHandler
    // mock — jest.clearAllMocks() (this file's own beforeEach) clears call history but not a
    // previously-set mockImplementation, so ordering it last avoids bleeding into any test
    // after it.
    test('a throw in recordTowerLeaderboardEntry after a successful survived run does not restore canEnterTower, and notifies the player instead of crashing uncaught', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[5000, 0, 0, 0], 10, false, 0, 0, false]),
        }));
        dynamoHandler.recordTowerLeaderboardEntry.mockImplementation(() => {
            throw new Error('boom');
        });
        const interaction = adminInteraction();

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith(awsConfigurations.devs[0], 'canEnterTower', true);
        const failureCall = interaction.followUp.mock.calls.find(([opts]) => opts.content?.includes('something went wrong'));
        expect(failureCall).toBeTruthy();
    });

    // Last-resort channel fallback (2026-09-30, live report: "still getting random sporadic
    // drops from tower with no messaging" even after the 2026-09-29 hardening pass above —
    // because that pass's own recovery/notification attempts were themselves interaction-based
    // and had no further fallback once the interaction's webhook token was dead, e.g. after a
    // long, slow multi-floor climb exceeds Discord's ~15 minute token lifetime). These three
    // tests force BOTH the primary interaction-based attempt AND the retry/normal path to fail,
    // confirming interaction.channel.send is the one remaining way the player is told anything.
    test('a startRun crash where editReply/reply also fail still reaches the player via channel.send', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation(() => ({
            floor: 7,
            startRun: jest.fn().mockRejectedValue(new Error('boom')),
        }));
        const interaction = adminInteraction();
        interaction.editReply = jest.fn().mockRejectedValue(new Error('dead token'));
        interaction.reply = jest.fn().mockRejectedValue(new Error('dead token'));

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(interaction.channel.send).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringContaining(`<@${awsConfigurations.devs[0]}>`),
        }));
        const [{ content }] = interaction.channel.send.mock.calls[0];
        expect(content).toMatch(/unexpected error.*floor 7.*enter-tower again/is);
        // Entry restoration itself doesn't depend on notification succeeding.
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith(awsConfigurations.devs[0], 'canEnterTower', true);
    });

    test('a failed results-embed followUp falls back to a plain-text reward summary via channel.send', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[5000, 0.2, 300000, 2000000], 10, false, 0, 0, false]),
        }));
        const interaction = adminInteraction();
        interaction.followUp = jest.fn().mockRejectedValue(new Error('dead token'));

        await expect(callback({}, interaction)).resolves.not.toThrow();

        const summaryCall = interaction.channel.send.mock.calls.find(([opts]) => opts.content?.includes('Rewards:'));
        expect(summaryCall).toBeTruthy();
        const [{ content }] = summaryCall;
        expect(content).toContain(`<@${awsConfigurations.devs[0]}>`);
        expect(content).toContain('floor 10');
        expect(content).toContain('5,000 potatoes');
        expect(content).toContain('plain text');
    });

    test('a tail-bookkeeping throw where the followUp notice also fails falls back to channel.send, without ephemeral', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[5000, 0, 0, 0], 10, false, 0, 0, false]),
        }));
        dynamoHandler.recordTowerLeaderboardEntry.mockImplementation(() => {
            throw new Error('boom');
        });
        const interaction = adminInteraction();
        interaction.followUp = jest.fn().mockRejectedValue(new Error('dead token'));

        await expect(callback({}, interaction)).resolves.not.toThrow();

        const bookkeepingCall = interaction.channel.send.mock.calls.find(([opts]) => opts.content?.includes('something went wrong'));
        expect(bookkeepingCall).toBeTruthy();
        const [opts] = bookkeepingCall;
        expect(opts.content).toContain(`<@${awsConfigurations.devs[0]}>`);
        expect(opts).not.toHaveProperty('ephemeral');
    });
});
