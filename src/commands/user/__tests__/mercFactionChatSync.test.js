// Merc Faction Hall membership-sync hooks (systems/guilds.md#the-merc-faction-hall) —
// /become-mercenary grants the shared Merc Faction Access role, /retire-mercenary removes
// it. Both are silent no-ops if /set-merc-chat-channel was never run (no role to sync).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');

function fakeGuildMember(fetchable = true) {
    if (!fetchable) return null;
    return { roles: { add: jest.fn().mockResolvedValue(), remove: jest.fn().mockResolvedValue() } };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue({});
});

describe('/become-mercenary grants the Merc Faction Hall role', () => {
    const { callback } = require('../becomeMercenary');

    function fakeInteraction(guildMember) {
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'user-1', username: 'User', displayName: 'User' },
            guild: { members: { fetch: jest.fn().mockResolvedValue(guildMember) } },
        };
    }

    test('grants the Hall role when the Hall has been provisioned', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 0, isMercenary: false, guildMercenarySwitchTimer: 0 });
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-1', roleId: 'merc-role-1' });
        const guildMember = fakeGuildMember();
        const interaction = fakeInteraction(guildMember);

        await callback({}, interaction);

        expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith('merc_faction_chat_channel');
        expect(interaction.guild.members.fetch).toHaveBeenCalledWith('user-1');
        expect(guildMember.roles.add).toHaveBeenCalledWith('merc-role-1');
    });

    test('is a silent no-op when the Merc Faction Hall was never provisioned', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 0, isMercenary: false, guildMercenarySwitchTimer: 0 });
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        const interaction = fakeInteraction(null);

        await callback({}, interaction);

        expect(interaction.guild.members.fetch).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("you're now a mercenary"));
    });

    test('a member who cannot be fetched is skipped, not a hard failure', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 0, isMercenary: false, guildMercenarySwitchTimer: 0 });
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-1', roleId: 'merc-role-1' });
        const interaction = fakeInteraction(null);

        await expect(callback({}, interaction)).resolves.toBeUndefined();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining("you're now a mercenary"));
    });

    test('never grants the role when becoming a mercenary is itself rejected (already in a guild)', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 'g1', isMercenary: false, guildMercenarySwitchTimer: 0 });
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-1', roleId: 'merc-role-1' });
        const interaction = fakeInteraction(fakeGuildMember());

        await callback({}, interaction);

        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalled();
        expect(interaction.guild.members.fetch).not.toHaveBeenCalled();
    });
});

describe('/retire-mercenary removes the Merc Faction Hall role', () => {
    const { callback } = require('../retireMercenary');

    function fakeInteraction({ guildMember, awaitResult } = {}) {
        const confirmation = awaitResult ?? { deferUpdate: jest.fn().mockResolvedValue(), customId: 'retire_mercenary_confirm' };
        const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(confirmation) };
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(reply),
            followUp: jest.fn().mockResolvedValue(),
            user: { id: 'user-1', username: 'User', displayName: 'User', avatar: 'hash' },
            guild: { members: { fetch: jest.fn().mockResolvedValue(guildMember ?? null) } },
        };
    }

    test('removes the Hall role once retirement is confirmed', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', isMercenary: true });
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-1', roleId: 'merc-role-1' });
        const guildMember = fakeGuildMember();
        const interaction = fakeInteraction({ guildMember });

        await callback({}, interaction);

        expect(interaction.guild.members.fetch).toHaveBeenCalledWith('user-1');
        expect(guildMember.roles.remove).toHaveBeenCalledWith('merc-role-1');
    });

    test('a cancelled retirement never touches Discord roles', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', isMercenary: true });
        const interaction = fakeInteraction({ awaitResult: { customId: 'retire_mercenary_cancel', update: jest.fn().mockResolvedValue() } });

        await callback({}, interaction);

        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalledWith('merc_faction_chat_channel');
        expect(interaction.guild.members.fetch).not.toHaveBeenCalled();
    });

    test('is a silent no-op when the Merc Faction Hall was never provisioned', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', isMercenary: true });
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.guild.members.fetch).not.toHaveBeenCalled();
    });
});
