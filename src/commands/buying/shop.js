const { ApplicationCommandOptionType, EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

const workShop = {
    title: "Work Shop Tools",
    description: "This is where you buy tools and gear to improve work yield"
}
const workItems = [
    {
        name: `Barely Adequate Gear (50k)`,
        description: `Grants additional 20% to base work amount`,
    },
    {
        name: `Legendary Enchanted Trimmed Set of Something (1MM)`,
        description: `Grants additional 5000% to base work amount`,
    }
]

const passiveIncomeShop = {
    title: "Passive Income Shop Workers",
    description: "This is where you buy workers to improve passive yield"
}
const passiveIncomeItems = [
    {
        name: `Barely Adequate Bot (50k)`,
        description: `Grants additional 10k per day`,
    },
    {
        name: `Legendary Fkin Turbo OP Bot of Potato Spawning (1MM)`,
        description: `Grants additional 500k potatoes per day`,
    }
]

async function createShopEmbed(shopDetails, shopItems) {
    const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
    let shopList = []
    for (const [index, element] of shopItems.entries()) {
        const item = {
            name: `${index+1}) ${element.name}`,
            value: `${element.description}`,
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
    devOnly: true,
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
                embed = await createShopEmbed(workShop, workItems);
                break;
            case 'passive-income-shop':
                embed = await createShopEmbed(passiveIncomeShop, passiveIncomeItems);
                break;
        }
        interaction.editReply({ embeds: [embed] });
    }
}