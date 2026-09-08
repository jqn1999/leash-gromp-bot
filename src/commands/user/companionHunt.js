const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionHuntFactory = require("../../utils/companionHuntFactory");
const { CompanionHunt } = require("../../utils/constants");

module.exports = {
    name: "companion-hunt",
    description: "Go looking for a new companion yourself — blocks /work for the chosen duration",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'duration',
            description: 'How long to spend hunting — longer odds are better, but /work is blocked the whole time',
            required: true,
            type: ApplicationCommandOptionType.String,
            // All 3 tiers always listed, same "show every option" shape RobNpc.TIERS'
            // own heist-type choices use — no rank/level gate on this at all, it's meant to
            // be available to everyone from day one.
            choices: CompanionHunt.TIERS.map(tier => ({ name: tier.label, value: tier.key }))
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const tierKey = interaction.options.get('duration')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const existingHunt = userDetails.companionHunt;
        if (existingHunt) {
            if (existingHunt.returnsAt <= Date.now()) {
                interaction.editReply(`${userDisplayName}, you're already back from your last expedition — run /companion-hunt-collect first!`);
            } else {
                const remainingSeconds = Math.max(0, Math.ceil((existingHunt.returnsAt - Date.now()) / 1000));
                interaction.editReply(`${userDisplayName}, you're already out on an expedition — you return in ${convertSecondstoMinutes(remainingSeconds)}. Only one expedition can be active at a time.`);
            }
            return;
        }

        const tier = companionHuntFactory.getTierByKey(tierKey);
        // Plain unconditional write, same low/no-stakes race precedent
        // companionScavenge.js's own dispatch write already relies on — a player can only
        // ever race against their own other command calls, and a lost race just means
        // whichever write lands last persists, nothing is ever double-granted or orphaned.
        const companionHunt = companionHuntFactory.buildHuntDispatch(tierKey);
        await dynamoHandler.updateUserFields(userId, { companionHunt });

        interaction.editReply(`${userDisplayName}, you head out on a ${tier.label}! /work is blocked until you're back in ${convertSecondstoMinutes(tier.durationSeconds)} — run /companion-hunt-collect once you've returned (or /companion-hunt-cancel to come back early).`);
    }
}
