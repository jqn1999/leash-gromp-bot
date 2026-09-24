// /admin — the single devOnly command consolidating 8 former top-level admin/moderation
// commands into Discord Subcommands (2026-09-20 incident fix — see roadmap.md's "Discord
// 100-command cap hit on startup" entry). Each describe block below is the former dedicated
// test file for one of those commands (adminResetTower.test.js, setActivityChannel.test.js,
// setMercChatChannel.test.js), reorganized to import that subcommand's own exported run
// function directly from `admin.js` rather than a per-file `callback` export — same
// assertions/coverage as before, just against the new file/export shape.
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../guilds/guildChat', () => ({
    ensureGuildChatCategory: jest.fn().mockResolvedValue('category-1'),
    addChatChannelIndexEntry: jest.fn().mockResolvedValue(),
    removeChatChannelIndexEntry: jest.fn().mockResolvedValue(),
}));
jest.mock('../../../utils/festivalFactory', () => ({
    startFestival: jest.fn(),
}));

const dynamoHandler = require('../../../utils/dynamoHandler');
const { addChatChannelIndexEntry, removeChatChannelIndexEntry } = require('../../guilds/guildChat');
const festivalFactory = require('../../../utils/festivalFactory');
const { resetTowerCallback, setActivityChannelCallback, setMercChatChannelCallback, startFestivalCallback } = require('../admin');

beforeEach(() => {
    jest.clearAllMocks();
});

