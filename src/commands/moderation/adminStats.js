const { PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { worldBossMobs } = require("../../utils/worldFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "admin-stats",
    description: "Admin-only dashboard of the game's cached economy/starch/world/quest state",
    devOnly: true,
    // testOnly: false,
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        const [economy, starch, world, activeQuests] = await Promise.all([
            dynamoHandler.getStatDatabase("economy"),
            dynamoHandler.getStatDatabase("starch"),
            dynamoHandler.getStatDatabase("world"),
            dynamoHandler.getActiveQuests(),
        ]);

        // Buy/sell window check, identical to starchPrice.js/buyStarch.js/sellStarch.js —
        // Monday 10:00-21:59, Thursday 22:00-23:59, Friday 00:00-09:59 is a buy window,
        // everything else is a sell window.
        const date = new Date();
        const isMondayAndBuyingTime = date.getDay() == 1 && (date.getHours() >= 10 && date.getHours() <= 21);
        const isThursdayAndBuyingTime = date.getDay() == 4 && date.getHours() >= 22;
        const isFridayAndBuyingTime = date.getDay() == 5 && date.getHours() <= 9;
        const isBuyWindow = isMondayAndBuyingTime || isThursdayAndBuyingTime || isFridayAndBuyingTime;
        const starchStatus = {
            phase: isBuyWindow ? 'buy' : 'sell',
            price: starch ? (isBuyWindow ? starch.starch_buy : starch.starch_sell) : null,
        };

        // world_index only means anything while world_active is true — an inactive doc's
        // stale index shouldn't be resolved against worldBossMobs.
        const worldActive = !!(world && world.world_active);
        const worldStatus = {
            active: worldActive,
            bossName: worldActive ? (worldBossMobs[world.world_index]?.name ?? "Unknown boss") : null,
            raidMemberCount: worldActive ? (world.world_list || []).length : 0,
        };

        const embed = embedFactory.createAdminStatsEmbed(economy, starchStatus, worldStatus, activeQuests);
        interaction.editReply({ embeds: [embed] });
    }
}
