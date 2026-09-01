const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes, buildPaginationRow } = require("../../utils/helperCommands")
const { GuildRoles, Bounty } = require("../../utils/constants");
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;
const PAGE_PREFIX = 'guild_invite_page';
const JOIN_PREFIX = 'guild_invite_join_';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// All guilds the given user currently has a pending invite on, sorted the same way
// getSortedGuildsById already returns them. Re-run fresh at render time and again after
// every join attempt (a click can sit open a while, and joining changes eligibility).
async function loadInvitedGuilds(userId) {
    const allGuilds = await dynamoHandler.getSortedGuildsById();
    return allGuilds.filter(g => g.inviteList?.includes(userId));
}

// The actual join — shared by both entry points (typing a guild name directly, or
// clicking a button on the no-args invite list) so neither can drift out of sync with the
// other's validation. Returns a message (no userDisplayName prefix — the caller adds
// that), same shape companionCancel.js's attemptCancelListing/companionMarket.js's
// attemptBuy already use, so it's exercisable directly in tests without mocking
// discord.js's interaction machinery.
async function attemptJoinGuild(userId, username, userDisplayName, guildName) {
    const guild = await dynamoHandler.findGuildByName(guildName);
    if (!guild) {
        return { ok: false, message: `there was an error looking for the guild you're trying to join. Try again!` };
    }
    const guildId = guild.guildId;
    let inviteList = guild.inviteList;
    let memberList = guild.memberList;

    if (memberList.length >= guild.memberCap) {
        return { ok: false, message: `this guild is already at their member limit, ask them to upgrade their member cap or kick a member out!` };
    }

    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        return { ok: false, message: `could not be looked up due to a database error, please try again!` };
    }

    const userGuildId = userDetails.guildId;
    if (userGuildId == guildId) {
        return { ok: false, message: `you are already in this guild. Check your profile!` };
    } else if (userGuildId != 0 && userGuildId != guildId) {
        return { ok: false, message: `you are already in another guild. Please leave your current guild before joining another.` };
    }

    // Mercenary and guild membership are mutually exclusive — see
    // systems/mercenary-bounties.md.
    if (userDetails.isMercenary) {
        return { ok: false, message: `you're a mercenary — run /retire-mercenary before joining a guild.` };
    }

    // guildMercenarySwitchTimer is shared between /leave (leaving a guild) and
    // /retire-mercenary (retiring as a mercenary), so this guard can't tell which one
    // actually set it — the message stays generic rather than guessing wrong. A fresh
    // account (timer 0) is never blocked by this.
    const timeSinceSwitchInSeconds = Math.floor((Date.now() - userDetails.guildMercenarySwitchTimer) / 1000);
    const timeUntilSwitchAvailableInSeconds = Bounty.GUILD_SWITCH_COOLDOWN_SECONDS - timeSinceSwitchInSeconds;
    if (timeSinceSwitchInSeconds < Bounty.GUILD_SWITCH_COOLDOWN_SECONDS) {
        return { ok: false, message: `you recently left a guild or mercenary life — wait ${convertSecondstoMinutes(timeUntilSwitchAvailableInSeconds)} before joining a guild.` };
    }

    if (!inviteList.includes(userId)) {
        return { ok: false, message: `you are not invited to this guild. Ask for an invite!` };
    }

    let newInviteList = inviteList.filter((id) => id != userId)
    memberList.push({
        id: userId,
        role: GuildRoles.MEMBER,
        username: username
    })

    const written = await dynamoHandler.updateGuildFieldsWithLock(guildId, guild.guildVersion, { inviteList: newInviteList, memberList });
    if (!written) {
        return { ok: false, message: `this guild changed while processing your join. Please try again!` };
    }
    await dynamoHandler.updateUserDatabase(userId, "guildId", guildId);
    return { ok: true, message: `you have joined the guild, '${guild.guildName}'!` };
}

// Up to 5 join buttons per page, one per invited guild shown — labeled with the guild's
// own name (rather than a generic "Join" repeated 5 times), same reasoning
// companionCancel.js's own cancel row already uses. Keyed by guildId (not name) since
// customIds need to stay well-formed regardless of what characters a guild name contains.
function buildJoinRow(pageItems) {
    if (!pageItems.length) return null;
    const buttons = pageItems.map(guild => new ButtonBuilder()
        .setCustomId(`${JOIN_PREFIX}${guild.guildId}`)
        .setLabel(guild.guildName.slice(0, 80))
        .setStyle(ButtonStyle.Success)
    );
    return new ActionRowBuilder().addComponents(buttons);
}

