// One-time migration seeding this bot's original server's command-channel allowlist so
// /set-command-channels' rollout doesn't silently loosen it to "unrestricted" — see
// seedCommandChannels.js's own comment and systems/command-channels.md.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const seedCommandChannels = require('../seedCommandChannels');

const LEGACY_GUILD_ID = '168379467931058176';
const LEGACY_CHANNEL_IDS = ['1187561420406136843', '796873375632195605', '1188525931346792498', '1188539987118010408', '1203822914437124188'];

beforeEach(() => {
    jest.clearAllMocks();
});

describe('seedCommandChannels', () => {
    test('seeds the legacy channel list when no doc exists yet', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        dynamoHandler.updateStatFields.mockResolvedValue({});

        await seedCommandChannels(null);

        expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith(`command_channels_${LEGACY_GUILD_ID}`);
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith(`command_channels_${LEGACY_GUILD_ID}`, { channelIds: LEGACY_CHANNEL_IDS });
    });

    test('is a no-op once the doc already exists', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelIds: ['chan-1'] });

        await seedCommandChannels(null);

        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('a lookup failure is swallowed rather than crashing bot startup', async () => {
        dynamoHandler.getStatDatabase.mockRejectedValue(new Error('dynamo blip'));

        await expect(seedCommandChannels(null)).resolves.toBeUndefined();
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });
});
