const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const rebirthFactory = require("../../utils/rebirthFactory");
const { getGuildWorkMulti, getCompanionWorkMulti, getWorldBuffWorkMulti, applyCatchUp } = require("../../utils/workFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

module.exports = {
    name: "companion-scavenge-collect",
    description: "Collect the reward from a companion that's back from scavenging",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const scavenging = userDetails.companions?.scavenging;
        if (!scavenging) {
            interaction.editReply(`${userDisplayName}, nothing is out scavenging right now.`);
            return;
        }
        if (scavenging.returnsAt > Date.now()) {
            const remainingSeconds = Math.max(0, Math.ceil((scavenging.returnsAt - Date.now()) / 1000));
            interaction.editReply(`${userDisplayName}, that companion isn't back yet — it returns in ${convertSecondstoMinutes(remainingSeconds)}.`);
            return;
        }

        const ownedEntryBefore = companionFactory.getOwnedEntry(userDetails, scavenging.instanceId);
        const companion = companionFactory.getCompanionById(ownedEntryBefore?.id);
        const workCountBefore = ownedEntryBefore?.workCount || 0;

        // Multi-scaled starch bonus (2026-09-07, direct instruction — see
        // companionFactory.getScavengeMultiplierBonus's own comment) — computed the exact
        // same way workFactory.js's handleGoldenYam computes its own effective multiplier,
        // so "up to 100% of what a Golden Yam would give this player" is literal. Only
        // Legendary/Mythic/Heirloom scavenges actually use this (Common/Rare have no
        // GOLDEN_YAM_VALUE_PERCENT entry, so the bonus resolves to a flat 0 for them
        // regardless), but it's cheap to always compute rather than branch on rarity here.
        const userMultiplier = userDetails.workMultiplierAmount;
        const guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const worldBuffMultiplier = await getWorldBuffWorkMulti(userMultiplier);
        const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);

        const { owned, starchesGained, workCountGained, multiplierTier, scavengeReturnsByRarity, maxLevelCount, mythicMaxLevelCount } = companionFactory.resolveScavengeReward(userDetails, effectiveMultiplier);

        const written = await dynamoHandler.resolveScavenge(userId, scavenging.instanceId, {
            companions: { ...userDetails.companions, owned, scavenging: null, scavengeReturnsByRarity, maxLevelCount, mythicMaxLevelCount },
            starches: (userDetails.starches || 0) + starchesGained
        });
        if (!written) {
            interaction.editReply(`${userDisplayName}, that scavenge was already collected (or cancelled) elsewhere. Please try again!`);
            return;
        }

        const embed = embedFactory.createScavengeReturnEmbed(userDisplayName, companion, workCountBefore, workCountBefore + workCountGained, starchesGained, multiplierTier);
        interaction.editReply({ embeds: [embed] });

        // Legendary Legwork / Mythic Milestones / Max-Level capstone — checked against the
        // just-written counts rather than re-fetching, same "build the post-write shape
        // locally" shortcut work.js's own achievement check takes.
        const newlyUnlocked = await achievementFactory.checkAndUnlock({
            userId,
            achievements: userDetails.achievements,
            companions: { ...userDetails.companions, scavengeReturnsByRarity, maxLevelCount, mythicMaxLevelCount }
        });
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            interaction.followUp({ embeds: achievementEmbeds });
        }
    }
}
