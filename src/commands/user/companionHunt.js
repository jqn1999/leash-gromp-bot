const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionHuntFactory = require("../../utils/companionHuntFactory");
const { CompanionHunt } = require("../../utils/constants");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const bigEventsChannel = require("../../utils/bigEventsChannel");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

// companion-hunt-cancel + companion-hunt-collect folded in here (2026-09-21, command-cap
// headroom pass — see roadmap.md) from their own deleted top-level command files. Both took
// zero options and only ever apply to whichever ONE hunt is currently active (or isn't), so
// they're added as two more values on the SAME required choice option the 3 duration tiers
// already used, renamed 'duration' -> 'action' since it's no longer purely a duration pick
// — same "several actions on one activity behind one required String choice" shape
// /leaderboard's own option enum already established. /companion-hunt itself (the frequent,
// "main verb" action) keeps its exact same required-single-choice UX; only the choice list
// grew by 2 entries.
async function runHunt(interaction, tierKey) {
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    const existingHunt = userDetails.companionHunt;
    if (existingHunt) {
        if (existingHunt.returnsAt <= Date.now()) {
            interaction.editReply(`${userDisplayName}, you're already back from your last expedition — run /companion-hunt action:collect first!`);
        } else {
            const remainingSeconds = Math.max(0, Math.ceil((existingHunt.returnsAt - Date.now()) / 1000));
            interaction.editReply(`${userDisplayName}, you're already out on an expedition — you return in ${convertSecondstoMinutes(remainingSeconds)}. Only one expedition can be active at a time.`);
        }
        return;
    }

    const tier = companionHuntFactory.getTierByKey(tierKey);
    // Plain unconditional write, same low/no-stakes race precedent
    // companionScavenge.js's own dispatch write already relies on — a player can only
    // ever race against their own other command calls, and a lost race just means
    // whichever write lands last persists, nothing is ever double-granted or orphaned.
    const companionHunt = companionHuntFactory.buildHuntDispatch(tierKey);
    await dynamoHandler.updateUserFields(userId, { companionHunt });

    interaction.editReply(`${userDisplayName}, you head out on a ${tier.label}! /work is blocked until you're back in ${convertSecondstoMinutes(tier.durationSeconds)} — run /companion-hunt action:collect once you've returned (or /companion-hunt action:cancel to come back early).`);
}

async function runCancel(interaction) {
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    const hunt = userDetails.companionHunt;
    if (!hunt) {
        interaction.editReply(`${userDisplayName}, you're not out on an expedition right now.`);
        return;
    }

    const tier = companionHuntFactory.getTierByKey(hunt.tierKey);
    const remainingSeconds = Math.max(0, Math.ceil((hunt.returnsAt - Date.now()) / 1000));
    const remainingText = remainingSeconds > 0 ? `${convertSecondstoMinutes(remainingSeconds)} remaining` : "already ready to collect";

    const reply = await interaction.editReply({
        content: `${userDisplayName}, come back from your ${tier.label} early? (${remainingText}) You'll forfeit its ${(tier.successChance * 100).toFixed(0)}% chance at a companion — but /work opens back up immediately.`,
        components: [buildConfirmCancelRow('companion_hunt_cancel', 'Come back early')]
    });

    const collectorFilter = i => i.user.id === interaction.user.id;
    const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

    if (!confirmation || confirmation.customId === 'companion_hunt_cancel_cancel') {
        await (confirmation ? confirmation.update({ content: `${userDisplayName}, staying out on the expedition.`, components: [] }) : reply.edit({ content: `${userDisplayName}, cancel timed out — still out on the expedition.`, components: [] })).catch(() => {});
        return;
    }

    await confirmation.deferUpdate();

    // Re-fetch — time passed during the confirm prompt, and the exact hunt must
    // still be live right before the guarded write below.
    const freshUserDetails = await dynamoHandler.findUser(userId, username);
    const freshHunt = freshUserDetails.companionHunt;
    if (!freshHunt || freshHunt.returnsAt !== hunt.returnsAt) {
        await interaction.editReply({ content: `${userDisplayName}, that expedition was already collected (or cancelled) elsewhere.`, components: [] });
        return;
    }

    const written = await dynamoHandler.resolveCompanionHunt(userId, hunt.returnsAt, { companionHunt: null });
    if (!written) {
        await interaction.editReply({ content: `${userDisplayName}, that expedition was already collected (or cancelled) elsewhere.`, components: [] });
        return;
    }

    await interaction.editReply({ content: `${userDisplayName}, you're back early — no companion this time, but /work is open again.`, components: [] });
}

