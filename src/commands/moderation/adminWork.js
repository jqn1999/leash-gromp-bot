const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { getUserInteractionDetails, getRandomFromInterval } = require("../../utils/helperCommands");
const { Work, Companions } = require("../../utils/constants");
const { WORK_SCENARIO_INDICES } = require("../../utils/eventFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const work = require("./../user/work");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

const SCENARIO_TYPES = {
    regular: WORK_SCENARIO_INDICES.REGULAR,
    large: WORK_SCENARIO_INDICES.LARGE,
    sweet: WORK_SCENARIO_INDICES.SWEET,
    taro: WORK_SCENARIO_INDICES.TARO,
    poison: WORK_SCENARIO_INDICES.POISON,
    metal: WORK_SCENARIO_INDICES.METAL,
    golden: WORK_SCENARIO_INDICES.GOLDEN,
    companion: WORK_SCENARIO_INDICES.COMPANION,
};

module.exports = {
    name: "admin-work",
    description: "devOnly — force a specific /work scenario (and optionally a specific companion) for testing",
    devOnly: true,
    deleted: false,
    options: [
        {
            name: 'scenario',
            description: 'Which /work scenario to force',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: Object.keys(SCENARIO_TYPES).map(name => ({ name, value: name }))
        },
        {
            name: 'companion',
            description: 'Force this exact companion (only used when scenario is "companion")',
            required: false,
            type: ApplicationCommandOptionType.String,
            choices: Companions.map(c => ({ name: c.name, value: c.id }))
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const scenarioName = interaction.options.get('scenario')?.value;
        const forcedCompanionId = interaction.options.get('companion')?.value;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const scenario = work.workScenarios.find(s => s.type === SCENARIO_TYPES[scenarioName]);
        if (!scenario) {
            interaction.editReply(`Unknown scenario "${scenarioName}".`);
            return;
        }

        // Reuses the exact same action/embed every real /work call uses (so what you see
        // here is exactly what a player would see), but skips the workTimer cooldown
        // check and does NOT touch the shared "work" stats doc (workCount/totalPayout) —
        // this is a test invocation, not a real one, and shouldn't inflate global economy
        // stats other systems (server-wealth work scaling, etc.) read from that doc.
        const workStat = await dynamoHandler.getStatDatabase('work');
        const newWorkCount = (workStat?.workCount || 0) + 1;
        const total = await dynamoHandler.getCachedServerTotal();
        const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL);
        const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;
        const multiplier = getRandomFromInterval(.8, 1.2);
        const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);

        await scenario.action(userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId);

        // Still worth checking — e.g. verifying a forced Mythic companion actually
        // unlocks mythic_bond, or a forced golden pull unlocks lucky_find.
        const updatedUserDetails = await dynamoHandler.findUser(userId, username);
        if (updatedUserDetails) {
            const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
            if (newlyUnlocked.length > 0) {
                const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
                interaction.followUp({ embeds: achievementEmbeds, ephemeral: true });
            }
        }
    }
}
