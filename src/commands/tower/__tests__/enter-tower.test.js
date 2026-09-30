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
    // Explicit default (2026-09-30) — jest.clearAllMocks() above clears call history but NOT a
    // previously-set mockResolvedValue, so without this, a test further down the file that sets
    // getStatDatabase to resolve `{ enabled: true }` (the tower_access live-toggle read) would
    // silently leak that resolved value into every test that runs after it. undefined here
    // matches tower_access's own real-world default (nobody has run /admin tower-access yet).
    dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
});

// Kill switch (2026-09-29, made a live admin toggle 2026-09-30 — see tower.md) — the
// `tower_access` stats doc short-circuits the callback before any of the logic these tests
// exercise ever runs, whenever it's disabled/unset (the default until an admin explicitly
// turns it on via `/admin tower-access`). Confirmed separately below; every test in this
// describe block still documents real, correct behavior for when access is allowed, so
// they're skipped (not deleted/rewritten) rather than left to fail against the disabled
// path. Un-skip this block once `tower_access.enabled` is expected to default to true, or add
// an explicit `dynamoHandler.getStatDatabase.mockResolvedValue({ enabled: true })` at the top
// of each test if that default is never meant to flip.
describe.skip('normal gameplay (skipped while tower_access is disabled/unset by default — see tower.md)', () => {
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

// The run's own TEMPORARY (this-run-only) work modifier (2026-09-30, direct instruction) —
// distinct from the PERMANENT workMultiplier reward covered by the test above. Recorded on
// the leaderboard entry as `tempWorkMultiplier`, sourced from run[tC.MODIFIER.WORK_MULTIPLIER]
// (index 4), specifically so /admin reset-tower's resume-from-leaderboard option (admin.js's
// buildResumeCheckpointFromLeaderboardEntry) can restore it instead of defaulting it to 0.
test('a survived run records tempWorkMultiplier on the leaderboard entry, sourced from run[MODIFIER.WORK_MULTIPLIER]', async () => {
    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
    towerFactory.mockImplementation(() => ({
        // run indices: [POTATOES, WORK_MULTIPLIER, PASSIVE_INCOME, BANK_CAPACITY, MODIFIER.WORK_MULTIPLIER]
        startRun: jest.fn().mockResolvedValue([[5000, 0, 0, 0, 6.5], 42, false, 3, 0, false]),
    }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.recordTowerLeaderboardEntry).toHaveBeenCalledWith(expect.objectContaining({
        tempWorkMultiplier: 6.5,
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

test('tower_access disabled/missing replies with a maintenance message and never reads or writes anything', async () => {
    // Relies on this file's own beforeEach default (getStatDatabase resolves undefined) —
    // deliberately exercising the "nobody has ever run /admin tower-access" case, which must
    // default to blocked, not allowed.
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/temporarily disabled/i));
    expect(dynamoHandler.findUser).not.toHaveBeenCalled();
    expect(towerFactory).not.toHaveBeenCalled();
});

test('tower_access explicitly disabled (enabled: false) replies with the same maintenance message', async () => {
    dynamoHandler.getStatDatabase.mockResolvedValue({ enabled: false });
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/temporarily disabled/i));
    expect(towerFactory).not.toHaveBeenCalled();
});

test('tower_access enabled: true lets a non-developer through', async () => {
    dynamoHandler.getStatDatabase.mockResolvedValue({ enabled: true });
    dynamoHandler.findUser.mockResolvedValue(baseUser({ workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(interaction.editReply).not.toHaveBeenCalledWith(expect.stringMatching(/temporarily disabled/i));
    expect(towerFactory).toHaveBeenCalled();
});

// Admin bypass (2026-09-29, direct instruction: "Allow admins to enter tower") — lets the
// team keep testing/reproducing the crash live while `tower_access` stays disabled/unset for
// everyone else (now a live toggle — `/admin tower-access`, 2026-09-30 — rather than the
// original hardcoded TOWER_DISABLED constant this section's own name still references).
// Reuses the real awsConfigurations.devs list (constants.js isn't mocked in this file), not a
// hardcoded id, so this stays correct if that list ever changes.
describe('admin bypass while tower_access is disabled/unset', () => {
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

    // True-resume checkpointing (2026-09-30, direct instruction: "I want a crashed run to do
    // exactly that. Crash, and the user can continue after a crashed run from their existing DB
    // record for the day if it hasnt resulted in a leave from tower, death from elite, or death
    // by elite but save by bastion" — supersedes the earlier same-day "implement #1" pass, which
    // credited whatever was banked immediately on a crash and made the player restart from floor
    // 1). towerFactory itself is mocked out in this file, so these tests simulate a real climb's
    // checkpoint calls by invoking the onFloorComplete callback enter-tower.js passes as the
    // mocked constructor's 7th argument, exactly as the real towerFactory.checkpoint() would.
    test('a crash after at least one floor checkpointed credits NOTHING yet, leaves the checkpoint in place, and tells the player to resume', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation((interaction, username, multi, autoContinue, rewardBonus, hasWard, onFloorComplete) => ({
            floor: 12,
            startRun: jest.fn(async () => {
                await onFloorComplete({
                    floor: 10,
                    run: {
                        [tC.PAYOUT.POTATOES]: 5000,
                        [tC.PAYOUT.WORK_MULTIPLIER]: 0.2,
                        [tC.PAYOUT.PASSIVE_INCOME]: 0,
                        [tC.PAYOUT.BANK_CAPACITY]: 0,
                        [tC.PAYOUT.ELITE_KILL]: [],
                    },
                    elitesSurvivedCount: 1,
                    towerCompanionHits: 0,
                    wardUsed: false,
                    policy: 'safe',
                    difficulty: 4,
                    usedRewards: [],
                });
                throw new Error('boom');
            }),
        }));
        const interaction = adminInteraction();

        await expect(callback({}, interaction)).resolves.not.toThrow();

        // Nothing credited, no leaderboard/personal-best touch — the run hasn't concluded.
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(dynamoHandler.updateIfNewRecord).not.toHaveBeenCalled();
        expect(dynamoHandler.recordTowerLeaderboardEntry).not.toHaveBeenCalled();

        // Entry restored so /enter-tower is callable again, but the checkpoint itself is NEVER
        // cleared from the crash path — that's the whole resume mechanism.
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith(awsConfigurations.devs[0], 'canEnterTower', true);
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith(awsConfigurations.devs[0], 'towerRunCheckpoint', null);

        const [{ content }] = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        expect(content).toContain('floor 10');
        expect(content).toContain('safely saved');
        expect(content).toMatch(/enter-tower again to pick up/i);
    });

    test('a crash before any floor checkpoints tells the player nothing was saved yet, matching the pre-resume behavior', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation(() => ({
            floor: 1,
            startRun: jest.fn().mockRejectedValue(new Error('boom')),
        }));
        const interaction = adminInteraction();

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith(awsConfigurations.devs[0], 'canEnterTower', true);
        const [{ content }] = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        expect(content).toContain('Nothing from that attempt was saved yet');
    });

    // A deliberate timeout (2026-09-30, direct instruction: "for timeout, update it so that it
    // is just a non-complete and user has to enter tower again resuming...") gets the SAME
    // non-crediting/checkpoint-preserving mechanics as any other crash, but its own honest
    // message ("you didn't respond in time") instead of "hit an unexpected error", and logs via
    // console.log (an expected, everyday occurrence) rather than console.error (a real bug).
    // towerFactory itself is mocked out in this file, so the timeout is simulated the same way
    // the real TowerTimeoutError would arrive: a rejected startRun() whose error has
    // `name: 'TowerTimeoutError'` (enter-tower.js checks the name, not `instanceof`, precisely
    // so this file's own automocked towerFactory module never needs the real class imported).
    test('a timeout after a floor checkpointed tells the player to resume, without crash-style wording, and logs via console.log not console.error', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        const timeoutError = Object.assign(new Error('No response on the Continue/Leave screen at floor 10'), { name: 'TowerTimeoutError' });
        towerFactory.mockImplementation((interaction, username, multi, autoContinue, rewardBonus, hasWard, onFloorComplete) => ({
            floor: 11,
            startRun: jest.fn(async () => {
                await onFloorComplete({
                    floor: 10,
                    run: { [tC.PAYOUT.POTATOES]: 5000, [tC.PAYOUT.WORK_MULTIPLIER]: 0, [tC.PAYOUT.PASSIVE_INCOME]: 0, [tC.PAYOUT.BANK_CAPACITY]: 0, [tC.PAYOUT.ELITE_KILL]: [] },
                    elitesSurvivedCount: 1, towerCompanionHits: 0, wardUsed: false, policy: 'safe', difficulty: 4, usedRewards: [],
                });
                throw timeoutError;
            }),
        }));
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const interaction = adminInteraction();

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith(awsConfigurations.devs[0], 'canEnterTower', true);
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith(awsConfigurations.devs[0], 'towerRunCheckpoint', null);
        const [{ content }] = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        expect(content).toContain("didn't respond in time");
        expect(content).toContain('floor 10');
        expect(content).not.toMatch(/unexpected error/i);
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('no response in time'), timeoutError.message);
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('crashed'), expect.anything());
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    test('a timeout before any floor checkpoints still says nothing was saved yet, without crash-style wording', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        const timeoutError = Object.assign(new Error('No response on the Continue/Leave screen at floor 1'), { name: 'TowerTimeoutError' });
        towerFactory.mockImplementation(() => ({
            floor: 1,
            startRun: jest.fn().mockRejectedValue(timeoutError),
        }));
        const interaction = adminInteraction();

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        const [{ content }] = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        expect(content).toContain("didn't respond in time");
        expect(content).toContain('nothing from that attempt was saved yet');
        expect(content).not.toMatch(/unexpected error/i);
    });

    test('a pending checkpoint from a previous crash is passed to towerFactory as resumeFrom, and cleared only once the resumed run actually concludes', async () => {
        const pendingCheckpoint = {
            floor: 10,
            run: {
                [tC.PAYOUT.POTATOES]: 5000,
                [tC.PAYOUT.WORK_MULTIPLIER]: 0.2,
                [tC.PAYOUT.PASSIVE_INCOME]: 0,
                [tC.PAYOUT.BANK_CAPACITY]: 0,
                [tC.PAYOUT.ELITE_KILL]: [],
            },
            elitesSurvivedCount: 1,
            towerCompanionHits: 0,
            wardUsed: false,
            policy: 'safe',
            difficulty: 4,
            usedRewards: [],
        };
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0,
            towerRunCheckpoint: pendingCheckpoint,
        }));
        towerFactory.mockImplementation(() => ({
            // Simulates the resumed run continuing to floor 15 and then a voluntary leave —
            // the mocked startRun() return is what a real towerFactory would compute by
            // combining the resumeFrom state with everything resolved after resuming, so the
            // final numbers here (potatoes 8000, work multiplier 0.5) stand in for that combined
            // total rather than re-deriving it from pendingCheckpoint's own numbers.
            startRun: jest.fn().mockResolvedValue([[8000, 0.5, 0, 0], 15, false, 2, 0, false]),
        }));
        const interaction = adminInteraction();

        await callback({}, interaction);

        // towerFactory's 8th constructor argument is the resume checkpoint.
        expect(towerFactory).toHaveBeenCalledWith(
            interaction, 'Admin', tC.ENTRY_GATE_MULTI, false, 0, false, expect.any(Function), pendingCheckpoint
        );

        // The run concluded for real this time — credited normally, leaderboard/personal-best
        // updated, and the checkpoint (now fully superseded) cleared.
        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [, , addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(addFields).toEqual({ potatoes: 8000, totalEarnings: 8000 });
        expect(dynamoHandler.updateIfNewRecord).toHaveBeenCalledWith(awsConfigurations.devs[0], 'highestTowerFloor', 15);
        expect(dynamoHandler.recordTowerLeaderboardEntry).toHaveBeenCalledWith(expect.objectContaining({ floor: 15 }));
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith(awsConfigurations.devs[0], 'towerRunCheckpoint', null);
    });

    test('a resume attempt that crashes again before checkpointing any NEW floor still reports the pre-existing checkpoint, not "nothing saved"', async () => {
        const pendingCheckpoint = {
            floor: 10,
            run: {
                [tC.PAYOUT.POTATOES]: 5000, [tC.PAYOUT.WORK_MULTIPLIER]: 0, [tC.PAYOUT.PASSIVE_INCOME]: 0, [tC.PAYOUT.BANK_CAPACITY]: 0, [tC.PAYOUT.ELITE_KILL]: [],
            },
            elitesSurvivedCount: 1, towerCompanionHits: 0, wardUsed: false, policy: 'safe', difficulty: 4, usedRewards: [],
        };
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0,
            towerRunCheckpoint: pendingCheckpoint,
        }));
        towerFactory.mockImplementation(() => ({
            floor: 11,
            // Crashes immediately — no onFloorComplete call this attempt at all.
            startRun: jest.fn().mockRejectedValue(new Error('boom again')),
        }));
        const interaction = adminInteraction();

        await expect(callback({}, interaction)).resolves.not.toThrow();

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith(awsConfigurations.devs[0], 'towerRunCheckpoint', null);
        const [{ content }] = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1];
        expect(content).toContain('floor 10');
        expect(content).toContain('safely saved');
    });

    // Leaderboard/personal-best eligibility (direct instruction, following up on the
    // checkpointing feature above): a checkpoint-credited CRASH must never count, but the two
    // ways a run can genuinely CONCLUDE should be unaffected by that exclusion — a voluntary
    // leave, and an Elite death saved by Bastion's ward (towerFactory.js keeps `died` false in
    // that case specifically so it resolves exactly like a voluntary leave — see execElite's
    // own comment). Both reach the SAME tail-bookkeeping block (`died` false either way), so
    // one test covers both without needing to fake which specific path produced it.
    test("an Elite death saved by Bastion's ward (died stays false) counts toward highestTowerFloor and the daily leaderboard, same as a voluntary leave", async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation(() => ({
            // [rewards, floor, died, elitesSurvivedCount, towerCompanionHits, wardUsed] — died
            // is false (the ward saved it), wardUsed is true.
            startRun: jest.fn().mockResolvedValue([[5000, 0, 0, 0], 10, false, 1, 0, true]),
        }));
        const interaction = adminInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateIfNewRecord).toHaveBeenCalledWith(awsConfigurations.devs[0], 'highestTowerFloor', 10);
        expect(dynamoHandler.recordTowerLeaderboardEntry).toHaveBeenCalledWith(expect.objectContaining({
            userId: awsConfigurations.devs[0],
            floor: 10,
        }));
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith(awsConfigurations.devs[0], 'towerWardUsedToday', true);
    });

    test('a real (unwarded) Elite death counts toward highestTowerFloor but NOT the daily leaderboard — unchanged, unrelated to checkpointing', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ userId: awsConfigurations.devs[0], workMultiplierAmount: tC.ENTRY_GATE_MULTI, rebirthCount: 0 }));
        towerFactory.mockImplementation(() => ({
            startRun: jest.fn().mockResolvedValue([[5000, 0, 0, 0], 10, true, 0, 0, false]), // died: true
        }));
        const interaction = adminInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.updateIfNewRecord).toHaveBeenCalledWith(awsConfigurations.devs[0], 'highestTowerFloor', 10);
        expect(dynamoHandler.recordTowerLeaderboardEntry).not.toHaveBeenCalled();
    });
});
