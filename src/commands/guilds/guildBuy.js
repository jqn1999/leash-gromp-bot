const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles } = require("../../utils/constants");

const guildShops = [
    {
        shopId: "bankCapacity",
        description: "This is where you upgrade your guild bank",
        items: [
            {
                currentAmount: 0,
                amount: 10000000,
                cost: 1000000,
            },
            {
                currentAmount: 10000000,
                amount: 25000000,
                cost: 10000000,
            },
            {
                currentAmount: 25000000,
                amount: 50000000,
                cost: 25000000,
            },
            {
                currentAmount: 50000000,
                amount: 100000000,
                cost: 50000000,
            },
            {
                currentAmount: 100000000,
                amount: 200000000,
                cost: 100000000,
            },
            {
                currentAmount: 200000000,
                amount: 400000000,
                cost: 200000000,
            },
            {
                currentAmount: 400000000,
                amount: 600000000,
                cost: 400000000,
            },
            {
                currentAmount: 600000000,
                amount: 800000000,
                cost: 400000000,
            },
            {
                currentAmount: 800000000,
                amount: 1000000000,
                cost: 400000000,
            },
            {
                currentAmount: 1000000000,
                amount: 1200000000,
                cost: 600000000,
            },
            {
                currentAmount: 1200000000,
                amount: 1500000000,
                cost: 600000000,
            },
            {
                currentAmount: 1500000000,
                amount: 2000000000,
                cost: 800000000,
            },
            {
                currentAmount: 2000000000,
                amount: 2500000000,
                cost: 800000000,
            }
        ],
        title: "Guild Potato Storage Shop (increase bank capacity)"
    },
    {
        shopId: "memberCap",
        description: "This is where you upgrade your guild's member limit",
        items: [
            {
                currentAmount: 5,
                amount: 8,
                cost: 5000000,
            },
            {
                currentAmount: 8,
                amount: 12,
                cost: 20000000,
            },
            {
                currentAmount: 12,
                amount: 17,
                cost: 60000000,
            },
            {
                currentAmount: 17,
                amount: 25,
                cost: 150000000,
            }
        ],
        title: "Guild Roster Expansion Shop (increase member cap)"
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
        if (element.currentAmount == currentAmount) {
            chosenItem = shop.items[index];
            return chosenItem
        }
    }
    return -1;
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
                },
                {
                    name: 'member-cap',
                    value: 'member-cap'
                }
            ]
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let shopSelect = interaction.options.get('shop-select')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild!");
        if (!guild) return;
        const member = guild.memberList.find((currentMember) => currentMember.id == userId);
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        const canUpgrade = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canUpgrade) {
            interaction.editReply(`${userDisplayName} you need to be a co-leader or the leader to spend the guild bank on upgrades.`);
            return;
        }

        let guildBankStored = guild.bankStored;
        let guildBankCapacity = guild.bankCapacity;
        // bankCapacityBonus is Guild Contract's (see guildContractFactory.js) additive
        // reward, tracked separately so the shop's tier lookup runs against the
        // shop-purchased BASE value, not the reward-inflated total — same
        // base = total - bonus pattern buy.js/rebirthFactory.js use for the user shop
        // (userDetails.bankCapacity - sweetPotatoBuffs.bankCapacity - regradeAmount).
        // Without this, a contract reward knocks bankCapacity off the tier ladder's
        // exact-match values and every future purchase reports "already maxed out!".
        const guildBankCapacityBonus = Number.isFinite(guild.bankCapacityBonus) ? guild.bankCapacityBonus : 0;
        let guildBaseBankCapacity = guildBankCapacity - guildBankCapacityBonus;

        let chosenItem, guildHasEnough;
        switch (shopSelect) {
            case 'bank-capacity':
                const bankShop = guildShops.find((currentShop) => currentShop.shopId == 'bankCapacity');
                chosenItem = getNextItemFromShop(bankShop, guildBaseBankCapacity);
                if (chosenItem == -1) {
                    interaction.editReply(`${userDisplayName} this upgrade is already maxed out!`);
                    return;
                }
                guildHasEnough = doesGuildHaveEnoughToPurchase(guildBankStored, chosenItem.cost, interaction, userDisplayName);
                if (guildHasEnough) {
                    guildBankStored -= chosenItem.cost;
                    // Bonus re-added on top of the shop's flat tier value so it survives
                    // this purchase instead of being overwritten by it.
                    const newBankCapacity = chosenItem.amount + guildBankCapacityBonus;
                    await dynamoHandler.updateGuildDatabase(guild.guildId, 'bankStored', guildBankStored);
                    await dynamoHandler.updateGuildDatabase(guild.guildId, "bankCapacity", newBankCapacity);
                    interaction.editReply(`${userDisplayName} your guild bank upgrade has completed and you now have a max guild bank capacity of ${newBankCapacity.toLocaleString()}`);
                }
                break;
            case 'member-cap':
                const memberCapShop = guildShops.find((currentShop) => currentShop.shopId == 'memberCap');
                chosenItem = getNextItemFromShop(memberCapShop, guild.memberCap);
                if (chosenItem == -1) {
                    interaction.editReply(`${userDisplayName} this upgrade is already maxed out!`);
                    return;
                }
                guildHasEnough = doesGuildHaveEnoughToPurchase(guildBankStored, chosenItem.cost, interaction, userDisplayName);
                if (guildHasEnough) {
                    guildBankStored -= chosenItem.cost;
                    const newMemberCap = chosenItem.amount;
                    await dynamoHandler.updateGuildDatabase(guild.guildId, 'bankStored', guildBankStored);
                    await dynamoHandler.updateGuildDatabase(guild.guildId, "memberCap", newMemberCap);
                    interaction.editReply(`${userDisplayName} your guild's member cap has been upgraded to ${newMemberCap} members!`);
                }
                break;
        }
        return
    }
}