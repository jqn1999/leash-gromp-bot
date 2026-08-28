const { ButtonBuilder, ActionRowBuilder, ButtonStyle, ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const { CompanionLeveling } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;
const PAGE_PREFIX = 'companion';
const EQUIP_PREFIX = 'companion_equip_';
// Max-Level capstone (Option A, cosmetic-only) — the top of CompanionLeveling.THRESHOLDS,
// same lookup embedFactory.js's own MAX_COMPANION_LEVEL uses.
const MAX_COMPANION_LEVEL = CompanionLeveling.THRESHOLDS[CompanionLeveling.THRESHOLDS.length - 1].level;

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// Resolves userDetails.companions.owned into full companion objects (roster entry +
// that owned instance's own instanceId/workCount) and chunks them into pages — pulled
// into its own function since the equip flow needs to rebuild this fresh after every
// click (workCount/active/scavenging can all have changed), not just once at command
// invocation. Since 2026-08-25's instance rework, each owned instance is its own row —
// two independently-leveled copies of the same companion both appear, one per instance.
//
// uniqueOwnedCount counts distinct companion TYPES currently owned (a duplicate instance
// of one already-owned type doesn't add to it) — deliberately NOT the same number as
// `ownedCompanions.length` (every instance, duplicates included), which is what pagination
// itself still needs. Fixed 2026-08-28, direct instruction, after a player with 2 owned
// instances of one companion type saw "15 / 13 collected" — the header/roster-complete line
// was comparing raw instance count against Companions.length (13 distinct types), so any
// duplicate pushed it over. Also deliberately NOT the same as userDetails.companions.ownedCount
// (a lifetime, never-decrementing achievement counter — see companionFactory.applyCompanionAward)
// — this instead recomputes live off currently-owned instances so it drops back down if a
// player later sells away their only copy of a type, matching what the paginated list below
// it actually shows right now. /profile's own "🏆 Menagerie Complete" title tag intentionally
// stays on the lifetime ownedCount instead (see embedFactory.js's createUserEmbed) since that's
// a permanent capstone, not a live collection count — the two are allowed to diverge.
function buildOwnedPages(userDetails) {
    const ownedCompanions = (userDetails.companions?.owned ?? [])
        .map(o => {
            const companion = companionFactory.getCompanionById(o.id);
            return companion ? { ...companion, instanceId: o.instanceId, workCount: o.workCount || 0, hasScavenged: o.hasScavenged || false } : null;
        })
        .filter(Boolean);
    const uniqueOwnedCount = new Set(ownedCompanions.map(c => c.id)).size;
    return { pages: chunkArray(ownedCompanions, PAGE_SIZE), uniqueOwnedCount };
}

// The actual equip — re-fetches userDetails fresh at click time (same "don't trust
// whatever was captured when the page was first rendered" discipline the market's
// buy button uses) rather than trusting the userDetails this page was originally built
// from, since the embed can sit open for a while before a button is clicked. Equipping
// itself stays the same unconditional, race-tolerant write /companion equip always used
// (see companionFactory.js's comment on isScavenging) — nothing here is contested the
// way a market listing is, so no lock is needed.
//
// Clicking the already-active instance's own button toggles it off (active: null)
// instead of re-equipping it — the only other way to reach "nothing active" is owning a
// second instance to switch to, which stranded a player's only companion permanently
// equipped: they couldn't send it scavenging (which requires it not be the active one)
// with no other instance to switch to first. equipId is an instanceId, not a companion
// id, since 2026-08-25's instance rework — a companion id alone can no longer identify
// which specific owned copy to equip.
async function attemptEquip(userId, username, equipId) {
    const freshUserDetails = await dynamoHandler.findUser(userId, username);
    if (!freshUserDetails) {
        return { ok: false, message: `could not be looked up due to a database error, please try again!`, userDetails: null };
    }
    const ownedEntry = companionFactory.getOwnedEntry(freshUserDetails, equipId);
    if (!ownedEntry) {
        return { ok: false, message: `you don't own that companion yet!`, userDetails: freshUserDetails };
    }

    const companion = companionFactory.getCompanionById(ownedEntry.id);

    if (freshUserDetails.companions?.active === equipId) {
        const updatedCompanions = { ...freshUserDetails.companions, active: null };
        await dynamoHandler.updateUserFields(userId, { companions: updatedCompanions });
        return { ok: true, message: `${companion.name} is no longer your active companion.`, userDetails: { ...freshUserDetails, companions: updatedCompanions } };
    }

    if (companionFactory.isScavenging(freshUserDetails, equipId)) {
        return { ok: false, message: `that companion is out scavenging — it can't be equipped until it returns (or you cancel the scavenge with /companion-scavenge-cancel).`, userDetails: freshUserDetails };
    }

    const updatedCompanions = { ...freshUserDetails.companions, active: equipId };
    await dynamoHandler.updateUserFields(userId, { companions: updatedCompanions });

    // Max-Level capstone (Option A, cosmetic-only) — a one-line flavor callout when the
    // just-equipped instance has already reached max level, mirroring the same "⭐ Bonded"
    // framing /companion's list and the scavenge-return embed use.
    const bondedFlavor = companionFactory.getCompanionLevel(ownedEntry.workCount) === MAX_COMPANION_LEVEL
        ? ` ⭐ Bonded — it's reached its full potential.`
        : '';
    return { ok: true, message: `${companion.name} is now your active companion!${bondedFlavor}`, userDetails: { ...freshUserDetails, companions: updatedCompanions } };
}

// Up to 5 equip buttons for whichever owned instances are shown on this page — the
// active instance's own button stays enabled (clicking it again unequips, see
// attemptEquip) and is styled Success to mark which one it is; every other button is
// disabled only if that instance is out scavenging, so it's always visible why it can't
// be equipped right now rather than it just silently not being an option. customId keys
// off instanceId (not companion id) since 2026-08-25's instance rework — a player can own
// several independently-leveled copies of the same companion, each its own button.
// Labeled with the companion's name plus its level so two copies of the same companion
// are distinguishable on the same page.
function buildEquipRow(pageItems, userDetails) {
    if (!pageItems.length) return null;
    const activeId = userDetails.companions?.active ?? null;
    const buttons = pageItems.map(companion => new ButtonBuilder()
        .setCustomId(`${EQUIP_PREFIX}${companion.instanceId}`)
        .setLabel(`${companion.name} (Lv. ${companionFactory.getCompanionLevel(companion.workCount)})`.slice(0, 80))
        .setStyle(companion.instanceId === activeId ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(companion.instanceId !== activeId && companionFactory.isScavenging(userDetails, companion.instanceId))
    );
    return new ActionRowBuilder().addComponents(buttons);
}

// canEquip is false when viewing another user's list — read-only in that case, same as
// every other "view someone else's stuff" command (see /profile's target-user option):
// equipping only ever mutates the INVOKING user's own state, so it makes no sense to show
// (let alone wire up) equip buttons for a companion list that isn't the invoker's own.
function buildRows(pages, pageIndex, userDetails, canEquip) {
    const rows = [];
    if (pages.length > 1) {
        rows.push(buildPaginationRow(PAGE_PREFIX, pageIndex, pages.length));
    }
    const equipRow = canEquip ? buildEquipRow(pages[pageIndex], userDetails) : null;
    if (equipRow) {
        rows.push(equipRow);
    }
    return rows;
}

module.exports = {
    name: "companion",
    description: "View your companions (or another user's), or equip one as your active companion",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'target-user',
            description: 'The user to view the companion list of',
            required: false,
            type: ApplicationCommandOptionType.Mentionable,
        },
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const [invokingUserId] = getUserInteractionDetails(interaction);
        let userId, username, userDisplayName;

        // Same target-user resolution /profile.js already uses — Mentionable rather than
        // User so it also accepts a role mention gracefully failing the members.fetch below
        // instead of a type mismatch at the Discord API layer.
        const targetUserId = interaction.options.get('target-user')?.value;
        if (targetUserId) {
            const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
            if (!targetMember) {
                await interaction.editReply('That user doesn\'t exist in this server.');
                return;
            }
            userId = targetMember.id;
            userDisplayName = targetMember.displayName;
            username = targetMember.user.username;
        } else {
            [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        }
        const canEquip = userId === invokingUserId;

        let userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let { pages, uniqueOwnedCount } = buildOwnedPages(userDetails);
        let pageIndex = 0;

        const renderPage = (idx) => embedFactory.createCompanionListEmbed(
            userDisplayName, pages[idx], idx, pages.length,
            userDetails.companions?.active ?? null, uniqueOwnedCount, userDetails.companions?.scavenging ?? null, canEquip
        );

        const embed = renderPage(0);
        const components = buildRows(pages, 0, userDetails, canEquip);
        const reply = await interaction.editReply({ embeds: [embed], components });

        if (pages.length <= 1 && !(canEquip && buildEquipRow(pages[0], userDetails))) return;

        // Custom collector loop, not runPaginatedReply/buildPaginationRow's generic
        // prev/next-only loop — this page also needs to react to equip-button clicks
        // (rebuilding owned/pages/active state and re-rendering in place), which that
        // shared helper has no concept of. buildPaginationRow itself is still reused for
        // the prev/next row so this doesn't duplicate that half.
        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
            if (!clicked) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            if (clicked.customId === `${PAGE_PREFIX}_prev` || clicked.customId === `${PAGE_PREFIX}_next`) {
                pageIndex = clicked.customId === `${PAGE_PREFIX}_next` ? pageIndex + 1 : pageIndex - 1;
                await clicked.update({ embeds: [renderPage(pageIndex)], components: buildRows(pages, pageIndex, userDetails, canEquip) });
                continue;
            }

            if (clicked.customId.startsWith(EQUIP_PREFIX)) {
                const equipId = clicked.customId.slice(EQUIP_PREFIX.length);
                await clicked.deferUpdate();

                const result = await attemptEquip(userId, username, equipId);
                if (result.userDetails) {
                    userDetails = result.userDetails;
                }

                const rebuilt = buildOwnedPages(userDetails);
                pages = rebuilt.pages;
                uniqueOwnedCount = rebuilt.uniqueOwnedCount;
                if (pageIndex >= pages.length) {
                    pageIndex = Math.max(0, pages.length - 1);
                }

                await interaction.editReply({
                    content: `${userDisplayName}, ${result.message}`,
                    embeds: [renderPage(pageIndex)],
                    components: buildRows(pages, pageIndex, userDetails, canEquip)
                });
                continue;
            }
        }
    },
    // Exported for tests — the actual equip logic behind each button click, kept as a
    // standalone function so it can be exercised without needing to mock discord.js's
    // full component-collector machinery.
    attemptEquip,
    // Exported for tests — covers uniqueOwnedCount's dedupe-by-type behavior directly,
    // without needing to mock discord.js's interaction/collector machinery.
    buildOwnedPages
}