// ---------------------------------------------------------------------------------------
// /admin reset-tower — support tool for a player stuck unable to run /enter-tower again
// (canEnterTower flipped false before a run starts, never restored if the run crashes
// partway through — see admin.js's runResetTower comment and enter-tower.js).
// ---------------------------------------------------------------------------------------
describe('/admin reset-tower', () => {
    function fakeInteraction(playerId, fullWipe = false) {
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'admin-1', username: 'Admin', displayName: 'Admin' },
            options: {
                get: (name) => (name === 'player' && playerId !== undefined ? { value: playerId } : undefined),
                getBoolean: (name) => (name === 'full-wipe' ? fullWipe : null),
            },
            guild: {
                members: {
                    fetch: jest.fn(),
                },
            },
        };
    }

    function memberFixture(overrides = {}) {
        return {
            id: 'target-1',
            displayName: 'TargetPlayer',
            user: { username: 'targetplayer' },
            ...overrides,
        };
    }

    test('rejects a player who cannot be resolved in this server', async () => {
        const interaction = fakeInteraction('target-1');
        interaction.guild.members.fetch.mockResolvedValue(null);

        await resetTowerCallback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/doesn't exist/i));
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });

    test('rejects a player with no lookup-able account', async () => {
        const interaction = fakeInteraction('target-1');
        interaction.guild.members.fetch.mockResolvedValue(memberFixture());
        dynamoHandler.findUser.mockResolvedValue(null);

        await resetTowerCallback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/database error/i));
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });

    test('resets a player genuinely stuck with canEnterTower: false', async () => {
        const interaction = fakeInteraction('target-1');
        interaction.guild.members.fetch.mockResolvedValue(memberFixture());
        dynamoHandler.findUser.mockResolvedValue({ userId: 'target-1', username: 'targetplayer', canEnterTower: false });

        await resetTowerCallback({}, interaction);

        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('target-1', 'canEnterTower', true);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/reset.*can run \/enter-tower again/i));
    });

    test('still confirms (without implying anything was stuck) for a player who could already enter', async () => {
        const interaction = fakeInteraction('target-1');
        interaction.guild.members.fetch.mockResolvedValue(memberFixture());
        dynamoHandler.findUser.mockResolvedValue({ userId: 'target-1', username: 'targetplayer', canEnterTower: true });

        await resetTowerCallback({}, interaction);

        // Still idempotently (re-)sets the field — cheap, and avoids trusting a possibly
        // stale read as proof nothing needs writing.
        expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('target-1', 'canEnterTower', true);
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/nothing was stuck/i));
    });

    // full-wipe (2026-09-24, direct instruction) — beyond just unlocking re-entry, also
    // reverts the potatoes/stats a survived Tower run credited today, sourced from that
    // player's own entry in today's tower_leaderboard batch.
    describe('full-wipe option', () => {
        test('reports nothing to revert when the player has no leaderboard entry today, but still unlocks re-entry', async () => {
            const interaction = fakeInteraction('target-1', true);
            interaction.guild.members.fetch.mockResolvedValue(memberFixture());
            dynamoHandler.findUser.mockResolvedValue({
                userId: 'target-1', username: 'targetplayer', canEnterTower: false,
                sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
            });
            dynamoHandler.removeTowerLeaderboardEntry.mockResolvedValue(null);

            await resetTowerCallback({}, interaction);

            expect(dynamoHandler.removeTowerLeaderboardEntry).toHaveBeenCalledWith('target-1');
            expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
            expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/nothing to revert/i));
            expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('target-1', 'canEnterTower', true);
        });

        test('reverts the exact potatoes/stats a leaderboard entry credited and removes the entry', async () => {
            const interaction = fakeInteraction('target-1', true);
            interaction.guild.members.fetch.mockResolvedValue(memberFixture());
            dynamoHandler.findUser.mockResolvedValue({
                userId: 'target-1', username: 'targetplayer', canEnterTower: false,
                sweetPotatoBuffs: { workMultiplierAmount: 5, passiveAmount: 100000, bankCapacity: 200000 },
            });
            dynamoHandler.removeTowerLeaderboardEntry.mockResolvedValue({
                userId: 'target-1', username: 'targetplayer', floor: 30, elitesKilled: 2,
                potatoes: 50000, workMultiplier: 0.2, passiveIncome: 20000, bankCapacity: 30000,
            });

            await resetTowerCallback({}, interaction);

            expect(dynamoHandler.removeTowerLeaderboardEntry).toHaveBeenCalledWith('target-1');
            expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('target-1',
                { sweetPotatoBuffs: { workMultiplierAmount: 4.8, passiveAmount: 80000, bankCapacity: 170000 } },
                { potatoes: -50000, totalEarnings: -50000, workMultiplierAmount: -0.2, passiveAmount: -20000, bankCapacity: -30000 }
            );
            expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/floor 30.*50,000 potatoes/is));
            expect(dynamoHandler.updateUserDatabase).toHaveBeenCalledWith('target-1', 'canEnterTower', true);
        });

        test('a stat-less entry (e.g. only potatoes earned) reverts cleanly without NaN in the sweetPotatoBuffs correction', async () => {
            const interaction = fakeInteraction('target-1', true);
            interaction.guild.members.fetch.mockResolvedValue(memberFixture());
            dynamoHandler.findUser.mockResolvedValue({
                userId: 'target-1', username: 'targetplayer', canEnterTower: false,
                sweetPotatoBuffs: { workMultiplierAmount: 1, passiveAmount: 2, bankCapacity: 3 },
            });
            dynamoHandler.removeTowerLeaderboardEntry.mockResolvedValue({
                userId: 'target-1', username: 'targetplayer', floor: 10, elitesKilled: 0,
                potatoes: 5000, workMultiplier: 0, passiveIncome: 0, bankCapacity: 0,
            });

            await resetTowerCallback({}, interaction);

            expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('target-1',
                { sweetPotatoBuffs: { workMultiplierAmount: 1, passiveAmount: 2, bankCapacity: 3 } },
                { potatoes: -5000, totalEarnings: -5000, workMultiplierAmount: -0, passiveAmount: -0, bankCapacity: -0 }
            );
        });

        test('does not attempt a wipe at all when full-wipe is omitted (default false)', async () => {
            const interaction = fakeInteraction('target-1');
            interaction.guild.members.fetch.mockResolvedValue(memberFixture());
            dynamoHandler.findUser.mockResolvedValue({ userId: 'target-1', username: 'targetplayer', canEnterTower: false });

            await resetTowerCallback({}, interaction);

            expect(dynamoHandler.removeTowerLeaderboardEntry).not.toHaveBeenCalled();
            expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        });
    });
});

