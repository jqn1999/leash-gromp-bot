const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionHuntFactory = require("../../utils/companionHuntFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

module.exports = {
    name: "companion-hunt-collect",
    description: "Collect the result of a companion expedition once you're back",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
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
}
