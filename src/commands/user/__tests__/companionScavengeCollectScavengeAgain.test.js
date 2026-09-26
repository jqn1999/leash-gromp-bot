// "Scavenge Again" button (direct instruction: "Have companion scavenge collection embed
// have a button to resend the same companion out to scavenge again") — spares a player who
// just wants to keep cycling the same instance the extra /companion-scavenge round trip.
// Reuses companionFactory.validateScavengeDispatch (companionScavenge.js's own command runs
// the identical check), re-validated against a FRESH findUser read at click time rather than
// the userDetails the collect reply was originally rendered with.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../companionScavengeCollect');

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        workMultiplierAmount: 10,
        rebirthCount: 0,
        guildId: 0,
        starches: 0,
        achievements: [],
        companions: {
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 0 }],
            active: null,
            ownedCount: 1,
            mythicOwnedCount: 0,
            scavenging: { instanceId: 'sprout-a', rarity: 'common', returnsAt: Date.now() - 1000 },
            scavengeReturnsByRarity: {},
        },
        ...overrides,
    };
}

// buttonChoice: 'click' resolves a real Scavenge Again click, 'timeout' resolves null.
function fakeInteraction(buttonChoice = 'click') {
    const replyObj = {
        edit: jest.fn().mockResolvedValue(),
        awaitMessageComponent: jest.fn().mockImplementation(async () => {
            if (buttonChoice === 'click') return { customId: 'scavenge_again', deferUpdate: jest.fn().mockResolvedValue() };
            return null; // timeout
        }),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
    dynamoHandler.isWorldBuffLive.mockReturnValue(false);
    dynamoHandler.resolveScavenge.mockResolvedValue(true);
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

test('the collect reply carries a Scavenge Again button', async () => {
    dynamoHandler.findUser.mockResolvedValue(baseUser());
    const interaction = fakeInteraction('timeout');

    await callback({}, interaction);

    const firstEditReplyCall = interaction.editReply.mock.calls[0][0];
    expect(firstEditReplyCall.components).toHaveLength(1);
});

// achievementFactory.checkAndUnlock also calls updateUserFields (a real "first_companion"
// unlock off ownedCount:1 in this fixture) — filter to the scavenge-dispatch's own shape so
// that write doesn't get confused for a re-dispatch.
function dispatchCalls() {
    return dynamoHandler.updateUserFields.mock.calls.filter(([, fields]) => fields?.companions?.scavenging !== undefined);
}

test('timeout clears the button and dispatches nothing new', async () => {
    dynamoHandler.findUser.mockResolvedValue(baseUser());
    const interaction = fakeInteraction('timeout');

    await callback({}, interaction);

    expect(dispatchCalls()).toHaveLength(0);
});

test('clicking Scavenge Again re-sends the SAME instance and reports the new return time', async () => {
    const collectedUser = baseUser();
    // The confirm-time re-fetch reflects the collect that already landed (scavenging: null)
    // — findUser's mocked return doesn't update itself the way the real DB write would.
    const postCollectUser = { ...collectedUser, companions: { ...collectedUser.companions, scavenging: null } };
    dynamoHandler.findUser
        .mockResolvedValueOnce(collectedUser)
        .mockResolvedValueOnce(postCollectUser);
    const interaction = fakeInteraction('click');

    await callback({}, interaction);

    const calls = dispatchCalls();
    expect(calls).toHaveLength(1);
    const [userId, fields] = calls[0];
    expect(userId).toBe('user-1');
    expect(fields.companions.scavenging.instanceId).toBe('sprout-a');
    expect(fields.companions.scavenging.returnsAt).toBeGreaterThan(Date.now());

    const followUpCalls = interaction.followUp.mock.calls.map(([payload]) => payload?.content).filter(Boolean);
    expect(followUpCalls.some(text => text.includes('heads back out scavenging'))).toBe(true);
});

test('clicking Scavenge Again when the instance is now equipped as active reports the error instead of dispatching', async () => {
    // Fresh read (the confirm-time re-fetch) shows the SAME instance now equipped —
    // findUser's second call returns that state.
    const collectedUser = baseUser();
    const nowActiveUser = { ...collectedUser, companions: { ...collectedUser.companions, active: 'sprout-a', scavenging: null } };
    dynamoHandler.findUser
        .mockResolvedValueOnce(collectedUser)
        .mockResolvedValueOnce(nowActiveUser);
    const interaction = fakeInteraction('click');

    await callback({}, interaction);

    expect(dispatchCalls()).toHaveLength(0);
    const followUpCalls = interaction.followUp.mock.calls.map(([payload]) => payload?.content).filter(Boolean);
    expect(followUpCalls.some(text => text.includes('your active companion'))).toBe(true);
});
