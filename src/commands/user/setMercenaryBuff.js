const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { MercenaryBuff } = require("../../utils/constants");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const mercenaryBuffFactory = require("../../utils/mercenaryBuffFactory");

// A solo, weaker parallel to /set-buff (systems/mercenary-bounties.md#mercenary-buff) —
// lets an active mercenary pick one personal buff, scaled by Mercenary Rank instead of
// Guild Level, gated behind a switch cooldown (MercenaryBuff.SWITCH_COOLDOWN_SECONDS) so a
// player can't re-optimize their pick before every single action.
module.exports = {
    name: "set-mercenary-buff",
    description: "Set your personal Mercenary Buff",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'buff',
            description: 'buff choices',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                { name: 'rob-chance', value: 'robChance' },
                { name: 'work-timer', value: 'workTimer' },
                { name: 'work-multi', value: 'workMulti' },
                { name: 'bounty-timer', value: 'bountyTimer' }
            ]
        }
    ],

    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        // Gate 1: not-a-mercenary — same wording every other Mercenary-track command uses.
        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const buffSelect = interaction.options.get('buff')?.value;

        // Gate 2: same-category re-pick rejected as a no-op, checked BEFORE the cooldown
        // gate so this rejection never wrongly implies a cooldown block that isn't the
        // actual reason. No DB write, cooldown untouched.
        if (userDetails.mercenaryBuff === buffSelect) {
            interaction.editReply(`${userDisplayName}, your Mercenary Buff is already set to **${buffSelect}** — pick a different category to switch.`);
            return;
        }

        // Gate 3: cooldown check — skipped entirely on a first-ever pick, since
        // mercenaryBuffSwitchTimer defaults to 0 (Date.now() - 0 is always far past the
        // cooldown, no special-casing needed).
        const timeSinceSwitchInSeconds = Math.floor((Date.now() - userDetails.mercenaryBuffSwitchTimer) / 1000);
        const timeUntilSwitchAvailableInSeconds = MercenaryBuff.SWITCH_COOLDOWN_SECONDS - timeSinceSwitchInSeconds;
        if (timeSinceSwitchInSeconds < MercenaryBuff.SWITCH_COOLDOWN_SECONDS) {
            interaction.editReply(`${userDisplayName}, you switched your Mercenary Buff recently — wait ${convertSecondstoMinutes(timeUntilSwitchAvailableInSeconds)} before switching again.`);
            return;
        }

        const switchTimer = Date.now();
        await dynamoHandler.updateUserFields(userId, { mercenaryBuff: buffSelect, mercenaryBuffSwitchTimer: switchTimer });

        const rank = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount).rank;
        const nextSwitchAvailable = Math.floor((switchTimer + MercenaryBuff.SWITCH_COOLDOWN_SECONDS * 1000) / 1000);
        interaction.editReply(`${userDisplayName}, your Mercenary Buff is now set to **${buffSelect}**: ${mercenaryBuffFactory.getMercenaryBuffLabel(buffSelect, rank)}. Next switch available <t:${nextSwitchAvailable}:R>.`);
    }
}
