const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const { Companions } = require("../../utils/constants");

module.exports = {
    name: "companion-scavenge",
    description: "Send an owned, unequipped companion out scavenging for workCount and starches",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'companion',
            description: 'Which companion to send scavenging (must not be your active companion)',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: Companions.map(companion => ({ name: companion.name, value: companion.id }))
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const companionId = interaction.options.get('companion')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const companion = companionFactory.getCompanionById(companionId);
        if (!companion) {
            interaction.editReply(`${userDisplayName}, that's not a real companion.`);
            return;
        }
        if (!companionFactory.ownsCompanion(userDetails, companionId)) {
            interaction.editReply(`${userDisplayName}, you don't own that companion.`);
            return;
        }
        if (userDetails.companions?.active === companionId) {
            interaction.editReply(`${userDisplayName}, ${companion.name} is your active companion — equip a different one first (or leave it equipped) before sending it scavenging.`);
            return;
        }
        const existingScavenge = userDetails.companions?.scavenging;
        if (existingScavenge) {
            const scavengingCompanion = companionFactory.getCompanionById(existingScavenge.companionId);
            const scavengingName = scavengingCompanion?.name ?? 'A companion';
            if (existingScavenge.returnsAt <= Date.now()) {
                interaction.editReply(`${userDisplayName}, ${scavengingName} is already out scavenging and is ready to come home — run /companion-scavenge-collect first!`);
            } else {
                const remainingSeconds = Math.max(0, Math.ceil((existingScavenge.returnsAt - Date.now()) / 1000));
                interaction.editReply(`${userDisplayName}, ${scavengingName} is already out scavenging — it returns in ${convertSecondstoMinutes(remainingSeconds)}. Only one companion can scavenge at a time.`);
            }
            return;
        }

        // Plain unconditional write, deliberately not race-guarded — same low/no-stakes
        // race /companion's equip button already tolerates. A raced double-dispatch just means
        // whichever write lands last persists; no reward can be double-granted and no
        // companion is ever orphaned by it. See dynamoHandler.resolveScavenge's own
        // comment for the guarded collect/cancel writes this deliberately does NOT need.
        const scavenging = companionFactory.buildScavengeDispatch(companion);
        await dynamoHandler.updateUserFields(userId, {
            companions: { ...userDetails.companions, scavenging }
        });

        interaction.editReply(`${userDisplayName}, ${companion.name} heads out scavenging! It'll be back in ${convertSecondstoMinutes(Math.ceil((scavenging.returnsAt - Date.now()) / 1000))} — run /companion-scavenge-collect once it's returned.`);
    }
}
