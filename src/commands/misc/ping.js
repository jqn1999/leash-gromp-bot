module.exports = {
    name: "ping",
    description: "pong!",
    // devOnly: false,
    // testOnly: false,
    // options: Object[],
    deleted: true,
    callback: (client, interaction) => {
        interaction.reply(`pong! ${client.ws.ping}ms`);
    }
}