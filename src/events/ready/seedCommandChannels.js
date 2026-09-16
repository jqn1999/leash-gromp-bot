const dynamoHandler = require("../../utils/dynamoHandler");

// One-time migration (2026-09-16) — /set-command-channels (setCommandChannels.js) replaces
// handleCommands.js's old hardcoded `validChannels` array (5 literal channel IDs, only
// ever valid for this bot's own original Discord server) with a per-guild DynamoDB
// allowlist that defaults to unrestricted when unset. Without this seed, THIS server's
// restriction would silently loosen to "commands work everywhere" the moment that change
// ships, until an admin happened to notice and re-run /set-command-channels manually.
//
// Runs on every boot but is a genuine no-op after the very first real deploy: it only
// ever writes when this one guild's own `command_channels_<guildId>` doc doesn't exist
// yet, so re-running this forever after that costs nothing beyond one extra
// getStatDatabase read per startup. The guild ID and channel IDs below are exactly the
// previous hardcoded values, preserved here purely so this specific server's behavior
// doesn't change on rollout — not a general-purpose seed for every server the bot might
// ever join. Safe to delete this file entirely once confirmed the doc exists (e.g. via
// `/set-command-channels action:list` in that server).
const LEGACY_GUILD_ID = '168379467931058176';
const LEGACY_CHANNEL_IDS = ['1187561420406136843', '796873375632195605', '1188525931346792498', '1188539987118010408', '1203822914437124188'];

module.exports = async (client) => {
    try {
        const trackingId = `command_channels_${LEGACY_GUILD_ID}`;
        const existing = await dynamoHandler.getStatDatabase(trackingId);
        if (existing) return;
        await dynamoHandler.updateStatFields(trackingId, { channelIds: LEGACY_CHANNEL_IDS });
        console.log(`Seeded command_channels allowlist for guild ${LEGACY_GUILD_ID}`);
    } catch (error) {
        console.error('seedCommandChannels failed (non-fatal):', error);
    }
};
