const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "shop",
    description: "Displays available items for each category",
    devOnly: false,
    options: [
        {
            name: 'shop-select',
            description: 'Which shop to display information for',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'work-shop',
                    value: 'work-shop'
                },
                {
                    name: 'passive-income-shop',
                    value: 'passive-income-shop'
                },
                {
                    name: 'bank-shop',
                    value: 'bank-shop'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let shopSelect = interaction.options.get('shop-select')?.value;
        let embed;
        switch (shopSelect) {
            case 'work-shop':
                const workShop = await dynamoHandler.getShop('workShop');
                embed = embedFactory.createShopEmbed(workShop);
                break;
            case 'passive-income-shop':
                const passiveIncomeShop = await dynamoHandler.getShop('passiveIncomeShop');
                embed = embedFactory.createShopEmbed(passiveIncomeShop);
                break;
            case 'bank-shop':
                const bankShop = await dynamoHandler.getShop('bankShop');
                embed = embedFactory.createShopEmbed(bankShop);
                break;
        }
        interaction.editReply({ embeds: [embed] });
    }
}