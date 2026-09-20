const dynamoHandler = require("../../utils/dynamoHandler");

// Guild Chat Sync (Discord -> Web) — see systems/guilds.md's "Guild Chat Sync" design,
// section 5, for the full writeup. Discord has no "outgoing webhook for arbitrary channel
// messages" concept — only the bot's own persistent gateway connection can observe a
// message typed directly into a channel, which is why this is the one direction that has
// to live here rather than reusing the webhook-POST pattern Direction A (web -> Discord)
// uses. Requires the MessageContent privileged intent (already requested in src/index.js —
// see this feature's own pre-flight note on confirming it's toggled on in the Discord
// Developer Portal for production).
//
// Only a real (non-null) category id is ever cached — caching a "not yet created" null
// would otherwise stick for the rest of this process's uptime the first time ANY guild's
// chat gets provisioned after boot, silently dropping every message in that brand-new
// channel until a restart. This is a deliberate, small deviation from a naive "cache
// whatever we read, once" implementation: comparing a message's parentId against a
// still-null category id would also incorrectly match every message sent in any OTHER
// channel that also has no parent category (parentId is null there too), defeating the
// whole point of this cheap pre-filter. The bounded cost of only caching a real value is
// one extra getStatDatabase call per non-chat message until the FIRST guild (or the Merc
// Faction Hall) ever provisions its chat — a one-time, self-resolving cost given this
// game's confirmed low guild count (systems/guilds.md), not an ongoing per-message cost.
let cachedCategoryId = null;

async function getGuildChatCategoryId() {
    if (cachedCategoryId) return cachedCategoryId;
    const category = await dynamoHandler.getStatDatabase('guild_chat_category');
    cachedCategoryId = category?.categoryId || null;
    return cachedCategoryId;
}

module.exports = async (client, message) => {
    if (message.isChatInputCommand) return;
    if (message.author.bot) return;

    // Cheap, in-memory, zero-DB-call pre-filter — every message sent anywhere else in the
    // server (the overwhelming majority of traffic) never reaches a DB call at all.
    const categoryId = await getGuildChatCategoryId();
    if (!categoryId || message.channel.parentId !== categoryId) return;

    const index = await dynamoHandler.getStatDatabase('chat_channel_index');
    const scope = index?.channels?.[message.channel.id];
    if (!scope) return;

    const scopeKey = scope.scopeType === 'guild' ? `guild#${scope.scopeId}` : 'merc';
    await dynamoHandler.postChatMessage(scopeKey, {
        authorId: message.author.id,
        authorDisplayName: message.member?.displayName ?? message.author.username,
        source: 'discord',
        content: message.content,
    });
};

// Exported for tests — lets a test reset the module-level cache between cases rather than
// needing a fresh require() (jest.resetModules) for every one.
module.exports._resetCategoryCache = () => { cachedCategoryId = null; };
