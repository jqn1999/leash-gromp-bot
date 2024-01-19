require("dotenv").config();

module.exports = {
    aws_table_name: 'leash-gromp-bot',
    aws_birthday_table_name: 'leash-gromp-bot-birthdays',
    aws_betting_table_name: 'leash-gromp-bot-betting',
    aws_stats_table_name: 'leash-gromp-stats',
    aws_shop_table_name: 'leash-gromp-bot-shop',
    aws_guilds_table_name: 'leash-gromp-bot-guilds',
    aws_local_config: {
      //Provide details for local configuration
    },
    aws_remote_config: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
    },
    testServer: "168379467931058176",
    clientId: "1187560268172116029",
    devs: ["103243257240121344"]
};