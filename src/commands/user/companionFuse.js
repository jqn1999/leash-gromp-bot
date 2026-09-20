const { ApplicationCommandOptionType, StringSelectMenuBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow, buildPaginationRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionFusionFactory = require("../../utils/companionFusionFactory");
const { CompanionFusion, CompanionRarity } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Batch Fusion (2026-09-20, product-confirmed design) — replaces the old one-sacrifice-at-a-
// time flow (a single required `sacrifice` autocomplete option alongside `target`). Fully
// ascending one companion costs 26,375 total fuel and a Common alone is only worth ~50-100,
// so the old flow could take 50-100+ separate command invocations to fill even one star. Now
// the player picks only `target`, then multi-selects as many eligible sacrifices as they
// want (with pagination + per-rarity Select All buttons) before confirming the whole batch
// in one write. See systems/companions.md's Companion Fusion section for the full writeup.

const PREFIX = 'companion_fuse';
const SELECT_CUSTOM_ID = `${PREFIX}_select`;
// Discord's own per-select-menu option cap — also doubles as this flow's page size, same
// "page size = the platform's own hard limit" precedent /companion-market's listing pages
// don't need (they're capped lower for readability), but a select menu genuinely can't show
// more than this per page regardless.
const MAX_OPTIONS_PER_PAGE = 25;

// No single indiscriminate "select everything" button — per-rarity only, per product
// instruction. Order (Common, Rare, Legendary) matches CompanionFusion.BASE_FUEL's own key
// order and every other rarity-ordered display in this codebase.
const RARITY_SELECT_ALL = [
    { rarity: CompanionRarity.COMMON, customId: `${PREFIX}_all_common`, label: 'Select All Commons' },
    { rarity: CompanionRarity.RARE, customId: `${PREFIX}_all_rare`, label: 'Select All Rares' },
    { rarity: CompanionRarity.LEGENDARY, customId: `${PREFIX}_all_legendary`, label: 'Select All Legendaries' },
];

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

// One option per eligible candidate on this page — label shows name + level + fuel value
// (e.g. "Sprout (Lv. 6) — 90 fuel") per the confirmed design. `default: true` re-checks an
// option that's already part of the accumulated selection when the page/menu is
// rebuilt/re-rendered, so paging away and back (or a Select All click) visibly reflects the
// running selection instead of the menu silently resetting to blank on every re-render.
function buildSelectMenuRow(pageCandidates, selectedInstanceIds) {
    const options = pageCandidates.map(({ entry, companion, fuelValue }) => ({
        label: `${companion.name} (Lv. ${companionFactory.getCompanionLevel(entry.workCount)}) — ${fuelValue.toLocaleString()} fuel`.slice(0, 100),
        value: entry.instanceId,
        default: selectedInstanceIds.has(entry.instanceId)
    }));
    const menu = new StringSelectMenuBuilder()
        .setCustomId(SELECT_CUSTOM_ID)
        .setPlaceholder('Choose companions to sacrifice on this page (optional)')
        .setMinValues(0)
        .setMaxValues(options.length)
        .addOptions(options);
    return new ActionRowBuilder().addComponents(menu);
}

// Only shown for a rarity that actually has at least one eligible candidate (across ALL
// pages, not just the current one) — per confirmed design, "each shown only if at least one
// eligible companion of that rarity exists." Counts are shown on the button label itself so
// a player knows what a click commits to before clicking it.
function buildSelectAllRow(candidates) {
    const buttons = RARITY_SELECT_ALL
        .map(({ rarity, customId, label }) => {
            const count = candidates.filter(c => c.companion.rarity === rarity).length;
            if (count === 0) return null;
            return new ButtonBuilder()
                .setCustomId(customId)
                .setLabel(`${label} (${count})`)
                .setStyle(ButtonStyle.Secondary);
        })
        .filter(Boolean);
    return buttons.length > 0 ? new ActionRowBuilder().addComponents(buttons) : null;
}

// Row budget check (Discord's 5-action-row-per-message cap): select menu (1, a select menu
// can never share a row with anything else) + select-all buttons (0-1) + pagination (0-1) +
// confirm/cancel (1) = at most 4 rows here, comfortably under the 5-row limit — no
// collapsing needed for this layout.
function buildComponents(candidates, pages, pageIndex, selectedInstanceIds) {
    const rows = [buildSelectMenuRow(pages[pageIndex], selectedInstanceIds)];
    const selectAllRow = buildSelectAllRow(candidates);
    if (selectAllRow) {
        rows.push(selectAllRow);
    }
    if (pages.length > 1) {
        rows.push(buildPaginationRow(PREFIX, pageIndex, pages.length));
    }
    rows.push(buildConfirmCancelRow(PREFIX, 'Fuse selected'));
    return rows;
}

module.exports = {
    name: "companion-fuse",
    // Kept to Discord's 100-char slash-command description cap (2026-09-20 fix — the
    // original wording was 106 chars and made command registration fail outright with a
    // 400 on EVERY command, not just this one, since 01registerCommands.js registers the
    // whole set in one batch/PATCH).
    description: "Sacrifice a batch of Common/Rare/Legendary companions as Ascension fuel for a max-level companion",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'target',
            description: 'Which max-level companion receives the fuel (Ascension only — not for leveling up)',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    autocomplete: async (client, interaction) => {
        const focusedOption = interaction.options.getFocused(true);
        const focused = (focusedOption.value || '').toLowerCase();
        const userId = interaction.user.id;
        const username = interaction.user.username;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            await interaction.respond([]);
            return;
        }

        // target only, unfiltered by rarity — same eligibility filter the old two-field
        // command's own `target` branch already used: max level, not fully ascended, not
        // out scavenging. Keeps a player from ever picking an option the backend would
        // reject anyway.
        const entries = (userDetails.companions?.owned ?? [])
            .filter(entry => !companionFactory.isScavenging(userDetails, entry.instanceId))
            .filter(entry =>
                (entry.workCount || 0) >= companionFactory.MAX_LEVEL_WORK_COUNT &&
                (entry.ascensionStars || 0) < CompanionFusion.ASCENSION_MAX_STARS
            )
            .map(entry => ({ entry, companion: companionFactory.getCompanionById(entry.id) }))
            .filter(({ companion }) => companion);

        const choices = entries
            .filter(({ companion }) => companion.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(({ entry, companion }) => {
                const level = companionFactory.getCompanionLevel(entry.workCount);
                const starTag = entry.ascensionStars ? `, ${'★'.repeat(entry.ascensionStars)}` : '';
                return {
                    name: `${companion.name} (Lv. ${level}${starTag})`,
                    value: entry.instanceId
                };
            });

        await interaction.respond(choices);
    },
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const targetInstanceId = interaction.options.get('target')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const targetValidation = companionFusionFactory.validateTargetForFusion(userDetails, targetInstanceId);
        if (!targetValidation.valid) {
            interaction.editReply(`${userDisplayName}, ${targetValidation.error}`);
            return;
        }
        const { targetEntry, targetCompanion } = targetValidation;

        const candidates = companionFusionFactory.getEligibleSacrificeCandidates(userDetails, targetInstanceId);
        if (candidates.length === 0) {
            interaction.editReply(`${userDisplayName}, you don't have any Common, Rare, or Legendary companions available to sacrifice right now.`);
            return;
        }

        const pages = chunkArray(candidates, MAX_OPTIONS_PER_PAGE);
        let pageIndex = 0;
        // The accumulated selection persists across page navigation and select-all clicks
        // for the WHOLE interaction lifecycle — a plain closure variable, not per-page
        // state, per confirmed design ("a player can select some on page 1, page to page 2,
        // select more, and both selections stay counted").
        const selectedInstanceIds = new Set();

        const renderEmbed = () => {
            const selectedCandidates = candidates.filter(c => selectedInstanceIds.has(c.entry.instanceId));
            const totalFuelValue = selectedCandidates.reduce((sum, c) => sum + c.fuelValue, 0);
            const preview = companionFusionFactory.climbAscensionStars(targetEntry.ascensionFuel, targetEntry.ascensionStars, totalFuelValue);
            return embedFactory.createBatchFusionSelectionEmbed(userDisplayName, targetCompanion, targetEntry, selectedCandidates, totalFuelValue, preview, pageIndex, pages.length);
        };

        const reply = await interaction.editReply({
            embeds: [renderEmbed()],
            components: buildComponents(candidates, pages, pageIndex, selectedInstanceIds)
        });

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);

            // Timeout defaults to decline, mirroring the single-pair flow's own "no
            // confirmation = cancelled" behavior.
            if (!clicked) {
                const cancelledEmbed = embedFactory.createFusionCancelledEmbed(userDisplayName);
                await reply.edit({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
                return;
            }

            if (clicked.customId === `${PREFIX}_cancel`) {
                const cancelledEmbed = embedFactory.createFusionCancelledEmbed(userDisplayName);
                await clicked.update({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
                return;
            }

            if (clicked.customId === `${PREFIX}_prev` || clicked.customId === `${PREFIX}_next`) {
                pageIndex = clicked.customId === `${PREFIX}_next` ? pageIndex + 1 : pageIndex - 1;
                await clicked.update({ embeds: [renderEmbed()], components: buildComponents(candidates, pages, pageIndex, selectedInstanceIds) });
                continue;
            }

            if (clicked.customId === SELECT_CUSTOM_ID) {
                // A StringSelectMenu interaction's `values` is the FULL current checked set
                // for THIS render of the menu (not a delta) — so this page's own previously
                // selected ids are cleared first, then re-added from `values`, letting a
                // player deselect (down to none, minValues 0) as well as select on this page
                // without disturbing any other page's own accumulated selections.
                const currentPageIds = new Set(pages[pageIndex].map(c => c.entry.instanceId));
                for (const id of currentPageIds) {
                    selectedInstanceIds.delete(id);
                }
                for (const value of clicked.values) {
                    selectedInstanceIds.add(value);
                }
                await clicked.update({ embeds: [renderEmbed()], components: buildComponents(candidates, pages, pageIndex, selectedInstanceIds) });
                continue;
            }

            const rarityAllMatch = RARITY_SELECT_ALL.find(r => r.customId === clicked.customId);
            if (rarityAllMatch) {
                // Adds every eligible candidate of this rarity ACROSS ALL PAGES, not just
                // the current one — per confirmed design.
                candidates
                    .filter(c => c.companion.rarity === rarityAllMatch.rarity)
                    .forEach(c => selectedInstanceIds.add(c.entry.instanceId));
                await clicked.update({ embeds: [renderEmbed()], components: buildComponents(candidates, pages, pageIndex, selectedInstanceIds) });
                continue;
            }

            if (clicked.customId === `${PREFIX}_confirm`) {
                await clicked.deferUpdate();

                // Re-fetch — real time passed while the player was building their
                // selection, and every selected instance (plus the target) must still be
                // owned/eligible right before any of them are permanently removed.
                const freshUserDetails = await dynamoHandler.findUser(userId, username);
                const revalidation = companionFusionFactory.validateBatchFusionRequest(freshUserDetails, Array.from(selectedInstanceIds), targetInstanceId);
                if (!revalidation.valid) {
                    await interaction.editReply({ content: `${userDisplayName}, ${revalidation.error}`, embeds: [], components: [] });
                    return;
                }

                const result = companionFusionFactory.resolveBatchFusion(freshUserDetails, revalidation);

                // Spread freshUserDetails.companions first, same "full SET write, not a deep
                // merge" discipline every other companion-mutating write in this codebase
                // already follows — one write for the whole batch, not one per sacrifice.
                await dynamoHandler.updateUserFields(userId, {
                    companions: {
                        ...freshUserDetails.companions,
                        owned: result.owned,
                        active: result.active,
                        maxLevelCount: result.maxLevelCount,
                        mythicMaxLevelCount: result.mythicMaxLevelCount
                    }
                });

                await interaction.editReply({
                    embeds: [embedFactory.createBatchFusionCompleteEmbed(userDisplayName, revalidation.targetCompanion, result)],
                    components: []
                });
                return;
            }
        }
    }
}
