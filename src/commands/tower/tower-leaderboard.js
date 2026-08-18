const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "tower-leaderboard",
    description: "View today's Tater Tower leaderboard (survived runs only)",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const entries = await dynamoHandler.getTowerLeaderboard();
        const sorted = [...entries].sort((a, b) => b.floor - a.floor);
        const embed = embedFactory.createTowerLeaderboardEmbed(sorted);
        interaction.editReply({ embeds: [embed] });
    }
}
