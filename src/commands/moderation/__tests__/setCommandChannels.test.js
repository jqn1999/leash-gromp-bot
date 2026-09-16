// /set-command-channels — per-guild admin config for which channels commands can run in
// (replaces handleCommands.js's old hardcoded validChannels array). See this command's own
// comment and systems/command-channels.md for the full derivation.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../setCommandChannels');

function fakeInteraction({ action, channelId, guildId = 'guild-1' } = {}) {
    return {
        guildId,
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        options: {
            get: (name) => {
                if (name === 'action' && action !== undefined) return { value: action };
                if (name === 'channel' && channelId !== undefined) return { value: channelId };
                return undefined;
            },
        },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
    dynamoHandler.updateStatFields.mockResolvedValue({});
});

describe('/set-command-channels', () => {
    test('list with nothing configured reports unrestricted', async () => {
        const interaction = fakeInteraction({ action: 'list' });

        await callback(null, interaction);

        expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith('command_channels_guild-1');
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/any channel/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('list with channels configured names them', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1', 'chan-2'] });
        const interaction = fakeInteraction({ action: 'list' });

        await callback(null, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith('Commands are restricted to: <#chan-1>, <#chan-2>');
    });

    test('add with no prior config restricts to that one channel', async () => {
        const interaction = fakeInteraction({ action: 'add', channelId: 'chan-1' });

        await callback(null, interaction);

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('command_channels_guild-1', { channelIds: ['chan-1'] });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/now restricted to that channel/i));
    });

    test('add a second channel appends rather than replacing', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1'] });
        const interaction = fakeInteraction({ action: 'add', channelId: 'chan-2' });

        await callback(null, interaction);

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('command_channels_guild-1', { channelIds: ['chan-1', 'chan-2'] });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/also work in that channel/i));
    });

    test('adding an already-listed channel is a no-op', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1'] });
        const interaction = fakeInteraction({ action: 'add', channelId: 'chan-1' });

        await callback(null, interaction);

        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/already in the allowlist/i));
    });

    test('add without a channel asks for one', async () => {
        const interaction = fakeInteraction({ action: 'add' });

        await callback(null, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/pass `channel`/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('remove drops the channel from the allowlist', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1', 'chan-2'] });
        const interaction = fakeInteraction({ action: 'remove', channelId: 'chan-1' });

        await callback(null, interaction);

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('command_channels_guild-1', { channelIds: ['chan-2'] });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/removed from the allowlist/i));
    });

    test('removing the last channel clears the restriction entirely', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1'] });
        const interaction = fakeInteraction({ action: 'remove', channelId: 'chan-1' });

        await callback(null, interaction);

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('command_channels_guild-1', { channelIds: [] });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/work in any channel again/i));
    });

    test('removing a channel that is not listed is a no-op', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1'] });
        const interaction = fakeInteraction({ action: 'remove', channelId: 'chan-2' });

        await callback(null, interaction);

        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/isn't in the allowlist/i));
    });

    test('remove without a channel asks for one', async () => {
        const interaction = fakeInteraction({ action: 'remove' });

        await callback(null, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/pass `channel`/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('clear wipes the allowlist regardless of what was there before', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1', 'chan-2'] });
        const interaction = fakeInteraction({ action: 'clear' });

        await callback(null, interaction);

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('command_channels_guild-1', { channelIds: [] });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/work in any channel/i));
    });

    test('scopes the trackingId to the invoking guild, not a shared global doc', async () => {
        const interaction = fakeInteraction({ action: 'list', guildId: 'guild-2' });

        await callback(null, interaction);

        expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith('command_channels_guild-2');
    });
});
