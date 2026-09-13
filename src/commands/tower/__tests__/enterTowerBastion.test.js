// End-to-end coverage for Bastion, the Tower Warden's wiring through enter-tower.js
// (2026-09-13) — enter-tower.test.js already covers the entry-gate/effective-power logic
// with towerFactory mocked and a companion-less baseUser(); this file specifically exercises
// a Bastion-equipped user's full round trip: perk resolution feeding into the towerFactory
// constructor call, and post-run leveling/drop-award/ward persistence via
// processRewardPayouts -> processTowerCompanionRewards.
//
// dynamoHandler and towerFactory are mocked (same as enter-tower.test.js — exercising real
// run mechanics is towerFactory.test.js's job). companionFactory is left REAL so this test
// actually proves the wiring between enter-tower.js and companionFactory's own functions,
// not just that enter-tower.js calls some mock.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/towerFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { towerFactory } = require('../../../utils/towerFactory');
const { callback } = require('../enter-tower');
const tC = require('../../../utils/towerConstants');
const companionFactory = require('../../../utils/companionFactory');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        reply: jest.fn().mockResolvedValue(),
        deferred: true,
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

function bastionOwner(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        workMultiplierAmount: tC.ENTRY_GATE_MULTI,
        autoTowerContinue: false,
        canEnterTower: true,
        passiveAmount: 0,
        bankCapacity: 0,
        rebirthCount: 0,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        towerWardUsedToday: false,
        companions: {
            owned: [{ instanceId: 'bastion-1', id: 'bastion', workCount: 0 }],
            active: 'bastion-1',
            ownedCount: 1,
            mythicOwnedCount: 0,
        },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    towerFactory.mockImplementation(() => ({
        startRun: jest.fn().mockResolvedValue([[0, 0, 0, 0], 1, false, 0, 0, false]),
    }));
});

test("a Bastion-equipped user's level-1 towerRewardBonus (0.10) and available ward are resolved and passed into towerFactory's constructor", async () => {
    const user = bastionOwner();
    dynamoHandler.findUser.mockResolvedValue(user);
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(companionFactory.hasTowerDeathWard(user)).toBe(true);
    expect(towerFactory).toHaveBeenCalledWith(interaction, 'User', tC.ENTRY_GATE_MULTI, false, 0.10, true);
});

test('towerWardUsedToday=true on the pre-run snapshot suppresses hasWard even though Bastion is equipped', async () => {
    const user = bastionOwner({ towerWardUsedToday: true });
    dynamoHandler.findUser.mockResolvedValue(user);
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(towerFactory).toHaveBeenCalledWith(interaction, 'User', tC.ENTRY_GATE_MULTI, false, 0.10, false);
});

test('a run where the Ward was used persists towerWardUsedToday=true via processTowerCompanionRewards', async () => {
    const user = bastionOwner();
    // findUser is called twice: once for the entry gate, once inside processRewardPayouts
    // (a fresh re-fetch — see that function's own comment on why it doesn't reuse the
    // pre-run snapshot). Both resolve to the same fixture here since nothing else in this
    // test mutates the user between them.
    dynamoHandler.findUser.mockResolvedValue(user);
    towerFactory.mockImplementation(() => ({
        startRun: jest.fn().mockResolvedValue([[100000, 0, 0, 0], 15, false, 1, 0, true]),
    }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'towerWardUsedToday', true);
});

test('a run with no Ward usage never writes towerWardUsedToday', async () => {
    const user = bastionOwner();
    dynamoHandler.findUser.mockResolvedValue(user);
    towerFactory.mockImplementation(() => ({
        startRun: jest.fn().mockResolvedValue([[100000, 0, 0, 0], 15, false, 1, 0, false]),
    }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalledWith('user-1', 'towerWardUsedToday', expect.anything());
});

test('surviving Elites climbs the equipped Bastion instance via the towerRewardBonus accelerant leveling path, persisting the updated companions object', async () => {
    const user = bastionOwner();
    dynamoHandler.findUser.mockResolvedValue(user);
    // floor 25, 2 Elites survived -> getTowerWorkCountGrant(25, 2) = 25*3 + 2*15 = 105.
    towerFactory.mockImplementation(() => ({
        startRun: jest.fn().mockResolvedValue([[500000, 0, 0, 0], 25, false, 2, 0, false]),
    }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    const expectedGrant = companionFactory.getTowerWorkCountGrant(25, 2);
    expect(expectedGrant).toBe(105);
    const [, , companionsArg] = dynamoHandler.updateUserDatabase.mock.calls.find(
        call => call[1] === 'companions'
    );
    const leveledInstance = companionsArg.owned.find(o => o.instanceId === 'bastion-1');
    expect(leveledInstance.workCount).toBe(105);
});

test('a Bastion drop hit (towerCompanionHits >= 1) awards a second independent Bastion instance and announces it via a separate followUp embed', async () => {
    const user = bastionOwner();
    dynamoHandler.findUser.mockResolvedValue(user);
    towerFactory.mockImplementation(() => ({
        startRun: jest.fn().mockResolvedValue([[500000, 0, 0, 0], 30, false, 3, 1, false]),
    }));
    const interaction = fakeInteraction();

    await callback({}, interaction);

    const [, , companionsArg] = dynamoHandler.updateUserDatabase.mock.calls.find(
        call => call[1] === 'companions'
    );
    const bastionCopies = companionsArg.owned.filter(o => o.id === 'bastion');
    expect(bastionCopies).toHaveLength(2);
    // Already owned Bastion -> resolveTowerCompanionAward reports isNew=false, so the
    // second followUp (after the main result embed) should reflect the "already owned"
    // wording rather than a fresh-pickup one.
    const dropFollowUp = interaction.followUp.mock.calls.find(
        call => call[0]?.embeds?.[0]?.data?.title?.includes('Bastion')
    );
    expect(dropFollowUp).toBeDefined();
    expect(dropFollowUp[0].embeds[0].data.title).toContain('already owned');
});

test('a player with no companion equipped at all gets rewardBonus 0 and hasWard false, unaffected by Bastion logic', async () => {
    const user = bastionOwner({ companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 } });
    dynamoHandler.findUser.mockResolvedValue(user);
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(towerFactory).toHaveBeenCalledWith(interaction, 'User', tC.ENTRY_GATE_MULTI, false, 0, false);
});
