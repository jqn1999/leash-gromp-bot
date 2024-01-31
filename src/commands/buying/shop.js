const { ApplicationCommandOptionType } = require("discord.js");
const { shops } = require("../../utils/constants");
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
                const workShop = shops.find((currentShop) => currentShop.shopId == 'workShop');
                embed = embedFactory.createShopEmbed(workShop);
                break;
            case 'passive-income-shop':
                const passiveIncomeShop = shops.find((currentShop) => currentShop.shopId == 'passiveIncomeShop');
                embed = embedFactory.createShopEmbed(passiveIncomeShop);
                break;
            case 'bank-shop':
                const bankShop = shops.find((currentShop) => currentShop.shopId == 'bankShop');
                embed = embedFactory.createShopEmbed(bankShop);
                break;
        }
        interaction.editReply({ embeds: [embed] });
    }
}