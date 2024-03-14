const { EventFactory } = require("../../utils/eventFactory");
const eventFactory = new EventFactory()

module.exports = {
    name: "current-event",
    description: "Displays the current event",
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const currentEvent = eventFactory.getCurrentEvent();
        if (!currentEvent) {
            interaction.editReply('There is no active event currently.');
            return;
        }
        interaction.editReply(`Current Event Active: ${currentEvent}`);
    }
}