// ---------------------------------------------------------------------------------------
// /admin set-activity-channel — admin config for the Server Activity Channel (website
// Work/Bounty/Heist/Raid/Rob/Bank/Safehouse activity, delivered via a Discord webhook the
// financial-project Lambdas post to directly — see admin.js's runSetActivityChannel comment
// and systems/server-activity-channel.md for the full read-side derivation).
// ---------------------------------------------------------------------------------------
describe('/admin set-activity-channel', () => {
    function fakeInteraction({ channelId, disable, type, currentChannelId = 'current-chan' } = {}) {
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'admin-1', tag: 'Admin#0001', username: 'Admin' },
            channel: { id: currentChannelId },
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
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        dynamoHandler.updateStatFields.mockResolvedValue({});
    });

    test('with no channel and no disable, defaults to the channel the command was run in', async () => {
        const interaction = fakeInteraction({ currentChannelId: 'chan-here' });
        const client = fakeClient();

        await setActivityChannelCallback(client, interaction);

        expect(client.channels.fetch).toHaveBeenCalledWith('chan-here');
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', expect.objectContaining({ channelId: 'chan-here' }));
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('<#chan-here>'));
    });

    test('sets a new activity channel and creates a webhook in it', async () => {
        const interaction = fakeInteraction({ channelId: 'chan-1' });
        const client = fakeClient();

        await setActivityChannelCallback(client, interaction);

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

        await setActivityChannelCallback(client, interaction);

        expect(client.fetchWebhook).toHaveBeenCalledWith('wh-old');
        expect(oldWebhook.delete).toHaveBeenCalled();
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', expect.objectContaining({ channelId: 'chan-new' }));
    });

    test('a missing old webhook (already deleted manually) does not block setting a new one', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-gone', webhookUrl: 'https://gone' });
        const interaction = fakeInteraction({ channelId: 'chan-new' });
        const client = fakeClient();
        client.fetchWebhook.mockResolvedValue(null);

        await setActivityChannelCallback(client, interaction);

        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', expect.objectContaining({ channelId: 'chan-new' }));
    });

    test('disable:true clears the config and deletes the existing webhook, without creating a new one', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-old', webhookUrl: 'https://old' });
        const oldWebhook = { delete: jest.fn().mockResolvedValue() };
        const interaction = fakeInteraction({ disable: true });
        const client = fakeClient({ fetchWebhookResult: oldWebhook });

        await setActivityChannelCallback(client, interaction);

        expect(oldWebhook.delete).toHaveBeenCalled();
        expect(client.channels.fetch).not.toHaveBeenCalled();
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', { channelId: null, webhookId: null, webhookUrl: null });
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/disabled/i));
    });

    test('disable:true with nothing previously configured is a clean no-op-ish clear', async () => {
        const interaction = fakeInteraction({ disable: true });
        const client = fakeClient();

        await setActivityChannelCallback(client, interaction);

        expect(client.fetchWebhook).not.toHaveBeenCalled();
        expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', { channelId: null, webhookId: null, webhookUrl: null });
    });

    test('rejects a channel that cannot be fetched at all', async () => {
        const interaction = fakeInteraction({ channelId: 'chan-bad' });
        const client = fakeClient({ fetchChannelResult: null });

        await setActivityChannelCallback(client, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/doesn't look like a text channel/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('rejects a non-text channel (e.g. a voice channel)', async () => {
        const interaction = fakeInteraction({ channelId: 'chan-voice' });
        const client = fakeClient({ fetchChannelResult: { isTextBased: () => false } });

        await setActivityChannelCallback(client, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/doesn't look like a text channel/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    test('reports a clear error when webhook creation fails (e.g. missing Manage Webhooks)', async () => {
        const interaction = fakeInteraction({ channelId: 'chan-1' });
        const client = fakeClient({ createWebhookError: new Error('Missing Permissions') });

        await setActivityChannelCallback(client, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/couldn't create a webhook/i));
        expect(dynamoHandler.updateStatFields).not.toHaveBeenCalled();
    });

    describe('type: "big" (Big Events channel)', () => {
        test('sets a new big events channel under its own trackingId/webhook name', async () => {
            const interaction = fakeInteraction({ channelId: 'chan-1', type: 'big' });
            const client = fakeClient();

            await setActivityChannelCallback(client, interaction);

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

            await setActivityChannelCallback(client, interaction);

            const channel = await client.channels.fetch.mock.results[0].value;
            expect(channel.createWebhook).toHaveBeenCalledWith(expect.objectContaining({ name: 'Gromp Big Events' }));
        });

        test('does not touch the normal activity channel config when setting the big events channel', async () => {
            const interaction = fakeInteraction({ channelId: 'chan-1', type: 'big' });
            const client = fakeClient();

            await setActivityChannelCallback(client, interaction);

            expect(dynamoHandler.getStatDatabase).not.toHaveBeenCalledWith('server_activity_channel');
            expect(dynamoHandler.updateStatFields).not.toHaveBeenCalledWith('server_activity_channel', expect.anything());
        });

        test('deletes the previously-configured big events webhook before creating a new one', async () => {
            dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-old', webhookUrl: 'https://old' });
            const oldWebhook = { delete: jest.fn().mockResolvedValue() };
            const interaction = fakeInteraction({ channelId: 'chan-new', type: 'big' });
            const client = fakeClient({ fetchWebhookResult: oldWebhook });

            await setActivityChannelCallback(client, interaction);

            expect(client.fetchWebhook).toHaveBeenCalledWith('wh-old');
            expect(oldWebhook.delete).toHaveBeenCalled();
            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_big_events_channel', expect.objectContaining({ channelId: 'chan-new' }));
        });

        test('disable:true clears the big events config and deletes its webhook', async () => {
            dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-old', webhookId: 'wh-old', webhookUrl: 'https://old' });
            const oldWebhook = { delete: jest.fn().mockResolvedValue() };
            const interaction = fakeInteraction({ disable: true, type: 'big' });
            const client = fakeClient({ fetchWebhookResult: oldWebhook });

            await setActivityChannelCallback(client, interaction);

            expect(oldWebhook.delete).toHaveBeenCalled();
            expect(client.channels.fetch).not.toHaveBeenCalled();
            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_big_events_channel', { channelId: null, webhookId: null, webhookUrl: null });
            expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/big events channel disabled/i));
        });

        test('omitting type defaults to the normal channel, not big events', async () => {
            const interaction = fakeInteraction({ channelId: 'chan-1' });
            const client = fakeClient();

            await setActivityChannelCallback(client, interaction);

            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('server_activity_channel', expect.objectContaining({ channelId: 'chan-1' }));
            expect(dynamoHandler.updateStatFields).not.toHaveBeenCalledWith('server_big_events_channel', expect.anything());
        });
    });
});

