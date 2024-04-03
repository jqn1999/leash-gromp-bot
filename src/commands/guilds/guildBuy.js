const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

const guildShops = [
    {
        shopId: "bankCapacity",
        description: "This is where you upgrade your guild bank",
        items: [
            {
                amount: 10000000,
                cost: 1000000,
            },
            {
                amount: 25000000,
                cost: 10000000,
            },
            {
                amount: 50000000,
                cost: 25000000,
            },
            {
                amount: 100000000,
                cost: 50000000,
            },
            {
                amount: 200000000,
                cost: 100000000,
            },
            {
                amount: 400000000,
                cost: 200000000,
            },
            {
                amount: 600000000,
                cost: 400000000,
            },
            {
                amount: 800000000,
                cost: 400000000,
            },
            {
                amount: 1000000000,
                cost: 400000000,
            },
            {
                amount: 1200000000,
                cost: 600000000,
            },
            {
                amount: 1500000000,
                cost: 600000000,
            },
            {
                amount: 2000000000,
                cost: 800000000,
            },
            {
                amount: 2500000000,
                cost: 800000000,
            }
        ],
        title: "Guild Potato Storage Shop (increase bank capacity)"
    }
]

function doesGuildHaveEnoughToPurchase(currentPotatoes, itemSelectedCost, interaction, userDisplayName) {
    if (currentPotatoes < itemSelectedCost) {
        interaction.editReply(`${userDisplayName} you do not have enough to purchase this item! You currently have ${currentPotatoes.toLocaleString()} potatoes in your guild bank and need ${(itemSelectedCost-currentPotatoes).toLocaleString()} more potatoes!`)
        return false;
    }
    return true
}

function getNextItemFromShop(shop, currentAmount) {
    let chosenItem;
    for (const [index, element] of shop.items.entries()) {
        if (element.cost == currentAmount) {
            if (index == shop.items.length-1) {
                return 0
            }
            chosenItem = shop.items[index];
        }
    }
    return chosenItem;
}

module.exports = {
    name: "guild-upgrade",
    description: "Upgrades a stat for a given category",
    devOnly: false,
    // testOnly: false,
    options: [
        {
            name: 'shop-select',
            description: 'Which shop to select to upgrade your stats',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'bank-capacity',
                    value: 'bank-capacity'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let shopSelect = interaction.options.get('shop-select')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild!`);
            return;
        }
        let guild = await dynamoHandler.findGuildById(userGuildId);
        let guildBankStored = guild.bankStored;
        let guildBankCapacity = guild.bankCapacity;

        let chosenItem, guildHasEnough;
        switch (shopSelect) {
            case 'bank-capacity':
                const bankShop = guildShops.find((currentShop) => currentShop.shopId == 'bankCapacity');
                chosenItem = getNextItemFromShop(bankShop, guildBankCapacity);
                if (chosenItem == 0) {
                    interaction.editReply(`${userDisplayName} this upgrade is already maxed out!`);
                    return;
                }
                console.log(chosenItem)
                guildHasEnough = doesGuildHaveEnoughToPurchase(guildBankStored, chosenItem.cost, interaction, userDisplayName);
                if (guildHasEnough) {
                    guildBankStored -= chosenItem.cost;
                    const newBankCapacity = chosenItem.amount;
                    await dynamoHandler.updateGuildDatabase(userGuildId, 'bankStored', guildBankStored);
                    await dynamoHandler.updateGuildDatabase(userGuildId, "bankCapacity", newBankCapacity);
                    interaction.editReply(`${userDisplayName} your guild bank upgrade has completed and you now have a max guild bank capacity of ${newBankCapacity.toLocaleString()}`);
                }
                break;
        }
        return
    }
}