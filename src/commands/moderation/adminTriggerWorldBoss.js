const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { worldFactory, worldBossMobs } = require("../../utils/worldFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const MAIN_CHANNEL_ID = '1188525931346792498';
const WORLD_EVENT_ROLE_ID = '1207117686526582865';

module.exports = {
    name: "admin-world-boss",
    description: "Spawn a specific world boss (admin only)",
    devOnly: true,
    deleted: false,
    options: [
        {
            name: 'boss',
            description: 'Which world boss to spawn',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: worldBossMobs.map((mob, index) => ({
                name: mob.name,
                value: index.toString(),
            })),
        }
    ],
    callback: async (client, interaction) => {
        const world = await dynamoHandler.getStatDatabase("world");
        if (world?.world_active) {
            interaction.reply({
                content: `There's already an active world boss (${worldBossMobs[world.world_index]?.name ?? 'unknown'}). Wait for it to be resolved before spawning another.`,
                ephemeral: true
            });
            return;
        }

        const selectedIndex = Number(interaction.options.get('boss')?.value);
        const factory = new worldFactory();
        await factory.setWorldBoss(selectedIndex);
        const embed = factory.getWorldEmbed();

        const channel = await client.channels.fetch(MAIN_CHANNEL_ID);
        await channel.send({ embeds: [embed] });
        await channel.send(`<@&${WORLD_EVENT_ROLE_ID}>`);

        interaction.reply({
            content: `Spawned ${worldBossMobs[selectedIndex].name} in <#${MAIN_CHANNEL_ID}>.`,
            ephemeral: true
        });
    }
}
