// Titles (systems/titles.md) — /set-title. Mock style mirrors setMercenaryBuff.test.js.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { autocomplete, callback } = require('../setTitle');

function fakeInteraction(optionValues = {}, focusedValue = '') {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        respond: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (optionValues[name] !== undefined ? { value: optionValues[name] } : undefined),
            getFocused: () => ({ value: focusedValue }),
        },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        guildId: 0,
        permanentTitles: [],
        equippedTitle: null,
        rebirthCount: 0,
        guildRaidWinCount: 0,
        worldBossWinCount: 0,
        workCount: 0,
        workScenarioCounts: { golden: 0 },
        regrades: { workMulti: { regradeAmount: 0 }, bankCapacity: { regradeAmount: 0 } },
        totalEarnings: 0,
        towerChampionCount: 0,
        mercenaryBountyWinCount: 0,
        ...overrides
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('/set-title autocomplete', () => {
    test('always includes "None" first, even with no unlocked titles', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({}, '');

        await autocomplete({}, interaction);

        expect(interaction.respond).toHaveBeenCalledWith([{ name: 'None (show no title)', value: 'none' }]);
    });

    test('lists an unlocked title matching the focused text, after "None"', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ rebirthCount: 1 }));
        const interaction = fakeInteraction({}, 'reborn');

        await autocomplete({}, interaction);

        const [choices] = interaction.respond.mock.calls[0];
        expect(choices[0]).toEqual({ name: 'None (show no title)', value: 'none' });
        expect(choices.some(c => c.value === 'reborn_spud')).toBe(true);
    });

    test('never offers a not-yet-earned title', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ rebirthCount: 0 }));
        const interaction = fakeInteraction({}, 'reborn');

        await autocomplete({}, interaction);

        const [choices] = interaction.respond.mock.calls[0];
        expect(choices.some(c => c.value === 'reborn_spud')).toBe(false);
    });
});

describe('/set-title callback', () => {
    test('"none" clears the equipped title', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ equippedTitle: 'reborn_spud', rebirthCount: 1 }));
        const interaction = fakeInteraction({ title: 'none' });

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', { equippedTitle: null });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('cleared'));
    });

    test('rejects a title the player has not earned, naming it, with no DB write', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ rebirthCount: 0 }));
        const interaction = fakeInteraction({ title: 'reborn_spud' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("haven't earned"));
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('the Reborn'));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('rejects an unknown title id', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction({ title: 'not_a_real_title' });

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("doesn't exist"));
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('re-validates server-side against fresh userDetails — never trusts the client\'s earlier autocomplete selection', async () => {
        // Player earned it, so autocomplete would have offered it a moment ago — but by the
        // time the callback re-fetches, it's no longer true (never actually happens for a
        // lifetime counter in practice, but proves the callback checks live rather than
        // trusting the option value alone).
        dynamoHandler.findUser.mockResolvedValue(baseUser({ rebirthCount: 0 }));
        const interaction = fakeInteraction({ title: 'reborn_spud' });

        await callback({}, interaction);

        expect(dynamoHandler.findUser).toHaveBeenCalled();
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('equips a title the player has earned', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ rebirthCount: 1 }));
        const interaction = fakeInteraction({ title: 'reborn_spud' });

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', { equippedTitle: 'reborn_spud' });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('the Reborn'));
    });
});
