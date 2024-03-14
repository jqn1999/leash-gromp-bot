module.exports = async (client, message) => {
    if (message.isChatInputCommand) return;
    if (message.author.bot) return;
};