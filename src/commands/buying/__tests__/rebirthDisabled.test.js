// /rebirth is closed while the Rebirth v2 rework is planned (2026-11-17, direct instruction; see
// .claude/systems/rebirth-v2-plan.md). Non-developers get a friendly refusal before any DB read; developers
// bypass so the flow stays testable.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { awsConfigurations } = require('../../../utils/constants');
const { callback } = require('../rebirth');

function fakeInteraction(userId) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue({ awaitMessageComponent: jest.fn().mockResolvedValue(null), edit: jest.fn().mockResolvedValue() }),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: userId, username: 'User', displayName: 'User', avatar: null },
    };
}

// A fresh account: nothing maxed, so a developer who gets past the closure lands on "not eligible", never a real reset.
function freshUser(userId) {
    return {
        userId, username: 'User', potatoes: 0, bankStored: 0, maxStarches: 250, workMultiplierAmount: 1, passiveAmount: 0, bankCapacity: 50000,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        regrades: { workMulti: { regradeAmount: 0, failStack: 0 }, passiveAmount: { regradeAmount: 0, failStack: 0 }, bankCapacity: { regradeAmount: 0, failStack: 0 } },
        rebirthCount: 0, companions: { owned: [], active: null },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
});

describe('/rebirth closure', () => {
    test('a non-developer is refused before any DB read or write', async () => {
        const interaction = fakeInteraction('player-1');

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        expect(interaction.editReply.mock.calls[0][0]).toMatch(/sealed for now/);
        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('a developer gets past the closure and reaches the normal eligibility check', async () => {
        const devId = awsConfigurations.devs[0];
        dynamoHandler.findUser.mockResolvedValue(freshUser(devId));
        const interaction = fakeInteraction(devId);

        await callback({}, interaction);

        expect(dynamoHandler.findUser).toHaveBeenCalled();
        const reply = interaction.editReply.mock.calls[0][0];
        expect(reply.content).toBeUndefined(); // an embed (not eligible), not the closure message
        expect(reply.embeds).toHaveLength(1);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });
});
