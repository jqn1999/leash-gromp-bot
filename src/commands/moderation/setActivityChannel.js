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
const TRACKING_ID = "server_activity_channel";
const WEBHOOK_NAME = "Gromp Server Activity";

module.exports = {
    name: "set-activity-channel",
    description: "Set (or clear) the channel website activity (work/raids/bounties/bank/etc.) gets posted to",
    devOnly: true,
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    options: [
        {
            name: 'channel',
            description: 'The channel to post website activity into — omit along with disable:true to clear it',
            required: false,
            type: ApplicationCommandOptionType.Channel,
        },
        {
            name: 'disable',
            description: 'Turn off the server activity channel entirely (deletes the webhook)',
            required: false,
            type: ApplicationCommandOptionType.Boolean,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const channelId = interaction.options.get('channel')?.value;
        const disable = interaction.options.get('disable')?.value ?? false;

        if (!disable && !channelId) {
            interaction.editReply(`Pass \`channel\` to set the activity channel, or \`disable: true\` to turn it off.`);
            return;
        }

        // Clean up any previously-created webhook regardless of which branch runs below —
        // re-pointing to a new channel or disabling both mean the old one should stop
        // existing rather than being silently orphaned in its old channel forever.
        const existing = await dynamoHandler.getStatDatabase(TRACKING_ID);
        if (existing?.webhookId) {
            const oldWebhook = await client.fetchWebhook(existing.webhookId).catch(() => null);
            if (oldWebhook) {
                await oldWebhook.delete('Server activity channel changed via /set-activity-channel').catch(() => {});
            }
        }

        if (disable) {
            await dynamoHandler.updateStatFields(TRACKING_ID, { channelId: null, webhookId: null, webhookUrl: null });
            interaction.editReply(`Server activity channel disabled — website activity will no longer be posted anywhere.`);
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
                name: WEBHOOK_NAME,
                reason: `Server activity channel set via /set-activity-channel by ${interaction.user.tag}`,
            });
        } catch (err) {
            console.error('Failed to create server activity webhook:', err);
            interaction.editReply(`Couldn't create a webhook in <#${channelId}> — I likely need Manage Webhooks permission there.`);
            return;
        }

        await dynamoHandler.updateStatFields(TRACKING_ID, {
            channelId,
            webhookId: webhook.id,
            webhookUrl: webhook.url,
        });

        interaction.editReply(`Server activity channel set to <#${channelId}> — website Work/Bounty/Heist/Raid/Rob/Bank/Safehouse activity will start posting there.`);
    }
}
