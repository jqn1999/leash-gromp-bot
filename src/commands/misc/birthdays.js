const { getSortedBirthdays } = require("../../utils/helperCommands");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "birthdays",
    description: "Gets a list of the next 5 birthdays",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const birthdaysInOrder = await getSortedBirthdays();
        
        const embed = await embedFactory.createBirthdayEmbed(birthdaysInOrder);
        interaction.editReply({ embeds: [embed] });
    }
}