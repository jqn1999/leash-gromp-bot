const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionFusionFactory = require("../../utils/companionFusionFactory");
const { CompanionFusion } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "companion-fuse",
    description: "Sacrifice a Common/Rare/Legendary companion as Ascension fuel for an already max-level companion",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'sacrifice',
            description: 'Which companion to permanently sacrifice as fuel (Common/Rare/Legendary only)',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        },
        {
            name: 'target',
            description: 'Which max-level companion receives the fuel (Ascension only — not for leveling up)',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    // Two independent autocomplete fields on one command — first time this codebase has
    // needed it (every other autocomplete command, like companionSellNpc.js, only has
    // one). getFocused(true) returns { name, value } for whichever option is currently
    // being typed into, so this branches once on focusedOption.name to apply the
    // sacrifice-only rarity filter without needing two near-duplicate autocomplete
    // functions.
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

        let entries = (userDetails.companions?.owned ?? [])
            .filter(entry => !companionFactory.isScavenging(userDetails, entry.instanceId))
            .map(entry => ({ entry, companion: companionFactory.getCompanionById(entry.id) }))
            .filter(({ companion }) => companion);

        if (focusedOption.name === 'sacrifice') {
            entries = entries.filter(({ companion }) => companionFusionFactory.canBeSacrificed(companion));
        } else {
            // target: only offer companions fusion can actually accept — max level (2026-09-08,
            // direct instruction: fusion no longer touches a not-yet-maxed companion, "so it's
            // not a waste") and not already fully ascended. Keeps a player from ever picking an
            // option validateFusionRequest would just reject.
            entries = entries.filter(({ entry }) =>
                (entry.workCount || 0) >= companionFactory.MAX_LEVEL_WORK_COUNT &&
                (entry.ascensionStars || 0) < CompanionFusion.ASCENSION_MAX_STARS
            );
        }

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
        const sacrificeInstanceId = interaction.options.get('sacrifice')?.value;
        const targetInstanceId = interaction.options.get('target')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const validation = companionFusionFactory.validateFusionRequest(userDetails, sacrificeInstanceId, targetInstanceId);
        if (!validation.valid) {
            interaction.editReply(`${userDisplayName}, ${validation.error}`);
            return;
        }

        const reply = await interaction.editReply({
            embeds: [embedFactory.createFusionPreviewEmbed(userDisplayName, validation.sacrificeCompanion, validation.sacrificeEntry, validation.targetCompanion, validation.targetEntry, validation.fuelValue)],
            components: [buildConfirmCancelRow('companion_fuse', 'Fuse it')]
        });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation || confirmation.customId === 'companion_fuse_cancel') {
            const cancelledEmbed = embedFactory.createFusionCancelledEmbed(userDisplayName);
            await (confirmation ? confirmation.update({ embeds: [cancelledEmbed], components: [] }) : reply.edit({ embeds: [cancelledEmbed], components: [] })).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        // Re-fetch — time passed during the confirm prompt, and both companions must
        // still be owned (and still eligible) right before one is permanently removed.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        const revalidation = companionFusionFactory.validateFusionRequest(freshUserDetails, sacrificeInstanceId, targetInstanceId);
        if (!revalidation.valid) {
            await interaction.editReply({ content: `${userDisplayName}, ${revalidation.error}`, components: [] });
            return;
        }

        const result = companionFusionFactory.resolveFusion(freshUserDetails, revalidation);

        // Spread freshUserDetails.companions first, same "full SET write, not a deep
        // merge" discipline every other companion-mutating write in this codebase already
        // follows (see companionMarketFactory.removeFromOwned's own comment) — so
        // `scavenging`/`scavengeReturnsByRarity`/anything else not touched by this fusion
        // carries forward untouched.
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
            embeds: [embedFactory.createFusionCompleteEmbed(userDisplayName, revalidation.sacrificeCompanion, revalidation.targetCompanion, result)],
            components: []
        });
    }
}