function buildRows(pages, pageIndex) {
    const rows = [];
    if (pages.length > 1) {
        rows.push(buildPaginationRow(PAGE_PREFIX, pageIndex, pages.length));
    }
    const joinRow = buildJoinRow(pages[pageIndex]);
    if (joinRow) {
        rows.push(joinRow);
    }
    return rows;
}

module.exports = {
    name: "join-guild",
    description: "Join a guild you're invited to — pick from a list, or name one directly",
    devOnly: false,
    options: [
        {
            name: 'guild-name',
            description: 'Name of guild you want to join — omit to see every guild you\'re invited to',
            required: false,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    // Scoped to guilds the invoking user is actually invited to — same reasoning as
    // companionSell.js's autocomplete narrowing to what's actually usable, rather than
    // listing every guild in the game. Matches case-insensitively but returns each
    // guild's real stored casing (e.g. "Honest Workers"), never a forced upper/lowercase
    // transform.
    autocomplete: async (client, interaction) => {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const userId = interaction.user.id;
        const allGuilds = await dynamoHandler.getSortedGuildsById();
        const choices = allGuilds
            .filter(g => g.inviteList?.includes(userId))
            .filter(g => g.guildName.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(g => ({ name: g.guildName, value: g.guildName }));
        await interaction.respond(choices);
    },
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const guildName = interaction.options.get('guild-name')?.value;

        // Named path — typing a guild directly still joins immediately, unchanged from
        // before this rework.
        if (guildName) {
            const result = await attemptJoinGuild(userId, username, userDisplayName, guildName);
            interaction.editReply(`${userDisplayName}, ${result.message}`);
            return;
        }

        // No-args path — show every pending invite as its own join button instead of
        // making the player already know (and type) a guild's exact name.
        let invitedGuilds = await loadInvitedGuilds(userId);
        let pages = chunkArray(invitedGuilds, PAGE_SIZE);
        let pageIndex = 0;

        const renderPage = (idx) => embedFactory.createGuildInviteListEmbed(pages[idx], idx, pages.length, invitedGuilds.length);

        const embed = renderPage(0);
        const components = buildRows(pages, 0);
        const reply = await interaction.editReply({ embeds: [embed], components });

        if (pages.length <= 1 && !buildJoinRow(pages[0])) return;

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            if (clicked.customId === `${PAGE_PREFIX}_prev` || clicked.customId === `${PAGE_PREFIX}_next`) {
                pageIndex = clicked.customId === `${PAGE_PREFIX}_next` ? pageIndex + 1 : pageIndex - 1;
                await clicked.update({ embeds: [renderPage(pageIndex)], components: buildRows(pages, pageIndex) });
                continue;
            }

            if (clicked.customId.startsWith(JOIN_PREFIX)) {
                const guildId = clicked.customId.slice(JOIN_PREFIX.length);
                await clicked.deferUpdate();

                const targetGuild = invitedGuilds.find(g => g.guildId == guildId);
                const result = await attemptJoinGuild(userId, username, userDisplayName, targetGuild?.guildName);

                if (result.ok) {
                    // Nothing left to do once joined — a member of one guild can't join
                    // another, so the whole browsing session ends here rather than
                    // staying open on a now-useless list.
                    await interaction.editReply({ content: `${userDisplayName}, ${result.message}`, embeds: [], components: [] });
                    return;
                }

                // A failed attempt (guild filled up, invite revoked, etc. since this page
                // was rendered) keeps the session open so the player can try another
                // guild on the list instead of losing their whole browse over one bad click.
                invitedGuilds = await loadInvitedGuilds(userId);
                pages = chunkArray(invitedGuilds, PAGE_SIZE);
                if (pageIndex >= pages.length) {
                    pageIndex = Math.max(0, pages.length - 1);
                }

                await interaction.editReply({
                    content: `${userDisplayName}, ${result.message}`,
                    embeds: [renderPage(pageIndex)],
                    components: buildRows(pages, pageIndex)
                });
                continue;
            }
        }
    },
    // Exported for tests — see companionCancel.js's attemptCancelListing for why the
    // actual per-click logic lives in a standalone function rather than inline in the
    // collector loop.
    attemptJoinGuild
}
