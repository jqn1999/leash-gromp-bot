const path = require('path');
const { ApplicationCommandOptionType } = require("discord.js");
const getAllFiles = require('../../utils/getAllFiles');
const { HelpTopics } = require("../../utils/constants");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const CATEGORY_LABELS = {
    betting: "Betting",
    buying: "Shop & Progression",
    games: "Games",
    guilds: "Guilds & Raids",
    misc: "Misc",
    starch: "Starch Market",
    tower: "Tater Tower",
    user: "Player",
};

// Scans the same commands/ tree getLocalCommands.js does, but keeps the folder name as a
// category label instead of flattening it away — moderation is skipped implicitly since
// every command in it is devOnly, same filter every player-facing command list should apply.
function getCategorizedCommands() {
    const categorized = {};
    const commandCategoryDirs = getAllFiles(path.join(__dirname, '..'), true);

    for (const dir of commandCategoryDirs) {
        const categoryKey = path.basename(dir);
        const label = CATEGORY_LABELS[categoryKey];
        if (!label) continue;

        const commandNames = getAllFiles(dir)
            .map(file => require(file))
            .filter(command => !command.deleted && !command.devOnly)
            .map(command => command.name)
            .sort();

        if (commandNames.length > 0) {
            categorized[label] = commandNames;
        }
    }
    return categorized;
}

module.exports = {
    name: "help",
    description: "Learn how Leash Gromp works, or look up a specific topic",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'topic',
            description: 'Which topic to view',
            required: false,
            type: ApplicationCommandOptionType.String,
            choices: HelpTopics.map(topic => ({ name: topic.label, value: topic.id }))
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const topicId = interaction.options.get('topic')?.value ?? "overview";

        let embed;
        if (topicId === "overview") {
            embed = embedFactory.createHelpOverviewEmbed();
        } else if (topicId === "companions") {
            embed = embedFactory.createHelpCompanionsEmbed();
        } else if (topicId === "commands") {
            embed = embedFactory.createHelpCommandsEmbed(getCategorizedCommands());
        } else {
            embed = embedFactory.createHelpTopicEmbed(topicId);
        }

        interaction.editReply({ embeds: [embed] });
    }
}
