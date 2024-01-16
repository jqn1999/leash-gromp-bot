const { EmbedBuilder } = require("discord.js");
const dynamoHandler = require("../utils/dynamoHandler");

class EmbedFactory {
    async createUserEmbed(userId, currentName, userAvatarHash, userDetails) {
        const potatoes = userDetails.potatoes;
        const avatarUrl = getUserAvatar(userId, userAvatarHash);
        let title = `${currentName}`;
        if (userDetails.guildId != 0) {
            const guild = await dynamoHandler.findGuildById(userDetails.guildId);
            title += ` (${guild.guildName})`
        }

        let fields = [];
        fields.push({
            name: "Current Potatoes:",
            value: `${potatoes} potatoes`,
            inline: false,
        });
        fields.push({
            name: "Banked Potatoes:",
            value: `${userDetails.bankStored} potatoes`,
            inline: false,
        });
        fields.push({
            name: "Current Work Multiplier:",
            value: `${(userDetails.workMultiplierAmount).toFixed(2)}`,
            inline: false,
        });
        fields.push({
            name: "Current Passive Income:",
            value: `${userDetails.passiveAmount} potatoes per day`,
            inline: false,
        });
        fields.push({
            name: "Current Bank Capacity:",
            value: `${userDetails.bankCapacity} potatoes`,
            inline: false,
        });

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription("This is your profile where\nyou can view your potatoes")
            .setColor("Random")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields);
        return embed;
    }

    createUserStatsEmbed(userId, currentName, userAvatarHash, userDetails) {
        const avatarUrl = getUserAvatar(userId, userAvatarHash);

        const embed = new EmbedBuilder()
            .setTitle(`${currentName}`)
            .setDescription("This is your stats profile where\nyou can view your total gains and losses")
            .setColor("Random")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .addFields(
                {
                    name: "Total Earnings:",
                    value: `${userDetails.totalEarnings} potatoes`,
                    inline: false,
                },
                {
                    name: "Total Losses:",
                    value: `${userDetails.totalLosses} potatoes`,
                    inline: false,
                }
            );
        return embed;
    }

    createUserLeaderboardEmbed(sortedUsers, total, userIndex) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        let userList = []
        for (const [index, element] of sortedUsers.entries()) {
            let currentUserTotalPotatoes = element.potatoes + element.bankStored;
            if (index < 5) {
                const user = {
                    name: `${index + 1}) ${element.username}`,
                    value: `${element.potatoes} potatoes (${currentUserTotalPotatoes} potatoes total) (${(currentUserTotalPotatoes / total * 100).toFixed(2)}%)`,
                    inline: false,
                };
                userList.push(user);
            } else {
                break;
            }
        }
        let userTotalPotatoes = sortedUsers[userIndex].potatoes + sortedUsers[userIndex].bankStored;
        userList.push({
            name: `${userIndex + 1}) ${sortedUsers[userIndex].username}`,
            value: `${sortedUsers[userIndex].potatoes} potatoes (${userTotalPotatoes} potatoes total) (${(userTotalPotatoes / total * 100).toFixed(2)}%)`,
            inline: false,
        });

        const embed = new EmbedBuilder()
            .setTitle(`Server Leaderboard (${total} potatoes)`)
            .setDescription(`This is where the top 5 members' wealth are displayed... your rank is at the bottom.`)
            .setColor("Random")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createGuildLeaderboardEmbed(sortedGuilds) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        let guildList = []
        for (const [index, element] of sortedGuilds.entries()) {
            if (index < 5) {
                const guild = {
                    name: `${index + 1}) ${element.guildName} (Level: ${element.level}, Members: ${element.memberList.length})`,
                    value: `Leader: ${element.leader.username}, Raid Count: ${element.raidCount}`,
                    inline: false,
                };
                guildList.push(guild);
            } else {
                break;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`Guild Leaderboard (${sortedGuilds.length} Guilds)`)
            .setDescription(`This is where the top 5 guilds are displayed`)
            .setColor("Random")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(guildList)
        return embed;
    }

    createShopEmbed(shopDetails) {
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
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(shopList)
        return embed;
    }

    async createBetEmbed(betDetails, interaction) {
        let odds, ratio;
        let fields = [];
        if (betDetails.optionOneTotal > betDetails.optionTwoTotal) {
            odds = (betDetails.optionOneTotal / betDetails.optionTwoTotal).toFixed(2);
            ratio = `${odds} : 1.00`
        } else {
            odds = (betDetails.optionTwoTotal / betDetails.optionOneTotal).toFixed(2);
            ratio = `1.00 : ${odds}`
        }

        if (!betDetails.thumbnailUrl) {
            betDetails.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        fields.push({
            name: `1) ${betDetails.optionOne}`,
            value: `${betDetails.optionOneTotal} potatoes`,
            inline: true,
        })
        fields.push({
            name: `2) ${betDetails.optionTwo}`,
            value: `${betDetails.optionTwoTotal} potatoes`,
            inline: true,
        })

        if (betDetails.optionOneTotal != betDetails.baseAmount) {
            let largestVoterOptionOne = { userId: "", bet: 0, displayName: "" };
            let optionOneSplit, optionOnePercentage;
            betDetails.optionOneVoters.forEach(voter => {
                if (voter.bet > largestVoterOptionOne.bet) {
                    largestVoterOptionOne.userId = voter.userId;
                    largestVoterOptionOne.bet = voter.bet;
                    largestVoterOptionOne.displayName = voter.userDisplayName;
                }
            })
            const targetUserOne = await interaction.guild.members.fetch(largestVoterOptionOne.userId);
            if (!targetUserOne) {
                await interaction.editReply("That user doesn't exist in this server.");
                return;
            }
            largestVoterOptionOne.displayName = targetUserOne.user.displayName;
            optionOneSplit = largestVoterOptionOne.bet / (betDetails.optionOneTotal - betDetails.baseAmount);
            optionOnePercentage = (optionOneSplit * 100).toFixed(2);
            fields.push({
                name: `${betDetails.optionOne} Largest Bet: ${largestVoterOptionOne.bet}`,
                value: `${largestVoterOptionOne.displayName} wins ${Math.floor(optionOneSplit * betDetails.optionTwoTotal)} potatoes (${optionOnePercentage}%)`,
                inline: false,
            })
        }

        if (betDetails.optionTwoTotal != betDetails.baseAmount) {
            let largestVoterOptionTwo = { userId: "", bet: 0, displayName: "" };
            let optionTwoSplit, optionTwoPercentage;
            betDetails.optionTwoVoters.forEach(voter => {
                if (voter.bet > largestVoterOptionTwo.bet) {
                    largestVoterOptionTwo.userId = voter.userId;
                    largestVoterOptionTwo.bet = voter.bet;
                    largestVoterOptionTwo.displayName = voter.userDisplayName;
                }
            })
            optionTwoSplit = largestVoterOptionTwo.bet / (betDetails.optionTwoTotal - betDetails.baseAmount);
            optionTwoPercentage = (optionTwoSplit * 100).toFixed(2)
            fields.push({
                name: `${betDetails.optionTwo} Largest Bet: ${largestVoterOptionTwo.bet}`,
                value: `${largestVoterOptionTwo.displayName} wins ${Math.floor(optionTwoSplit * betDetails.optionOneTotal)} potatoes (${optionTwoPercentage}%)`,
                inline: false,
            })
        }
        fields.push({
            name: `Base Bet Amount (per side):`,
            value: `${betDetails.baseAmount} potatoes)`,
            inline: false,
        })

        const embed = new EmbedBuilder()
            .setTitle(`(1) ${betDetails.optionOne} vs (2) ${betDetails.optionTwo} (${ratio})`)
            .setDescription(`${betDetails.description}\nBelow are the current bets and their respective totals: `)
            .setColor("Random")
            .setThumbnail(betDetails.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields);
        return embed;
    }

    createBetEndEmbed(betDetails, winningOption) {
        if (!betDetails.thumbnailUrl) {
            betDetails.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        const embed = new EmbedBuilder()
            .setTitle(`${winningOption} has won the bet!`)
            .setDescription(`Potatoes have been distributed!\nBelow are the final bet amounts and their respective totals: `)
            .setColor("Random")
            .setThumbnail(betDetails.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .addFields(
                {
                    name: `1: ${betDetails.optionOne}`,
                    value: `${betDetails.optionOneTotal} potatoes`,
                    inline: true,
                },
                {
                    name: `2: ${betDetails.optionTwo}`,
                    value: `${betDetails.optionTwoTotal} potatoes`,
                    inline: true,
                }
            );
        return embed;
    }

    createGuildEmbed(guild) {
        let fields = [];

        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        fields.push({
            name: `Leader:`,
            value: `${guild.leader.username}`,
            inline: true
        })
        fields.push({
            name: `Members:`,
            value: `${guild.memberList.length}/${guild.memberCap}`,
            inline: true
        })
        fields.push({
            name: `Guild Level:`,
            value: `${guild.level}`,
            inline: true
        })
        fields.push({
            name: `Bank Stored:`,
            value: `${guild.bankStored}`,
            inline: true
        })
        fields.push({
            name: `Bank Capacity:`,
            value: `${guild.bankCapacity}`,
            inline: true
        })
        fields.push({
            name: `Total Earnings:`,
            value: `${guild.totalEarnings}`,
            inline: true
        })
        fields.push({
            name: `Raid Count:`,
            value: `${guild.raidCount}`,
            inline: true
        })
        fields.push({
            name: `Active Raid:`,
            value: `${guild.activeRaid}`,
            inline: true
        })

        const embed = new EmbedBuilder()
            .setTitle(`${guild.guildName}`)
            .setDescription(`Below is guild information for guild '${guild.guildName}'`)
            .setColor("Random")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields);
        return embed;
    }

    createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, mob) {
        let fields = [];

        fields.push({
            name: `Work Count:`,
            value: `${newWorkCount}`,
            inline: true,
        })
        const gainOrLoss = potatoesGained >= 0 ? 'Gained' : 'Lost'
        fields.push({
            name: `Potatoes ${gainOrLoss}:`,
            value: `${potatoesGained} potatoes`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} encountered a ${mob.name}!`)
            .setDescription(`${mob.description}`)
            .setColor("Random")
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }
}

function getUserAvatar(userId, avatarHash) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`;
}

module.exports = {
    EmbedFactory
}