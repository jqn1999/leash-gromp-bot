const { EmbedBuilder } = require("discord.js");
const { GuildRoles, sweetPotato, Raid } = require("../utils/constants")
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
            name: "Current Work Multiplier:",
            value: `${(userDetails.workMultiplierAmount).toFixed(2)}`,
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
            .setColor("Random")
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
                name: `${element.id}) ${element.name} (${element.amount.toLocaleString()})`,
                value: `${element.description}\nId: ${element.id} | Cost: ${element.cost.toLocaleString()}`,
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
        const newMemberList = memberList.filter((currentMember) => currentMember.role != GuildRoles.LEADER)
        if (newMemberList.length > 0) {
            let stringListOfMembers = ``;
            for (const [index, element] of newMemberList.entries()) {
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
            .setColor("Random")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList);
        return embed;
    }

    async createRaidMemberListEmbed(guild, raidList, totalMultiplier, timeSinceLastRaidInSeconds, timeUntilRaidAvailableInSeconds) {
        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        let raidTime = '';
        if (timeSinceLastRaidInSeconds < Raid.RAID_TIMER_SECONDS) {
            raidTime = convertSecondstoMinutes(timeUntilRaidAvailableInSeconds);
        } else {
            raidTime = 'Ready'
        }

        const embed = new EmbedBuilder()
            .setTitle(`${guild.guildName} (Total Multiplier: ${totalMultiplier.toFixed(2)}x)\nRaid Timer: ${raidTime}`)
            .setDescription(`Below is the list of the current raid members for '${guild.guildName}'`)
            .setColor("Random")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(raidList);
        return embed;
    }

    createRaidEmbed(guildName, raidList, raidCount, totalRaidReward, splitRaidReward, mob, successChance, raidResultDescription) {
        let fields = [], footerText = "Made by Beggar";

        fields.push({
            name: `Result:`,
            value: `${raidResultDescription}`,
            inline: true,
        })

        fields.push({
            name: `Success Chance:`,
            value: `${(successChance * 100).toFixed(2)}% chance`,
            inline: true,
        })

        const gainOrLoss = totalRaidReward >= 0 ? 'Gained' : 'Lost'
        raidCount = totalRaidReward >= 0 ? raidCount+1 : raidCount
        fields.push({
            name: `Total Potatoes ${gainOrLoss}:`,
            value: `${totalRaidReward.toLocaleString()} potatoes`,
            inline: false,
        })
        fields.push({
            name: `Split Potatoes ${gainOrLoss}:`,
            value: `${splitRaidReward.toLocaleString()} potatoes`,
            inline: true,
        })

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
            .setColor("Random")
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
        fields.push({
            name: `Potatoes ${gainOrLoss}:`,
            value: `${potatoesGained.toLocaleString()} potatoes`,
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
            .setColor("Random")
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
            .setColor("Random")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createCoinflipEmbed(result, headsCount, tailsCount, userPotatoes, bet) {
        let fields = [];
        const potatoResultLabel = bet >= 0 ? 'Gained' : 'Lost';
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
            value: `${bet.toLocaleString()} potatoes`,
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
            .setColor("Random")
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
            .setColor("Random")
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
            .setColor("Random")
            .setThumbnail(avatarUrl)
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