// ---------------------------------------------------------------------------------------
// /admin set-merc-chat-channel — admin provisioning for the Merc Faction Hall
// (systems/guilds.md#the-merc-faction-hall), mirroring set-activity-channel's exact shape.
// ---------------------------------------------------------------------------------------
describe('/admin set-merc-chat-channel', () => {
    function fakeDiscordGuild() {
        const role = { id: 'merc-role-1', delete: jest.fn().mockResolvedValue() };
        const channel = { id: 'merc-chan-1', createWebhook: jest.fn().mockResolvedValue({ id: 'wh-1', url: 'https://discord.com/api/webhooks/wh-1/token' }) };
        return {
            id: 'physical-server-1',
            roles: { create: jest.fn().mockResolvedValue(role), delete: jest.fn().mockResolvedValue() },
            channels: { create: jest.fn().mockResolvedValue(channel) },
            members: { fetch: jest.fn().mockResolvedValue({ roles: { add: jest.fn().mockResolvedValue(), remove: jest.fn().mockResolvedValue() } }) },
            _role: role,
            _channel: channel,
        };
    }

    function fakeInteraction({ disable } = {}) {
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'admin-1', tag: 'Admin#0001' },
            guild: fakeDiscordGuild(),
            options: { get: (name) => (name === 'disable' && disable !== undefined ? { value: disable } : undefined) },
        };
    }

    beforeEach(() => {
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
        dynamoHandler.updateStatFields.mockResolvedValue({});
        dynamoHandler.getUsers.mockResolvedValue([
            { userId: 'merc-1', isMercenary: true },
            { userId: 'nonmerc-1', isMercenary: false },
        ]);
    });

    describe('setup', () => {
        test('provisions the role/channel/webhook and grants the role to every current mercenary only', async () => {
            const interaction = fakeInteraction();
            const client = {};

            await setMercChatChannelCallback(client, interaction);

            expect(interaction.guild.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Merc Faction Access' }));
            expect(interaction.guild.members.fetch).toHaveBeenCalledWith('merc-1');
            expect(interaction.guild.members.fetch).not.toHaveBeenCalledWith('nonmerc-1');
            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('merc_faction_chat_channel', {
                channelId: 'merc-chan-1', roleId: 'merc-role-1', webhookId: 'wh-1', webhookUrl: 'https://discord.com/api/webhooks/wh-1/token',
            });
            expect(addChatChannelIndexEntry).toHaveBeenCalledWith('merc-chan-1', { scopeType: 'merc' });
            expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('merc-chan-1'));
        });

        test('refuses to re-provision an already-existing Hall', async () => {
            dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'merc-chan-existing', roleId: 'role-x' });
            const interaction = fakeInteraction();

            await setMercChatChannelCallback({}, interaction);

            expect(interaction.guild.roles.create).not.toHaveBeenCalled();
            expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('already exists'));
        });
    });

    describe('disable', () => {
        test('tears down the channel/webhook/role and clears the stored doc', async () => {
            dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'merc-chan-1', roleId: 'merc-role-1', webhookId: 'wh-1' });
            const interaction = fakeInteraction({ disable: true });
            const channel = { delete: jest.fn().mockResolvedValue() };
            const webhook = { delete: jest.fn().mockResolvedValue() };
            const client = { channels: { fetch: jest.fn().mockResolvedValue(channel) }, fetchWebhook: jest.fn().mockResolvedValue(webhook) };

            await setMercChatChannelCallback(client, interaction);

            expect(channel.delete).toHaveBeenCalled();
            expect(webhook.delete).toHaveBeenCalled();
            expect(interaction.guild.roles.delete).toHaveBeenCalledWith('merc-role-1');
            expect(removeChatChannelIndexEntry).toHaveBeenCalledWith('merc-chan-1');
            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('merc_faction_chat_channel', { channelId: null, roleId: null, webhookId: null, webhookUrl: null });
        });

        test('disabling with nothing configured is a clean no-op-ish clear', async () => {
            dynamoHandler.getStatDatabase.mockResolvedValue(undefined);
            const interaction = fakeInteraction({ disable: true });
            const client = { channels: { fetch: jest.fn() }, fetchWebhook: jest.fn() };

            await setMercChatChannelCallback(client, interaction);

            expect(client.channels.fetch).not.toHaveBeenCalled();
            expect(dynamoHandler.updateStatFields).toHaveBeenCalledWith('merc_faction_chat_channel', { channelId: null, roleId: null, webhookId: null, webhookUrl: null });
        });
    });
});

