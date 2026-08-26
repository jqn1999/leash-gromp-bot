const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
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

        const { owned, starchesGained, workCountGained, multiplierTier, scavengeReturnsByRarity, maxLevelCount, mythicMaxLevelCount } = companionFactory.resolveScavengeReward(userDetails);

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
