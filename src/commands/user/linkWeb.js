const { ApplicationCommandOptionType } = require("discord.js");
const crypto = require("crypto");
const { getUserInteractionDetails } = require("../../utils/helperCommands");
const dynamoHandler = require("../../utils/dynamoHandler");

module.exports = {
    name: "link-web",
    description: "Get your private code to link this account to the Beggar Financial web dashboard",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'regenerate',
            description: 'Invalidate your existing code and issue a new one (use this if your old code leaked)',
            type: ApplicationCommandOptionType.Boolean,
            required: false,
        }
    ],
    callback: async (client, interaction) => {
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.reply({ content: `${userDisplayName} could not be looked up due to a database error, please try again!`, ephemeral: true });
            return;
        }

        const regenerate = interaction.options.get('regenerate')?.value ?? false;
        let token = userDetails.webLinkToken;
        if (!token || regenerate) {
            token = crypto.randomUUID();
            await dynamoHandler.updateUserFields(userId, { webLinkToken: token });
        }

        interaction.reply({
            content: `${userDisplayName}, here is your private web-linking code. Paste it into the "Link Discord Account" field on the Beggar Financial Gromp page to connect your account.\n\n\`${token}\`\n\n**Do not share this with anyone** — anyone who has it can act as you on the web dashboard. If you think it's leaked, run \`/link-web regenerate:true\` to invalidate it and get a new one.`,
            ephemeral: true
        });
    }
}
