// /skip-chances (2026-09-05, direct instruction — "can we get all the user's skip chances
// for all the various mechanics somewhere... a dedicated embed to make it easier"). Drives
// the real command callback end-to-end (same "mock at the boundary this command actually
// touches" approach mercenaryCompanionLeveling.test.js already uses) — dynamoHandler is
// mocked, but mercenaryFactory/spudKeepFactory/guildBuffFactory/guildCompanionFactory/
// raidFactory all stay REAL so the numbers shown are actually computed, not stubbed.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../skipChances');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: { get: () => undefined },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        isMercenary: false,
        mercenaryBountyWinCount: 0,
        guildId: 0,
        companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 },
        ...overrides,
    };
}

// dynamoHandler is fully auto-mocked (jest.mock with no factory), so
// getWorkCooldownSkipSources itself is a mock too — stub it directly with a plausible
// all-inactive baseline rather than relying on its real implementation, since the point of
// this test file is the COMMAND's own wiring/embed, not dynamoHandler's own source-gathering
// (that's covered directly in dynamoHandler.test.js).
const ZERO_WORK_SOURCES = [
    { key: 'companion', chance: 0, label: null },
    { key: 'worldBuff', chance: 0, label: null },
    { key: 'guildBuff', chance: 0, label: null },
    { key: 'spudKeep', chance: 0, label: 'Spud Keep' },
];

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);
    dynamoHandler.getActiveSpudKeepCooldownBuff.mockResolvedValue(undefined);
    dynamoHandler.getWorkCooldownSkipSources.mockResolvedValue(ZERO_WORK_SOURCES);
});

describe('/skip-chances', () => {
    test('a non-mercenary, no-guild player sees the /work section plus how-to-unlock lines for the other two', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        expect(embed.data.fields.find(f => f.name.includes('/work'))).toBeDefined();
        expect(embed.data.fields.find(f => f.name.includes('Bounty')).value).toContain('/become-mercenary');
        expect(embed.data.fields.find(f => f.name.includes('Guild Raid')).value).toContain('join or create one');
    });

    test('a mercenary sees a real Bounty/Heist combined chance, not the how-to-unlock line', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: true, mercenaryBountyWinCount: 15 })); // Rank 2
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        const field = embed.data.fields.find(f => f.name.includes('Bounty'));
        expect(field.value).not.toContain('/become-mercenary');
        expect(field.name).toMatch(/\d+% chance/);
    });

    test('a guild member sees a real Guild Raid combined chance, not the how-to-unlock line', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 'g1' }));
        dynamoHandler.findGuildById.mockResolvedValue({
            guildId: 'g1', guildName: 'Some Guild', guildBuff: 'raidTimer', raidCount: 0, guildCompanion: null,
        });
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        const field = embed.data.fields.find(f => f.name.includes('Guild Raid'));
        expect(field.value).not.toContain('join or create one');
        expect(field.name).toMatch(/\d+% chance/);
    });

    test('a player who could not be looked up gets the standard database-error reply, no embed', async () => {
        dynamoHandler.findUser.mockResolvedValue(null);
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('database error'));
    });
});
