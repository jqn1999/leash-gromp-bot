// handleCommands.js's per-guild channel-restriction gate (2026-09-16, direct instruction —
// "make it a per guild admin-configurable setting that stores valid channels in the
// dynamodb"). Covers only that gate — see setCommandChannels.js's own tests for the
// command that manages it, and systems/command-channels.md for the full derivation.
jest.mock('../../../utils/getLocalCommands');
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/dailyStreakFactory');
jest.mock('../../../utils/achievementFactory');

const getLocalCommands = require('../../../utils/getLocalCommands');
const dynamoHandler = require('../../../utils/dynamoHandler');
const handleCommands = require('../handleCommands');

function fakeCommand(overrides = {}) {
    return {
        name: 'work',
        callback: jest.fn().mockResolvedValue(),
        ...overrides,
    };
}

function fakeInteraction({ guildId = 'guild-1', channelId = 'chan-1', commandName = 'work' } = {}) {
    return {
        isAutocomplete: () => false,
        isChatInputCommand: true,
        member: { id: 'user-1', permissions: { has: () => true } },
        user: { id: 'user-1', username: 'tester', displayName: 'Tester' },
        guildId,
        channel: { id: channelId },
        commandName,
        deferred: false,
        replied: false,
        reply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.findUser.mockResolvedValue(null);
    dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
});

describe('handleCommands channel restriction', () => {
    test('runs the command when no allowlist is configured for the guild', async () => {
        const command = fakeCommand();
        getLocalCommands.mockReturnValue([command]);
        const interaction = fakeInteraction();

        await handleCommands(null, interaction);

        expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith('command_channels_guild-1');
        expect(command.callback).toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    test('blocks the command when the channel is not on a configured allowlist', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-other'] });
        const command = fakeCommand();
        getLocalCommands.mockReturnValue([command]);
        const interaction = fakeInteraction({ channelId: 'chan-1' });

        await handleCommands(null, interaction);

        expect(command.callback).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'This channel is not registered to run commands!',
        }));
    });

    test('runs the command when the channel IS on the configured allowlist', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1', 'chan-2'] });
        const command = fakeCommand();
        getLocalCommands.mockReturnValue([command]);
        const interaction = fakeInteraction({ channelId: 'chan-2' });

        await handleCommands(null, interaction);

        expect(command.callback).toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    test('set-command-channels itself bypasses the restriction from a non-allowlisted channel', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-other'] });
        const command = fakeCommand({ name: 'set-command-channels' });
        getLocalCommands.mockReturnValue([command]);
        const interaction = fakeInteraction({ channelId: 'chan-1', commandName: 'set-command-channels' });

        await handleCommands(null, interaction);

        // Maintenance-mode's own doc (2026-09-30) is still checked ahead of this gate — only
        // the channel-restriction's own doc is skipped by the set-command-channels bypass.
        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalledWith('command_channels_guild-1');
        expect(command.callback).toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    test('blocks a DM interaction (no guildId) the same way the old hardcoded list always did', async () => {
        const command = fakeCommand();
        getLocalCommands.mockReturnValue([command]);
        const interaction = fakeInteraction({ guildId: null });

        await handleCommands(null, interaction);

        // Maintenance-mode's own doc (2026-09-30) is still checked ahead of this gate — a DM
        // interaction just never reaches the channel-restriction's OWN doc lookup.
        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalledWith(expect.stringMatching(/^command_channels_/));
        expect(command.callback).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: 'This channel is not registered to run commands!',
        }));
    });
});

// Global maintenance-mode kill switch (2026-09-30, direct instruction: "Give me an admin
// discord command to disable the bot for everyone besides admin as well") — checked ahead of
// every other gate in handleCommands.js. See admin.js's own runMaintenanceMode for the
// command that toggles this same doc.
describe('handleCommands maintenance mode', () => {
    test('blocks a non-dev with a maintenance message when maintenance mode is on', async () => {
        dynamoHandler.getStatDatabase.mockImplementation(async (trackingId) =>
            trackingId === 'bot_maintenance_mode' ? { enabled: true } : undefined);
        const command = fakeCommand();
        getLocalCommands.mockReturnValue([command]);
        const interaction = fakeInteraction();

        await handleCommands(null, interaction);

        expect(command.callback).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
            content: expect.stringMatching(/maintenance mode/i),
        }));
    });

    test('a developer (awsConfigurations.devs) bypasses maintenance mode entirely — no doc lookup at all', async () => {
        const { awsConfigurations } = require('../../../utils/constants');
        dynamoHandler.getStatDatabase.mockImplementation(async (trackingId) =>
            trackingId === 'bot_maintenance_mode' ? { enabled: true } : undefined);
        const command = fakeCommand();
        getLocalCommands.mockReturnValue([command]);
        const interaction = fakeInteraction();
        interaction.member.id = awsConfigurations.devs[0];

        await handleCommands(null, interaction);

        expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalledWith('bot_maintenance_mode');
        expect(command.callback).toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });

    test('a non-dev runs normally when maintenance mode is off', async () => {
        dynamoHandler.getStatDatabase.mockImplementation(async (trackingId) =>
            trackingId === 'bot_maintenance_mode' ? { enabled: false } : undefined);
        const command = fakeCommand();
        getLocalCommands.mockReturnValue([command]);
        const interaction = fakeInteraction();

        await handleCommands(null, interaction);

        expect(command.callback).toHaveBeenCalled();
        expect(interaction.reply).not.toHaveBeenCalled();
    });
});
