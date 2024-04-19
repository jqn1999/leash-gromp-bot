const { EmbedBuilder } = require("discord.js");
const { GuildRoles, sweetPotato, taroTrader, Raid, shops } = require("../utils/constants")
const { convertSecondstoMinutes } = require("../utils/helperCommands")
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
            value: `${potatoes.toLocaleString()} potatoes`,
            inline: false,
        });
        fields.push({
            name: "Banked Potatoes:",
            value: `${userDetails.bankStored.toLocaleString()} potatoes`,
            inline: false,
        });
        fields.push({
            name: "Starches:",
            value: `${userDetails.starches.toLocaleString()} starches`,
            inline: false,
        });
        let workMultiLabel = ``;
        const additionalWorkMulti = await getGuildWorkMulti(userDetails, userDetails.workMultiplierAmount);
        if (additionalWorkMulti) {
            workMultiLabel += `${(userDetails.workMultiplierAmount + additionalWorkMulti).toFixed(2)}x (+${(additionalWorkMulti).toFixed(2)}x)`
        } else {
            workMultiLabel += `${(userDetails.workMultiplierAmount).toFixed(2)}x`
        }
        fields.push({
            name: "Current Work Multiplier:",
            value: workMultiLabel,
            inline: false,
        });
        fields.push({
            name: "Current Passive Income:",
            value: `${userDetails.passiveAmount.toLocaleString()} potatoes per day`,
            inline: false,
        });
        fields.push({
            name: "Current Bank Capacity:",
            value: `${userDetails.bankCapacity.toLocaleString()} potatoes`,
            inline: false,
        });
        fields.push({
            name: "Current Starch Capacity:",
            value: `${userDetails.maxStarches.toLocaleString()} starches`,
            inline: false,
        });
        fields.push({
            name: "Work Count:",
            value: `${userDetails.workCount.toLocaleString()} works`,
            inline: false,
        });

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription("This is your profile where\nyou can view your potatoes")
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields);
        return embed;
    }

    createUserStatsEmbed(userId, currentName, userAvatarHash, userDetails) {
        const avatarUrl = getUserAvatar(userId, userAvatarHash);

        const userBaseWorkMultiplier = userDetails.workMultiplierAmount - userDetails.sweetPotatoBuffs.workMultiplierAmount - userDetails.regrades.workMulti.regradeAmount;
        const userBasePassiveIncome = userDetails.passiveAmount - userDetails.sweetPotatoBuffs.passiveAmount - userDetails.regrades.passiveAmount.regradeAmount;
        const userBaseBankCapacity = userDetails.bankCapacity - userDetails.sweetPotatoBuffs.bankCapacity - userDetails.regrades.bankCapacity.regradeAmount;
        const userBaseMaxStarches = userDetails.maxStarches;
        let multiplierName = findShopItemName(userBaseWorkMultiplier, shops[0].items);
        let passiveName = findShopItemName(userBasePassiveIncome, shops[1].items);
        let bankName = findShopItemName(userBaseBankCapacity, shops[2].items);
        let starchName = findShopItemName(userBaseMaxStarches, shops[3].items);

        const embed = new EmbedBuilder()
            .setTitle(`${currentName}`)
            .setDescription("This is your stats profile where\nyou can view your total gains and losses")
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .addFields(
                {
                    name: "Current Work Multiplier Upgrade:\n(Base + Bonus + Regrade)",
                    value: `${multiplierName}\n(${userBaseWorkMultiplier.toFixed(2)} + ${userDetails.sweetPotatoBuffs.workMultiplierAmount.toFixed(2)} + ${userDetails.regrades.workMulti.regradeAmount.toFixed(2)})x`,
                    inline: false,
                },
                {
                    name: "Current Passive Income Upgrade:",
                    value: `${passiveName}\n(${userBasePassiveIncome.toLocaleString()} + ${userDetails.sweetPotatoBuffs.passiveAmount.toLocaleString()} + ${userDetails.regrades.passiveAmount.regradeAmount.toLocaleString()}) potatoes`,
                    inline: false,
                },
                {
                    name: "Current Bank Capacity Upgrade:",
                    value: `${bankName}\n(${userBaseBankCapacity.toLocaleString()} + ${userDetails.sweetPotatoBuffs.bankCapacity.toLocaleString()} + ${userDetails.regrades.bankCapacity.regradeAmount.toLocaleString()}) potatoes`,
                    inline: false,
                },
                {
                    name: "Current Starch Capacity Upgrade:",
                    value: `${starchName}\n(${userBaseMaxStarches.toLocaleString()} + 0 + 0) starches`,
                    inline: false,
                },
                {
                    name: "Total Earnings:",
                    value: `${userDetails.totalEarnings.toLocaleString()} potatoes`,
                    inline: false,
                },
                {
                    name: "Total Losses:",
                    value: `${userDetails.totalLosses.toLocaleString()} potatoes`,
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
                    value: `${element.potatoes.toLocaleString()} potatoes (${currentUserTotalPotatoes.toLocaleString()} potatoes total) (${(currentUserTotalPotatoes / total * 100).toFixed(2)}%)`,
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
            value: `${sortedUsers[userIndex].potatoes.toLocaleString()} potatoes (${userTotalPotatoes.toLocaleString()} potatoes total) (${(userTotalPotatoes / total * 100).toFixed(2)}%)`,
            inline: false,
        });

        const embed = new EmbedBuilder()
            .setTitle(`Server Leaderboard (${total.toLocaleString()} potatoes)`)
            .setDescription(`This is where the top 5 members' wealth are displayed... your rank is at the bottom.`)
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createUserStarchLeaderboardEmbed(sortedUsers, total, userIndex) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        let userList = []
        for (const [index, element] of sortedUsers.entries()) {
            let currentUserTotalStarches = element.starches;
            if (index < 5) {
                const user = {
                    name: `${index + 1}) ${element.username}`,
                    value: `${element.starches.toLocaleString()} starches (${(currentUserTotalStarches / total * 100).toFixed(2)}%)`,
                    inline: false,
                };
                userList.push(user);
            } else {
                break;
            }
        }
        let userTotalStarches = sortedUsers[userIndex].starches;
        userList.push({
            name: `${userIndex + 1}) ${sortedUsers[userIndex].username}`,
            value: `${sortedUsers[userIndex].starches.toLocaleString()} starches (${(userTotalStarches / total * 100).toFixed(2)}%)`,
            inline: false,
        });

        const embed = new EmbedBuilder()
            .setTitle(`Server Leaderboard (${total.toLocaleString()} starches)`)
            .setDescription(`This is where the top 5 members' starches are displayed... your rank is at the bottom.`)
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createGuildLeaderboardEmbed(sortedGuilds, interaction) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        let guildList = []

        for (const [index, element] of sortedGuilds.entries()) {
            const leader = element.memberList.find((currentMember) => currentMember.role == GuildRoles.LEADER)
            if (!leader) {
                interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
                return;
            }

            if (index < 5) {
                const guild = {
                    name: `${index + 1}) ${element.guildName} (Level: ${element.level}, Members: ${element.memberList.length})`,
                    value: `Leader: ${leader.username}, Raid Count: ${element.raidCount.toLocaleString()}`,
                    inline: false,
                };
                guildList.push(guild);
            } else {
                break;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`Guild Leaderboard (${sortedGuilds.length} Guilds)`)
            .setDescription(`This is where all guilds are displayed, ordered by level and then by members.`)
            .setColor("Orange")
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
                name: `${element.id}) ${element.name} (${element.amount.toLocaleString()})`,
                value: `${element.description}\nId: ${element.id} | Cost: ${element.cost.toLocaleString()}`,
                inline: false,
            };
            shopList.push(item);
        }

        const embed = new EmbedBuilder()
            .setTitle(`${shopDetails.title}`)
            .setDescription(`${shopDetails.description}`)
            .setColor("Orange")
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
            value: `${betDetails.optionOneTotal.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `2) ${betDetails.optionTwo}`,
            value: `${betDetails.optionTwoTotal.toLocaleString()} potatoes`,
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
                name: `${betDetails.optionOne} Largest Bet: ${largestVoterOptionOne.bet.toLocaleString()}`,
                value: `${largestVoterOptionOne.displayName} wins ${(Math.floor(optionOneSplit * betDetails.optionTwoTotal)).toLocaleString()} potatoes (${optionOnePercentage}%)`,
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
                name: `${betDetails.optionTwo} Largest Bet: ${largestVoterOptionTwo.bet.toLocaleString()}`,
                value: `${largestVoterOptionTwo.displayName} wins ${(Math.floor(optionTwoSplit * betDetails.optionOneTotal)).toLocaleString()} potatoes (${optionTwoPercentage}%)`,
                inline: false,
            })
        }
        fields.push({
            name: `Base Bet Amount (per side):`,
            value: `${betDetails.baseAmount.toLocaleString()} potatoes)`,
            inline: false,
        })

        const embed = new EmbedBuilder()
            .setTitle(`(1) ${betDetails.optionOne} vs (2) ${betDetails.optionTwo} (${ratio})`)
            .setDescription(`${betDetails.description}\nBelow are the current bets and their respective totals: `)
            .setColor("Orange")
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
            .setColor("Orange")
            .setThumbnail(betDetails.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .addFields(
                {
                    name: `1: ${betDetails.optionOne}`,
                    value: `${betDetails.optionOneTotal.toLocaleString()} potatoes`,
                    inline: true,
                },
                {
                    name: `2: ${betDetails.optionTwo}`,
                    value: `${betDetails.optionTwoTotal.toLocaleString()} potatoes`,
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

        const leader = guild.memberList.find((currentMember) => currentMember.role == GuildRoles.LEADER)
        if (!leader) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        fields.push({
            name: `Leader:`,
            value: `${leader.username}`,
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
            value: `${guild.bankStored.toLocaleString()}`,
            inline: true
        })
        fields.push({
            name: `Bank Capacity:`,
            value: `${guild.bankCapacity.toLocaleString()}`,
            inline: true
        })
        fields.push({
            name: `Total Earnings:`,
            value: `${guild.totalEarnings.toLocaleString()}`,
            inline: true
        })
        fields.push({
            name: `Raid Count:`,
            value: `${guild.raidCount.toLocaleString()}`,
            inline: true
        })
        fields.push({
            name: `Reward Multiplier:`,
            value: `${guild.raidRewardMultiplier}`,
            inline: true
        })
        fields.push({
            name: `Guild Buff:`,
            value: `${guild.guildBuff}`,
            inline: true
        })

        const embed = new EmbedBuilder()
            .setTitle(`${guild.guildName}`)
            .setDescription(`Below is guild information for guild '${guild.guildName}'`)
            .setColor("Orange")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields);
        return embed;
    }

    createGuildMemberListEmbed(guild, interaction) {
        let userList = [];
        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        let memberList = guild.memberList;
        const leader = memberList.find((currentMember) => currentMember.role == GuildRoles.LEADER);
        if (!leader) {
            interaction.editReply(`${userDisplayName} there was an error retrieving the guild leader of your guild. Let an admin know!`);
            return;
        }
        userList.push({
            name: `${leader.role}`,
            value: `${leader.username}`,
            inline: false,
        })
        const coleaderList = memberList.filter((currentMember) => currentMember.role == GuildRoles.COLEADER)
        if (coleaderList.length > 0) {
            let stringListOfMembers = ``;
            for (const [index, element] of coleaderList.entries()) {
                stringListOfMembers += `${element.username}\n`
            }
            const listOfMembers = {
                name: `${GuildRoles.COLEADER}`,
                value: `${stringListOfMembers}`,
                inline: false,
            };
            userList.push(listOfMembers);
        }
        
        const elderList = memberList.filter((currentMember) => currentMember.role == GuildRoles.ELDER)
        if (elderList.length > 0) {
            let stringListOfMembers = ``;
            for (const [index, element] of elderList.entries()) {
                stringListOfMembers += `${element.username}\n`
            }
            const listOfMembers = {
                name: `${GuildRoles.ELDER}`,
                value: `${stringListOfMembers}`,
                inline: false,
            };
            userList.push(listOfMembers);
        }

        const regularMemberList = memberList.filter((currentMember) => currentMember.role == GuildRoles.MEMBER)
        if (regularMemberList.length > 0) {
            let stringListOfMembers = ``;
            for (const [index, element] of regularMemberList.entries()) {
                stringListOfMembers += `${element.username}\n`
            }
            const listOfMembers = {
                name: `${GuildRoles.MEMBER}`,
                value: `${stringListOfMembers}`,
                inline: false,
            };
            userList.push(listOfMembers);
        }

        const embed = new EmbedBuilder()
            .setTitle(`${guild.guildName}`)
            .setDescription(`Below is the list of members for guild '${guild.guildName}'`)
            .setColor("Orange")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList);
        return embed;
    }

    async createRaidMemberListEmbed(guild, raidList, totalMultiplier, timeUntilRaidAvailableInSeconds) {
        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        let raidTime = '';
        if (timeUntilRaidAvailableInSeconds > 0) {
            raidTime = convertSecondstoMinutes(timeUntilRaidAvailableInSeconds);
        } else {
            raidTime = 'Ready'
        }

        const embed = new EmbedBuilder()
            .setTitle(`${guild.guildName} (Total Multiplier: ${totalMultiplier.toFixed(2)}x)\nRaid Timer: ${raidTime}`)
            .setDescription(`Below is the list of the current raid members for '${guild.guildName}'`)
            .setColor("Orange")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(raidList);
        return embed;
    }

    async createWorldRaidMemberListEmbed(raidList, totalMultiplier, name, thumbnail) {
        const embed = new EmbedBuilder()
            .setTitle(`${name}: (Total Multiplier: ${totalMultiplier.toFixed(2)}x)`)
            .setDescription(`Below is the list of the current raid members`)
            .setColor("Orange")
            .setThumbnail(thumbnail)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(raidList);
        return embed;

    }

    createRaidEmbed(guildName, raidList, raidCount, totalRaidReward, splitRaidReward, mob, successChance,
        raidResultDescription, multiplierReward = null, passiveReward = null, capacityReward = null) {
        let fields = [], footerText = "Made by Beggar", statRewardMessage = '';
        const hasStatReward = multiplierReward || passiveReward || capacityReward;
        const color = totalRaidReward > 0 || hasStatReward ? 'Green' : 'Red';

        fields.push({
            name: `Result:`,
            value: `${raidResultDescription}`,
            inline: true,
        })
        if (multiplierReward) {
            statRewardMessage += `${multiplierReward.toFixed(2).toLocaleString()} work multiplier to all members!\n`
        }
        if (passiveReward) {
            statRewardMessage += `${passiveReward.toLocaleString()} passive amount to all members!\n`
        }
        if (capacityReward) {
            statRewardMessage += `${capacityReward.toLocaleString()} bank capacity to all members!\n`
        }
        if (hasStatReward) {
            fields.push({
                name: `Stats Granted:`,
                value: `${statRewardMessage}`,
                inline: false,
            })
        }

        fields.push({
            name: `Success Chance:`,
            value: `${(successChance * 100).toFixed(2)}% chance`,
            inline: true,
        })

        const gainOrLoss = totalRaidReward >= 0 ? 'Gained' : 'Lost'
        let usedBankText = ''
        if (!splitRaidReward) {
            usedBankText = totalRaidReward >= 0 ? ' In Guild Bank' : ' From Guild Bank'
        }
        fields.push({
            name: `Total Potatoes ${gainOrLoss}${usedBankText}:`,
            value: `${totalRaidReward.toLocaleString()} potatoes`,
            inline: false,
        })
        if (splitRaidReward) {
            fields.push({
                name: `Split Potatoes ${gainOrLoss}:`,
                value: `${splitRaidReward.toLocaleString()} potatoes`,
                inline: true,
            })
        }

        let stringListOfMembers = ``;
        for (const [index, element] of raidList.entries()) {
            stringListOfMembers += `${element.username}\n`
        }
        const listOfMembers = {
            name: `Members In Raid:`,
            value: `${stringListOfMembers}`,
            inline: false,
        };
        fields.push(listOfMembers);

        fields.push({
            name: `Raid Count:`,
            value: `${(raidCount).toLocaleString()}`,
            inline: true,
        })

        if (mob.credit) {
            footerText = mob.credit;
        }

        const embed = new EmbedBuilder()
            .setTitle(`'${guildName}' encountered ${mob.name}!`)
            .setDescription(`${mob.description}`)
            .setColor(color)
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createWorldEmbed(mob){
        //let fields = [], footerText = "Made by Beggar";
        let footerText = "Made by Beggar"

        const embed = new EmbedBuilder()
            .setTitle(`'${mob.name}`)
            .setDescription(`${mob.description}`)
            .setColor("Orange")
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
           // .setFields(fields)
        return embed;
    }


    createWorldResultEmbed(raidList, totalRaidReward, mob, successChance,
        raidResultDescription, multiplierReward = null, passiveReward = null, capacityReward = null) {
        let fields = [], footerText = "Made by Beggar", statRewardMessage = '';
        const hasStatReward = multiplierReward || passiveReward || capacityReward;
        const color = totalRaidReward > 0 || hasStatReward ? 'Green' : 'Red';
        fields.push({
            name: `Result:`,
            value: `${raidResultDescription}`,
            inline: true,
        })
        if (multiplierReward) {
            statRewardMessage += `${multiplierReward.toFixed(2).toLocaleString()} work multiplier to all members!\n`
        }
        if (passiveReward) {
            statRewardMessage += `${passiveReward.toLocaleString()} passive amount to all members!\n`
        }
        if (capacityReward) {
            statRewardMessage += `${capacityReward.toLocaleString()} bank capacity to all members!\n`
        }
        if (hasStatReward) {
            fields.push({
                name: `Stats Granted:`,
                value: `${statRewardMessage}`,
                inline: false,
            })
        }

        fields.push({
            name: `Success Chance:`,
            value: `${(successChance * 100).toFixed(2)}% chance`,
            inline: true,
        })

        let stringListOfMembers = ``;
        if (raidList.length == 0) {
            fields.push({
                name: 'Members In Raid:',
                value: 'None',
                inline: false,
            })
        } else {
            for (const [index, element] of raidList.entries()) {
                stringListOfMembers += `${element.username} - ${Math.round(element.raidShare * totalRaidReward).toLocaleString()} potatoes gained\n`
            }
            const listOfMembers = {
                name: `Members In Raid:`,
                value: `${stringListOfMembers}`,
                inline: false,
            };
            fields.push(listOfMembers);

            const gainOrLoss = totalRaidReward >= 0 ? 'Gained' : 'Lost'
            fields.push({
                name: `Total Potatoes ${gainOrLoss}:`,
                value: `${totalRaidReward.toLocaleString()} potatoes`,
                inline: false,
            })
        }

        if (mob.credit) {
            footerText = mob.credit;
        }
        const embed = new EmbedBuilder()
            .setTitle(`The Potato Kingdom encountered ${mob.name}!`)
            .setDescription(`${mob.description}`)
            .setColor(color)
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createWorkEmbed(userDisplayName, newWorkCount, potatoesGained, mob) {
        let fields = [], footerText = "Made by Beggar";

        fields.push({
            name: `Work Count:`,
            value: `${newWorkCount.toLocaleString()}`,
            inline: true,
        })
        const gainOrLoss = potatoesGained >= 0 ? 'Gained' : 'Lost'
        const gainPotatoesOrStarches = mob.name == taroTrader.name ? 'Starches' : 'Potatoes';
        const isFailedMetal = potatoesGained == 0 && mob.name != sweetPotato.name;
        let color = potatoesGained >= 0 && !isFailedMetal  ? 'Green' : 'Red';
        fields.push({
            name: `${gainPotatoesOrStarches} ${gainOrLoss}:`,
            value: `${potatoesGained.toLocaleString()} ${gainPotatoesOrStarches.toLowerCase()}`,
            inline: true,
        })

        if (mob.credit) {
            footerText = mob.credit;
        }

        let sweetPotatoReward = '';
        if (mob.name == sweetPotato.name) {
            switch (potatoesGained) {
                case 0:
                    sweetPotatoReward = ' (Work Multiplier)';
                    break;
                case 1:
                    sweetPotatoReward = ' (Passive Amount)';
                    break;
                case 2:
                    sweetPotatoReward = ' (Bank Capacity)';
                    break;
            }
        }

        // TODO: Remove in future this is mostly for memes
        let mobDescription = '';
        if (userDisplayName.includes('Charizard') && mob.name == sweetPotato.name) {
            mobDescription = 'Your lips curl up in disgust as you see a sweet potato appear in front of you. It begs and pleads, but it fails to convince you to spare its life in exchange for buffing one of your stats. You decide to brutally murder the sweet potato and forcefully take the stats for yourself anyway. Check your profile!';
        } else {
            mobDescription = mob.description;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} encountered a(n) ${mob.name}!`)
            .setDescription(`${mobDescription}${sweetPotatoReward}`)
            .setColor(color)
            .setThumbnail(mob.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createBirthdayEmbed(sortedBirthdays) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        let userList = []
        for (const [index, element] of sortedBirthdays.entries()) {
            if (index < 5) {
                const user = {
                    name: `${index + 1}) ${element.birthday}`,
                    value: `${element.username}`,
                    inline: false,
                };
                userList.push(user);
            } else {
                break;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`Birthday List`)
            .setDescription(`This is the next 5 birthdays for the server`)
            .setColor("Orange")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createCoinflipEmbed(result, headsCount, tailsCount, userPotatoes, amount) {
        let fields = [];
        const potatoResultLabel = amount >= 0 ? 'Gained' : 'Lost';
        const color = amount >= 0 ? 'Green' : 'Red';
        const avatarUrl = result == 'heads'
            ? "https://cdn.discordapp.com/emojis/656933460484685873.webp?size=96&quality=lossless"
            : "https://cdn.discordapp.com/attachments/533073599435636739/1199161990787104878/Miles_22Tails22_Prower_Sonic_and_All-Stars_Racing_Transformed.png?ex=65c189a1&is=65af14a1&hm=f7d3ad2b55689f5fe5a833322af1e37239039d0eeec3ea55aa45219ff6a30d5d&"

        fields.push({
            name: `Heads Count:`,
            value: `${headsCount.toLocaleString()} heads`,
            inline: true,
        })
        fields.push({
            name: `Tails Count:`,
            value: `${tailsCount.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        fields.push({
            name: `Potatoes ${potatoResultLabel}:`,
            value: `${amount.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`Coinflip result was... ${result}!`)
            .setDescription(`Displayed below are your current potatoes, potatoes gained or lost, and coinflip stats.`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRobEmbed(userDisplayName, userId, userAvatar, robOrFineAmount, targetUserDisplayName, userPotatoes, targetUserPotatoes, chanceToRob) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        let fields = [];
        const robResultLabel = robOrFineAmount > 0 ? 'successfully robbed' : 'failed to rob';
        const potatoResultLabel = robOrFineAmount > 0 ? 'Gained' : 'Lost';
        const color = robOrFineAmount > 0 ? 'Green' : 'Red';

        fields.push({
            name: `Chance to Rob:`,
            value: `${chanceToRob}%`,
            inline: true,
        })
        fields.push({
            name: `Target's Potatoes:`,
            value: `${targetUserPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        fields.push({
            name: `Potatoes ${potatoResultLabel}:`,
            value: `${robOrFineAmount.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} ${robResultLabel} ${targetUserDisplayName}!`)
            .setDescription(`Displayed below are your chances to rob, current potatoes, target's potatoes, and how many potatoes were gained or lost.`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createGiveEmbed(userDisplayName, userId, userAvatar, amount, userPotatoes, targetUserDisplayName, targetUserPotatoes) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        let fields = [];

        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Target's Potatoes:`,
            value: `${targetUserPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        fields.push({
            name: `Potatoes Given:`,
            value: `${amount.toLocaleString()} potatoes`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} gives potatoes to ${targetUserDisplayName}!`)
            .setDescription(`Displayed below are your current potatoes, your target's potatoes, and how many potatoes you gave.`)
            .setColor("Green")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes, userStarches, maxBuyAmount, currentType, starchPrice) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const color = currentType == 'buy' ? 'Green' : 'Orange';
        let fields = [];

        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Current Starches:`,
            value: `${userStarches.toLocaleString()} starches`,
            inline: true,
        })
        if (currentType == 'buy') {
            fields.push({
                name: `Max starches you can ${currentType}:`,
                value: `${maxBuyAmount.toLocaleString()} starches`,
                inline: false,
            })
        }

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} you can currently ${currentType} starches for ${starchPrice.toLocaleString()} potatoes!`)
            .setDescription(`Displayed below are your current potatoes, starches, and how many you can ${currentType}.`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by izmattk" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRegradeEmbed(userDisplayName, userId, userAvatar, userPotatoes, regradeType, newBaseAmount, increaseAmount, successChance, failStack, cost) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const color = increaseAmount > 0 ? 'Green' : 'Red';
        const succeededOrFailed = increaseAmount > 0 ? 'Succeeded' : 'Failed';
        let typeText;
        if (regradeType == 'Work Multiplier') {
            typeText = 'work multi';
        } else if (regradeType == 'Passive Amount') {
            typeText = 'potatoes';
        } else if (regradeType == 'Bank Capacity') {
            typeText = 'potatoes';
        }
        let fields = [];
        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Cost:`,
            value: `${cost.toLocaleString()} potatoes\n\n`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        if (increaseAmount > 0) {
            fields.push({
                name: `New ${regradeType}:`,
                value: `${newBaseAmount.toLocaleString()} ${typeText}`,
                inline: true,
            })
            fields.push({
                name: `Increase Amount:`,
                value: `${increaseAmount.toLocaleString()}`,
                inline: true,
            })
        }
        fields.push({
            name: `Success Chance:`,
            value: `${(successChance*100).toFixed(2)}% (+${(failStack*100).toFixed(2)}%)`,
            inline: false,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} ${succeededOrFailed} a ${regradeType} regrade!`)
            .setDescription(`Displayed below are your current potatoes and current base amount`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createBuyOrSellStarchEmbed(userDisplayName, userId, userAvatar, userPotatoes, userStarches, currentType, starchAmount, starchPrice, totalPrice) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const color = currentType == 'buy' ? 'Green' : 'Orange';
        const starchesText = starchAmount > 1 ? 'starches' : 'starch';
        let fields = [];

        fields.push({
            name: `Current Potatoes:`,
            value: `${userPotatoes.toLocaleString()} potatoes`,
            inline: true,
        })
        fields.push({
            name: `Current Starches:`,
            value: `${userStarches.toLocaleString()} ${starchesText}`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} ${currentType}s ${starchAmount.toLocaleString()} ${starchesText} for ${totalPrice.toLocaleString()} potatoes!`)
            .setDescription(`Displayed below are your current potatoes and starches.\nCurrent Price: ${starchPrice.toLocaleString()} potatoes`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by izmattk" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }
}

function findShopItemName(amount, shopItems) {
    for (const [index, element] of shopItems.entries()) {
        if (element.amount == amount.toFixed(1)) {
            return element.name
        }
    }
    return "N/A";
}

function getUserAvatar(userId, avatarHash) {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`;
}

async function getGuildWorkMulti(userDetails, userMultiplier){
    const userGuildId = userDetails.guildId;
    if (userGuildId){
        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if(guild){
            if(guild.guildBuff == "workMulti"){
                return userMultiplier * .10
            }
        }
    }
    return 0
}

module.exports = {
    EmbedFactory
}