// Coverage for the new /tower-settings command — a structural clone of /join-raid's own
// toggle shape (read a boolean field, flip it, write it back, reply with the resulting
// state, no options/no confirm step). See tower.md's "Persistent auto-continue toggle".
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../tower-settings');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User', avatar: 'avatar-hash' },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

test('toggles autoTowerContinue from off to on and reports the new state', async () => {
    dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', autoTowerContinue: false });
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'autoTowerContinue', true);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('will now automatically continue'));
});

test('toggles autoTowerContinue from on back to off and reports the new state', async () => {
    dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', autoTowerContinue: true });
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'autoTowerContinue', false);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Continue/Leave screen after every non-Elite floor again'));
});

test('a fresh/never-toggled account (autoTowerContinue undefined) is treated as off, so the first toggle turns it on', async () => {
    dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User' });
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('user-1', 'autoTowerContinue', true);
});

test('a database error looking up the user replies with the standard failure message and never writes', async () => {
    dynamoHandler.findUser.mockResolvedValue(null);
    const interaction = fakeInteraction();

    await callback({}, interaction);

    expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('could not be looked up'));
});
