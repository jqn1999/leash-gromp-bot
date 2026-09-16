const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

// Server Activity Channel (2026-09-16, direct instruction — "I want to be able to admin
// use a command to set a server activity channel and have it include things like website
// actions users are doing... but not ephemeral commands"). A single server-wide setting
// today (stored under one fixed trackingId in the stats table, same "one global doc" shape
// world_buff/spud_keep_buff already use) — the player has flagged wanting per-server/
// per-user variants later, which this trackingId-keyed shape extends into cleanly (e.g.
// `server_activity_channel_<guildId>`) without a migration, but that's explicitly deferred,
// not built now.
//
// Delivery is a Discord WEBHOOK, not a bot-side relay — the actual activity being tracked
// originates on the financial-project website (a separate AWS Lambda process, not this bot),
// so a webhook URL is the one thing that lets that Lambda post directly into this channel
// with a plain HTTP POST, no bot process/token involvement needed at request time. The
// webhook's URL is stored in the SAME stats table this bot already exposes cross-region to
// financial-project's Lambdas (see NOTES_GROMP_WEB_INTEGRATION.md) — see
// systems/server-activity-channel.md for the full read-side (web) half of this feature.
//
// Big Events Channel (same day, direct instruction — "I also want to add a more fun version
// of this which is another channel for bigger events... with a more colorful obvious embed
// color and message") — a SECOND, independently-configurable channel/webhook for standout
// moments (Golden Potato, Metal kill, Ancient Potato, and a successful Raid/Bounty/Heist
// that had under a 30% chance to win). Same command, same flow, just a second `type` this
// command can target — one shared TRACKING_IDS map rather than a second near-duplicate
// command file.
const TRACKING_IDS = {
    normal: "server_activity_channel",
    big: "server_big_events_channel",
};
const WEBHOOK_NAMES = {
    normal: "Gromp Server Activity",
    big: "Gromp Big Events",
};

module.exports = {
    name: "set-activity-channel",
    description: "Set (or clear) a channel website activity gets posted to (normal, or big/rare events)",
    devOnly: true,
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    options: [
        {
            name: 'type',
            description: 'Which channel to configure — defaults to the normal activity channel',
            required: false,
            type: ApplicationCommandOptionType.String,
            choices: [
                { name: 'Normal activity (work/raids/bounties/bank/etc.)', value: 'normal' },
                { name: 'Big/rare events (Golden Potato, Metal kills, Ancient Potatoes, long-shot wins)', value: 'big' },
            ],
        },
        {
            name: 'channel',
            description: 'The channel to post into — defaults to the channel this command is run in; ignored with disable:true',
            required: false,
            type: ApplicationCommandOptionType.Channel,
        },
        {
            name: 'disable',
            description: 'Turn off this channel entirely (deletes its webhook)',
            required: false,
            type: ApplicationCommandOptionType.Boolean,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const type = interaction.options.get('type')?.value ?? 'normal';
        // Defaults to wherever the command was actually run (2026-09-16, same follow-up as
        // /set-command-channels' own — "make same channel optional change for the activity
        // channel command"). Discord's own Channel option picker doesn't reliably surface
        // every channel client-side on a large/busy server — running this FROM the target
        // channel sidesteps that entirely rather than fighting the picker.
        const channelId = interaction.options.get('channel')?.value ?? interaction.channel.id;
        const disable = interaction.options.get('disable')?.value ?? false;
        const trackingId = TRACKING_IDS[type];
        const webhookName = WEBHOOK_NAMES[type];
        const label = type === 'big' ? 'Big events' : 'Server activity';

        // Clean up any previously-created webhook regardless of which branch runs below —
        // re-pointing to a new channel or disabling both mean the old one should stop
        // existing rather than being silently orphaned in its old channel forever.
        const existing = await dynamoHandler.getStatDatabase(trackingId);
        if (existing?.webhookId) {
            const oldWebhook = await client.fetchWebhook(existing.webhookId).catch(() => null);
            if (oldWebhook) {
                await oldWebhook.delete('Activity channel changed via /set-activity-channel').catch(() => {});
            }
        }

        if (disable) {
            await dynamoHandler.updateStatFields(trackingId, { channelId: null, webhookId: null, webhookUrl: null });
            interaction.editReply(`${label} channel disabled — nothing will post there anymore.`);
            return;
        }

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased?.()) {
            interaction.editReply(`That doesn't look like a text channel I can post in — try again.`);
            return;
        }

        let webhook;
        try {
            webhook = await channel.createWebhook({
                name: webhookName,
                reason: `${label} channel set via /set-activity-channel by ${interaction.user.tag}`,
            });
        } catch (err) {
            console.error('Failed to create activity webhook:', err);
            interaction.editReply(`Couldn't create a webhook in <#${channelId}> — I likely need Manage Webhooks permission there.`);
            return;
        }

        await dynamoHandler.updateStatFields(trackingId, {
            channelId,
            webhookId: webhook.id,
            webhookUrl: webhook.url,
        });

        interaction.editReply(type === 'big'
            ? `Big events channel set to <#${channelId}> — Golden Potatoes, Metal kills, Ancient Potatoes, and long-shot Raid/Bounty/Heist wins will post there.`
            : `Server activity channel set to <#${channelId}> — website Work/Bounty/Heist/Raid/Rob/Bank/Safehouse activity will start posting there.`);
    }
}