// ---------------------------------------------------------------------------------------
// /admin start-festival — folded in from the standalone adminStartFestival.js built in
// Seasonal Festivals' isolated worktree (admin.js didn't exist there yet); this is that
// command's first test coverage, same shape as the trigger-event/set-activity-channel
// describe blocks above (fake interaction options + a fake client.channels.fetch/send).
// ---------------------------------------------------------------------------------------
describe('/admin start-festival', () => {
    function fakeInteraction({ festival, announce } = {}) {
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            options: {
                get: (name) => {
                    if (name === 'festival' && festival !== undefined) return { value: festival };
                    if (name === 'announce' && announce !== undefined) return { value: announce };
                    return undefined;
                },
            },
        };
    }

    function fakeClient() {
        const channel = { send: jest.fn().mockResolvedValue() };
        return { channels: { fetch: jest.fn().mockResolvedValue(channel) }, __channel: channel };
    }

    test('rejects an unrecognized festival id without touching festivalFactory further', async () => {
        festivalFactory.startFestival.mockResolvedValue(null);
        const interaction = fakeInteraction({ festival: 'not_a_festival' });
        const client = fakeClient();

        await startFestivalCallback(client, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/isn't a recognized festival/i));
        expect(client.channels.fetch).not.toHaveBeenCalled();
    });

    // Every season is always exactly 1 week (2026-09-21) — no duration option to pass anymore.
    test('starts a festival for the fixed 1-week duration and announces it by default', async () => {
        const now = Date.now();
        festivalFactory.startFestival.mockResolvedValue({ festivalId: 'harvest_festival', startsAt: now, endsAt: now + 7 * 24 * 60 * 60 * 1000 });
        const interaction = fakeInteraction({ festival: 'harvest_festival' });
        const client = fakeClient();

        await startFestivalCallback(client, interaction);

        expect(festivalFactory.startFestival).toHaveBeenCalledWith('harvest_festival');
        expect(client.channels.fetch).toHaveBeenCalledWith('1188525931346792498');
        expect(client.__channel.send).toHaveBeenCalledWith(expect.stringContaining('Harvest Festival'));
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('announced'));
    });

    test('announce:false starts the festival without posting anything', async () => {
        const now = Date.now();
        festivalFactory.startFestival.mockResolvedValue({ festivalId: 'frost_fair', startsAt: now, endsAt: now + 7 * 24 * 60 * 60 * 1000 });
        const interaction = fakeInteraction({ festival: 'frost_fair', announce: false });
        const client = fakeClient();

        await startFestivalCallback(client, interaction);

        expect(client.channels.fetch).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no announcement sent'));
    });
});
