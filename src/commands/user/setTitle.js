const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { TitleFactory } = require("../../utils/titleFactory");
const { Titles } = require("../../utils/constants");
const titleFactory = new TitleFactory();

// Titles (systems/titles.md) — a purely cosmetic switch, mirrors /companion-fuse's exact
// autocomplete-then-server-side-revalidate pattern: never trust the client's earlier
// autocomplete selection, re-fetch fresh userDetails in both autocomplete and the callback.
// No cooldown — unlike /set-buff/set-mercenary-buff (which gate re-picks to stop
// flip-flopping a live mechanical bonus), a cosmetic-only switch has no mechanical reason to
// be rate-limited.
module.exports = {
    name: "set-title",
    description: "Equip a Title you've earned, shown on your /profile",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'title',
            description: 'Which title to equip',
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

        const unlockedTitles = await titleFactory.getUnlockedTitles(userDetails);
        const noneChoice = { name: "None (show no title)", value: "none" };
        const matchingChoices = unlockedTitles
            .filter(title => title.label.toLowerCase().includes(focused))
            .slice(0, 24) // leave room for the always-first "none" choice under Discord's 25-choice cap
            .map(title => ({ name: title.label, value: title.id }));

        await interaction.respond([noneChoice, ...matchingChoices]);
    },
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const titleSelect = interaction.options.get('title')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (titleSelect === "none") {
            await dynamoHandler.updateUserFields(userId, { equippedTitle: null });
            interaction.editReply(`${userDisplayName}, your title has been cleared — none currently equipped.`);
            return;
        }

        const title = Titles.find(t => t.id === titleSelect);
        if (!title) {
            interaction.editReply(`${userDisplayName}, that title doesn't exist — run /titles to see the full list.`);
            return;
        }

        const isUnlocked = await titleFactory.isTitleUnlocked(userDetails, title.id);
        if (!isUnlocked) {
            interaction.editReply(`${userDisplayName}, you haven't earned **${title.label}** yet — ${title.description}`);
            return;
        }

        await dynamoHandler.updateUserFields(userId, { equippedTitle: title.id });
        interaction.editReply(`${userDisplayName}, your title is now **${title.label}** — ${title.description}`);
    }
}
