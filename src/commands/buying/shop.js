const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

async function createShopEmbed(shopDetails) {
    const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
    const shopItems = shopDetails.items;
    let shopList = []
    for (const [index, element] of shopItems.entries()) {
        const item = {
            name: `${element.id}) ${element.name} (${element.amount})`,
            value: `${element.description}\nId: ${element.id} | Cost: ${element.cost}`,
            inline: false,
        };
        shopList.push(item);
    }

    const embed = new EmbedBuilder()
        .setTitle(`${shopDetails.title}`)
        .setDescription(`${shopDetails.description}`)
        .setColor("Random")
        .setThumbnail(avatarUrl)
        .setFooter({text: "Made by Beggar"})
        .setTimestamp(Date.now())
        .setFields(shopList)
    return embed;
}

module.exports = {
    name: "shop",
    description: "Displays available items for each category",
    devOnly: false,
    // testOnly: false,
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
                embed = await createShopEmbed(workShop);
                break;
            case 'passive-income-shop':
                const passiveIncomeShop = await dynamoHandler.getShop('passiveIncomeShop');
                embed = await createShopEmbed(passiveIncomeShop);
                break;
            case 'bank-shop':
                const bankShop = await dynamoHandler.getShop('bankShop');
                embed = await createShopEmbed(bankShop);
                break;
        }
        interaction.editReply({ embeds: [embed] });
    }
}