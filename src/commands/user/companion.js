const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildPaginationRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const PAGE_SIZE = 5;
const PAGE_PREFIX = 'companion';
const EQUIP_PREFIX = 'companion_equip_';

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// Resolves userDetails.companions.owned into full companion objects (roster entry +
// that owner's own workCount) and chunks them into pages — pulled into its own function
// since the equip flow needs to rebuild this fresh after every click (workCount/active/
// scavenging can all have changed), not just once at command invocation.
function buildOwnedPages(userDetails) {
    const ownedCompanions = (userDetails.companions?.owned ?? [])
        .map(o => {
            const companion = companionFactory.getCompanionById(o.id);
            return companion ? { ...companion, workCount: o.workCount || 0 } : null;
        })
        .filter(Boolean);
    return { pages: chunkArray(ownedCompanions, PAGE_SIZE), totalOwned: ownedCompanions.length };
}

// The actual equip — re-fetches userDetails fresh at click time (same "don't trust
// whatever was captured when the page was first rendered" discipline the market's
// buy button uses) rather than trusting the userDetails this page was originally built
// from, since the embed can sit open for a while before a button is clicked. Equipping
// itself stays the same unconditional, race-tolerant write /companion equip always used
// (see companionFactory.js's comment on isScavenging) — nothing here is contested the
// way a market listing is, so no lock is needed.
//
// Clicking the already-active companion's own button toggles it off (active: null)
// instead of re-equipping it — the only other way to reach "nothing active" is owning a
// second companion to switch to, which stranded a player's only companion permanently
// equipped: they couldn't send it scavenging (which requires it not be the active one)
// with no other companion to switch to first.
async function attemptEquip(userId, username, equipId) {
    const freshUserDetails = await dynamoHandler.findUser(userId, username);
    if (!freshUserDetails) {
        return { ok: false, message: `could not be looked up due to a database error, please try again!`, userDetails: null };
    }
    if (!companionFactory.ownsCompanion(freshUserDetails, equipId)) {
        return { ok: false, message: `you don't own that companion yet!`, userDetails: freshUserDetails };
    }

    const companion = companionFactory.getCompanionById(equipId);

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

    return { ok: true, message: `${companion.name} is now your active companion!`, userDetails: { ...freshUserDetails, companions: updatedCompanions } };
}

// Up to 5 equip buttons for whichever companions are shown on this page — the active
// companion's own button stays enabled (clicking it again unequips, see attemptEquip)
// and is styled Success to mark which one it is; every other button is disabled only if
// that companion is out scavenging, so it's always visible why it can't be equipped right
// now rather than it just silently not being an option. Labeled with the companion's own
// name (each page has at most 5, matching the 5 fields above it 1:1) rather than a
// generic "Equip" on every button, since a row of identical labels wouldn't tell you
// which button does what.
function buildEquipRow(pageItems, userDetails) {
    if (!pageItems.length) return null;
    const activeId = userDetails.companions?.active ?? null;
    const buttons = pageItems.map(companion => new ButtonBuilder()
        .setCustomId(`${EQUIP_PREFIX}${companion.id}`)
        .setLabel(companion.name.slice(0, 80))
        .setStyle(companion.id === activeId ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(companion.id !== activeId && companionFactory.isScavenging(userDetails, companion.id))
    );
    return new ActionRowBuilder().addComponents(buttons);
}

function buildRows(pages, pageIndex, userDetails) {
    const rows = [];
    if (pages.length > 1) {
        rows.push(buildPaginationRow(PAGE_PREFIX, pageIndex, pages.length));
    }
    const equipRow = buildEquipRow(pages[pageIndex], userDetails);
    if (equipRow) {
        rows.push(equipRow);
    }
    return rows;
}

module.exports = {
    name: "companion",
    description: "View your companions, or equip one as your active companion",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        let userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        let { pages, totalOwned } = buildOwnedPages(userDetails);
        let pageIndex = 0;

        const renderPage = (idx) => embedFactory.createCompanionListEmbed(
            userDisplayName, pages[idx], idx, pages.length,
            userDetails.companions?.active ?? null, totalOwned, userDetails.companions?.scavenging ?? null
        );

        const embed = renderPage(0);
        const components = buildRows(pages, 0, userDetails);
        const reply = await interaction.editReply({ embeds: [embed], components });

        if (pages.length <= 1 && !buildEquipRow(pages[0], userDetails)) return;

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
                await clicked.update({ embeds: [renderPage(pageIndex)], components: buildRows(pages, pageIndex, userDetails) });
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
                totalOwned = rebuilt.totalOwned;
                if (pageIndex >= pages.length) {
                    pageIndex = Math.max(0, pages.length - 1);
                }

                await interaction.editReply({
                    content: `${userDisplayName}, ${result.message}`,
                    embeds: [renderPage(pageIndex)],
                    components: buildRows(pages, pageIndex, userDetails)
                });
                continue;
            }
        }
    },
    // Exported for tests — the actual equip logic behind each button click, kept as a
    // standalone function so it can be exercised without needing to mock discord.js's
    // full component-collector machinery.
    attemptEquip
}
