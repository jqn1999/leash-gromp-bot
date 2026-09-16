// /set-activity-channel — admin config for the Server Activity Channel (website
// Work/Bounty/Heist/Raid/Rob/Bank/Safehouse activity, delivered via a Discord webhook the
// financial-project Lambdas post to directly — see this command's own comment and
// systems/server-activity-channel.md for the full read-side derivation).
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../setActivityChannel');

function fakeInteraction({ channelId, disable, type } = {}) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'admin-1', tag: 'Admin#0001', username: 'Admin' },
        options: {
            get: (name) => {
                if (name === 'channel' && channelId !== undefined) return { value: channelId };
                if (name === 'disable' && disable !== undefined) return { value: disable };
                if (name === 'type' && type !== undefined) return { value: type };
                return undefined;
            },
        },
    };
}

function fakeClient({ fetchChannelResult, createWebhookResult, createWebhookError, fetchWebhookResult } = {}) {
    const channel = fetchChannelResult === null ? null : {
        isTextBased: () => true,
        createWebhook: createWebhookError
            ? jest.fn().mockRejectedValue(createWebhookError)
            : jest.fn().mockResolvedValue(createWebhookResult ?? { id: 'wh-new', url: 'https://discord.com/api/webhooks/wh-new/token' }),
        ...fetchChannelResult,
    };
    return {
        channels: { fetch: jest.fn().mockResolvedValue(channel) },
        fetchWebhook: jest.fn().mockResolvedValue(fetchWebhookResult ?? { delete: jest.fn().mockResolvedValue() }),
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
    dynamoHandler.updateStatFields.mockResolvedValue({});
});