async function runCollect(interaction) {
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    const hunt = userDetails.companionHunt;
    if (!hunt) {
        interaction.editReply(`${userDisplayName}, you're not out on an expedition right now.`);
        return;
    }
    if (hunt.returnsAt > Date.now()) {
        const remainingSeconds = Math.max(0, Math.ceil((hunt.returnsAt - Date.now()) / 1000));
        interaction.editReply(`${userDisplayName}, you're not back yet — you return in ${convertSecondstoMinutes(remainingSeconds)}.`);
        return;
    }

    const tier = companionHuntFactory.getTierByKey(hunt.tierKey);
    const result = companionHuntFactory.resolveHuntOutcome(userDetails);

    // result.companions (applyCompanionAward's own return) is already a complete,
    // ready-to-write companions object — only present on a hit, so a miss leaves
    // `companions` untouched entirely rather than writing a no-op copy of it.
    const setAttributes = { companionHunt: null };
    if (result.found) {
        setAttributes.companions = result.companions;
    }
    const written = await dynamoHandler.resolveCompanionHunt(userId, hunt.returnsAt, setAttributes);
    if (!written) {
        interaction.editReply(`${userDisplayName}, that expedition was already collected (or cancelled) elsewhere. Please try again!`);
        return;
    }

    const embed = embedFactory.createCompanionHuntResultEmbed(userDisplayName, tier, result);
    interaction.editReply({ embeds: [embed] });

    if (result.found) {
        // Same Big Events condition/shape as /work's own Wandering Companion encounter
        // (work.js) — a Companion Hunt pull rolls through the exact same
        // companionFactory.rollCompanion table, so it's just as capable of landing a
        // Mythic+ companion and deserves the same server-wide callout.
        if (bigEventsChannel.isBigEventCompanion(result.companion)) {
            await bigEventsChannel.postBigEvent({
                title: '🎉 Rare Companion!',
                description: `**${userDisplayName}** found a rare companion out on an expedition!`,
                fields: [
                    bigEventsChannel.playerField(userDisplayName),
                    bigEventsChannel.companionField(result.companion),
                    bigEventsChannel.sourceField('Found on a Companion Hunt'),
                ],
                color: bigEventsChannel.RARE_COMPANION_COLOR,
            });
        }

        const newlyUnlocked = await achievementFactory.checkAndUnlock({
            userId,
            achievements: userDetails.achievements,
            companions: result.companions
        });
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            interaction.followUp({ embeds: achievementEmbeds });
        }
    }
}

const TIER_CHOICES = CompanionHunt.TIERS.map(tier => ({ name: tier.label, value: tier.key }));
const TIER_KEYS = new Set(CompanionHunt.TIERS.map(tier => tier.key));

module.exports = {
    name: "companion-hunt",
    description: "Go looking for a new companion yourself — blocks /work for the chosen duration",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'action',
            description: 'How long to spend hunting (blocks /work), or collect/cancel your active expedition',
            required: true,
            type: ApplicationCommandOptionType.String,
            // All 3 duration tiers always listed, same "show every option" shape
            // RobNpc.TIERS' own heist-type choices use — no rank/level gate on this at all,
            // it's meant to be available to everyone from day one. collect/cancel (folded
            // in from their own former top-level commands) apply to whichever ONE hunt is
            // currently active, same as before.
            choices: [
                ...TIER_CHOICES,
                { name: 'collect (finish an expedition that has returned)', value: 'collect' },
                { name: 'cancel (come back from an expedition early)', value: 'cancel' },
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const action = interaction.options.get('action')?.value;

        if (action === 'collect') {
            await runCollect(interaction);
        } else if (action === 'cancel') {
            await runCancel(interaction);
        } else if (TIER_KEYS.has(action)) {
            await runHunt(interaction, action);
        }
    },
    // Exported for direct unit testing, same precedent /admin's own subcommand functions
    // and /leaderboard's towerLeaderboardCallback already set.
    huntCallback: runHunt,
    cancelCallback: runCancel,
    collectCallback: runCollect,
}
