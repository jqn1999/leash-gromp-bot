const { ApplicationCommandOptionType } = require("discord.js");
const { EventFactory } = require("../../utils/eventFactory");
const { setWorkScenarios } = require("../../commands/user/work.js");

// Same channel/role backgroundEvents.js's own hourly roll posts to — this command is a
// manual trigger for the exact same event, not a separate/quieter path.
const EVENT_CHANNEL_ID = '1188525931346792498';
const EVENT_ROLE_ID = '1207117686526582865';

// eF is the SAME singleton backgroundEvents.js holds (EventFactory guards its own
// constructor against a second instance) — mutating it here is exactly as real as the
// scheduled hourly roll, not a preview/test copy.
const eF = new EventFactory();

const EVENT_CHOICES = [
    { name: 'Large Potato chance x2', value: 'LARGEX2' },
    { name: 'Sweet Potato chance x2', value: 'SWEETX2' },
    { name: 'Metal Potato chance x2', value: 'METALX2' },
    { name: 'Poison Potato chance x2', value: 'POISONX2' },
    { name: 'Taro Trader chance x2', value: 'TAROX2' },
    { name: 'Golden Potato chance x5', value: 'GOLDENX5' },
    { name: 'Metal Potato chance x5', value: 'METALX5' },
    { name: 'Poison Potato chance x5', value: 'POISONX5' },
    { name: 'Clear current event (back to normal odds)', value: 'CLEAR' },
];

module.exports = {
    name: "admin-trigger-event",
    description: "Force a specific /work special event, or clear the current one (admin only)",
    devOnly: true,
    deleted: false,
    options: [
        {
            name: 'event',
            description: 'Which event to trigger',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: EVENT_CHOICES,
        },
        {
            name: 'announce',
            description: 'Post the public announcement to the events channel? (default: yes)',
            required: false,
            type: ApplicationCommandOptionType.Boolean,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const event = interaction.options.get('event')?.value;
        const announce = interaction.options.get('announce')?.value ?? true;

        if (event === 'CLEAR') {
            eF.setEmptyCurrentEvent();
            setWorkScenarios(eF.getWorkChances());
            interaction.editReply(`Cleared the current event — /work odds are back to normal.`);
            return;
        }

        // Mirrors backgroundEvents.js's own hourly roll exactly, just skipping the random
        // pick: apply -> push the boosted odds live -> reset the singleton back to base so
        // it's ready for the next natural roll or trigger, same as the scheduled job does.
        eF.applyEvent(event);
        const eventName = eF.getCurrentEvent();
        setWorkScenarios(eF.getWorkChances());
        eF.setBaseWorkChances();
        eF.setBaseWorkProbability();

        if (announce) {
            const channel = await client.channels.fetch(EVENT_CHANNEL_ID);
            await channel.send(`<@&${EVENT_ROLE_ID}> Special event on the way this hour! ${eventName}`);
            interaction.editReply(`Triggered: ${eventName} — announced in <#${EVENT_CHANNEL_ID}>. Odds are live now and will hold until the next hourly event roll (not a fixed duration).`);
        } else {
            interaction.editReply(`Triggered: ${eventName} — no announcement sent, odds are live now and will hold until the next hourly event roll (not a fixed duration).`);
        }
    }
}