describe('/set-activity-channel', () => {
    test('rejects with neither a channel nor disable:true', async () => {
        const interaction = fakeInteraction({});
        const client = fakeClient();

        await callback(client, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/pass `channel`/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('sets a new activity channel and creates a webhook in it', async () => {
        const interaction = fakeInteraction({ channelId: 'chan-1' });
        const client = fakeClient();

        await callback(client, interaction);

        expect(client.channels.fetch).toHaveBeenCalledWith('chan-1');
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', {
            channelId: 'chan-1',
            webhookId: 'wh-new',
            webhookUrl: 'https://discord.com/api/webhooks/wh-new/token',
        });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('<#chan-1>'));
    });

    test('deletes the previously-configured webhook before creating a new one', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-old', webhookUrl: 'https://old' });
        const oldWebhook = { delete: jest.fn().mockResolvedValue() };
        const interaction = fakeInteraction({ channelId: 'chan-new' });
        const client = fakeClient({ fetchWebhookResult: oldWebhook });

        await callback(client, interaction);

        expect(client.fetchWebhook).toHaveBeenCalledWith('wh-old');
        expect(oldWebhook.delete).toHaveBeenCalled();
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', expect.objectContaining({ channelId: 'chan-new' }));
    });

    test('a missing old webhook (already deleted manually) does not block setting a new one', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-gone', webhookUrl: 'https://gone' });
        const interaction = fakeInteraction({ channelId: 'chan-new' });
        const client = fakeClient();
        client.fetchWebhook.mockResolvedValue(null);

        await callback(client, interaction);

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', expect.objectContaining({ channelId: 'chan-new' }));
    });

    test('disable:true clears the config and deletes the existing webhook, without creating a new one', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-old', webhookUrl: 'https://old' });
        const oldWebhook = { delete: jest.fn().mockResolvedValue() };
        const interaction = fakeInteraction({ disable: true });
        const client = fakeClient({ fetchWebhookResult: oldWebhook });

        await callback(client, interaction);

        expect(oldWebhook.delete).toHaveBeenCalled();
        expect(client.channels.fetch).not.toHaveBeenCalled();
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', { channelId: null, webhookId: null, webhookUrl: null });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/disabled/i));
    });

    test('disable:true with nothing previously configured is a clean no-op-ish clear', async () => {
        const interaction = fakeInteraction({ disable: true });
        const client = fakeClient();

        await callback(client, interaction);

        expect(client.fetchWebhook).not.toHaveBeenCalled();
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', { channelId: null, webhookId: null, webhookUrl: null });
    });

    test('rejects a channel that cannot be fetched at all', async () => {
        const interaction = fakeInteraction({ channelId: 'chan-bad' });
        const client = fakeClient({ fetchChannelResult: null });

        await callback(client, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/doesn't look like a text channel/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('rejects a non-text channel (e.g. a voice channel)', async () => {
        const interaction = fakeInteraction({ channelId: 'chan-voice' });
        const client = fakeClient({ fetchChannelResult: { isTextBased: () => false } });

        await callback(client, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/doesn't look like a text channel/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('reports a clear error when webhook creation fails (e.g. missing Manage Webhooks)', async () => {
        const interaction = fakeInteraction({ channelId: 'chan-1' });
        const client = fakeClient({ createWebhookError: new Error('Missing Permissions') });

        await callback(client, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/couldn't create a webhook/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    describe('type: "big" (Big Events channel)', () => {
        test('sets a new big events channel under its own trackingId/webhook name', async () => {
            const interaction = fakeInteraction({ channelId: 'chan-1', type: 'big' });
            const client = fakeClient();

            await callback(client, interaction);

            expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith('server_big_events_channel');
            expect(client.channels.fetch).toHaveBeenCalledWith('chan-1');
            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_big_events_channel', {
                channelId: 'chan-1',
                webhookId: 'wh-new',
                webhookUrl: 'https://discord.com/api/webhooks/wh-new/token',
            });
            expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('<#chan-1>'));
            expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/golden potatoes/i));
        });

        test('creates the webhook with the "Gromp Big Events" name', async () => {
            const interaction = fakeInteraction({ channelId: 'chan-1', type: 'big' });
            const client = fakeClient();

            await callback(client, interaction);

            const channel = await client.channels.fetch.mock.results[0].value;
            expect(channel.createWebhook).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gromp Big Events' }));
        });

        test('does not touch the normal activity channel config when setting the big events channel', async () => {
            const interaction = fakeInteraction({ channelId: 'chan-1', type: 'big' });
            const client = fakeClient();

            await callback(client, interaction);

            expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalledWith('server_activity_channel');
            expect(dynamoHandler.updateStatFields).not.toHaveBeenCalledWith('server_activity_channel', expect.anything());
        });

        test('deletes the previously-configured big events webhook before creating a new one', async () => {
            dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-old', webhookUrl: 'https://old' });
            const oldWebhook = { delete: jest.fn().mockResolvedValue() };
            const interaction = fakeInteraction({ channelId: 'chan-new', type: 'big' });
            const client = fakeClient({ fetchWebhookResult: oldWebhook });

            await callback(client, interaction);

            expect(client.fetchWebhook).toHaveBeenCalledWith('wh-old');
            expect(oldWebhook.delete).toHaveBeenCalled();
            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_big_events_channel', expect.objectContaining({ channelId: 'chan-new' }));
        });

        test('disable:true clears the big events config and deletes its webhook', async () => {
            dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-old', webhookUrl: 'https://old' });
            const oldWebhook = { delete: jest.fn().mockResolvedValue() };
            const interaction = fakeInteraction({ disable: true, type: 'big' });
            const client = fakeClient({ fetchWebhookResult: oldWebhook });

            await callback(client, interaction);

            expect(oldWebhook.delete).toHaveBeenCalled();
            expect(client.channels.fetch).not.toHaveBeenCalled();
            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_big_events_channel', { channelId: null, webhookId: null, webhookUrl: null });
            expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/big events channel disabled/i));
        });

        test('omitting type defaults to the normal channel, not big events', async () => {
            const interaction = fakeInteraction({ channelId: 'chan-1' });
            const client = fakeClient();

            await callback(client, interaction);

            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', expect.objectContaining({ channelId: 'chan-1' }));
            expect(dynamoHandler.updateStatFields).not.toHaveBeenCalledWith('server_big_events_channel', expect.anything());
        });
    });
});
