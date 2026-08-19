const { EmbedBuilder } = require("discord.js");
const { GuildRoles, sweetPotato, taroTrader, Raid, shops, DailyQuest, Quests, GuildContract, GuildBuffLabels, Rebirth, CompanionRarity, Companions } = require("../utils/constants")
const { convertSecondstoMinutes } = require("../utils/helperCommands")
const dynamoHandler = require("../utils/dynamoHandler");
const { EventFactory } = require("../utils/eventFactory");
const { getRaidLevelInfo } = require("../utils/raidFactory");
const eventFactory = new EventFactory();

// Shared across every leaderboard embed so 1st/2nd/3rd read the same way everywhere —
// matches the medal convention createTowerLeaderboardResultsEmbed already established.
const LEADERBOARD_MEDALS = ['🥇', '🥈', '🥉'];
function rankLabel(index) {
    return LEADERBOARD_MEDALS[index] || `${index + 1}.`;
}

// Used by the bank embeds to show capacity fill at a glance instead of just raw numbers.
function buildProgressBar(current, max, length = 10) {
    const ratio = max > 0 ? Math.min(Math.max(current / max, 0), 1) : 0;
    const filled = Math.round(ratio * length);
    return '█'.repeat(filled) + '░'.repeat(length - filled);
}

// Shared across every companion embed so rarity reads the same way everywhere.
const COMPANION_RARITY_COLOR = {
    [CompanionRarity.COMMON]: 'Grey',
    [CompanionRarity.RARE]: 'Blue',
    [CompanionRarity.LEGENDARY]: 'Orange',
    [CompanionRarity.MYTHIC]: 'Gold'
};
const COMPANION_RARITY_LABEL = {
    [CompanionRarity.COMMON]: 'Common',
    [CompanionRarity.RARE]: 'Rare',
    [CompanionRarity.LEGENDARY]: 'Legendary',
    [CompanionRarity.MYTHIC]: 'Mythic'
};

const PERK_LABELS = {
    workMultiplierPercent: value => `+${(value * 100).toFixed(0)}% Work Multiplier`,
    workCooldownPercent: value => `-${(value * 100).toFixed(0)}% Work Cooldown`,
    passiveIncomePercent: value => `+${(value * 100).toFixed(0)}% Passive Income`,
    robChanceFlat: value => `+${(value * 100).toFixed(0)}% Rob Success Chance`,
    starchCapacityPercent: value => `+${(value * 100).toFixed(0)}% Starch Capacity`,
    guildRaidMultiplierPercent: value => `+${(value * 100).toFixed(0)}% Guild Raid Success Chance`,
    bankCapacityPercent: value => `+${(value * 100).toFixed(0)}% Bank Capacity`,
    regradeChanceFlat: value => `+${(value * 100).toFixed(0)}% Regrade Success Chance`,
    rebirthBonusPercent: value => `+${(value * 100).toFixed(0)}% Rebirth Bonus`
};

function formatCompanionPerks(companion) {
    return companion.perks.map(perk => PERK_LABELS[perk.type](perk.value)).join(', ');
}

class EmbedFactory {
    // Paginated 2 pages — Overview (economy stats) and Activity & Records — same
    // Previous/Next button mechanics as /quests, just over a fixed field set instead of
    // a variable-length list, since streaks + personal records made the single-embed
    // version too tall to read comfortably. pageIndex defaults to 0 so every existing
    // non-paginating caller (if any) still gets the overview page unchanged.
    async createUserEmbed(userId, currentName, userAvatarHash, userDetails, pageIndex = 0) {
        const avatarUrl = getUserAvatar(userId, userAvatarHash);
        let title = `${currentName}`;
        // Loose `!= 0` treats a genuinely unset guildId (undefined) as "has a guild" —
        // undefined != 0 is true — calling findGuildById(undefined) and crashing on
        // guild.guildName once findGuildById's own error handling returns nothing.
        // Truthy check treats 0 and undefined/null the same, both correctly "no guild".
        if (userDetails.guildId) {
            const guild = await dynamoHandler.findGuildById(userDetails.guildId);
            if (guild) title += ` (${guild.guildName})`
        }

        const totalPages = 2;
        let fields = [];
        let description;

        if (pageIndex === 0) {
            description = `This is your profile where\nyou can view your potatoes\nPage 1 / ${totalPages}`;
            const potatoes = userDetails.potatoes;
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
        } else {
            description = `Activity & Records\nPage 2 / ${totalPages}`;
            fields.push({
                name: "Work Count:",
                value: `${userDetails.workCount.toLocaleString()} works`,
                inline: false,
            });
            fields.push({
                name: "Daily Login Streak:",
                value: `${(userDetails.loginStreak || 0).toLocaleString()} days`,
                inline: false,
            });
            // records is backfilled by findUser's self-healing for any account that
            // existed before this field was added, but guard with `|| {}`/`|| 0` anyway
            // rather than assume every caller of createUserEmbed went through findUser.
            const records = userDetails.records || {};
            fields.push({
                name: "Personal Records:",
                value: `Highest Tower floor: ${(records.highestTowerFloor || 0).toLocaleString()}\n`
                    + `Biggest /work payout: ${(records.biggestWorkPayout || 0).toLocaleString()} potatoes\n`
                    + `Largest raid contribution: ${(records.largestRaidContribution || 0).toLocaleString()} potatoes`,
                inline: false,
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
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
        const topCount = Math.min(5, sortedUsers.length);
        const formatEntry = (element, index) => {
            const totalWealth = element.potatoes + element.bankStored;
            const isYou = index === userIndex;
            return {
                name: `${rankLabel(index)} ${element.username}${isYou ? ' (You)' : ''}`,
                value: `${totalWealth.toLocaleString()} potatoes total (${(totalWealth / total * 100).toFixed(2)}% of server)\n${element.potatoes.toLocaleString()} liquid • ${element.bankStored.toLocaleString()} banked`,
                inline: false,
            };
        };

        let userList = [];
        for (let index = 0; index < topCount; index++) {
            userList.push(formatEntry(sortedUsers[index], index));
        }

        // Only break out a separate "Your Rank" entry if you're not already visible in
        // the top 5 — otherwise this used to duplicate you at the bottom of your own list.
        if (userIndex >= topCount) {
            userList.push({ name: '​', value: '​', inline: false });
            const youEntry = formatEntry(sortedUsers[userIndex], userIndex);
            userList.push({ name: `Your Rank — ${youEntry.name}`, value: youEntry.value, inline: false });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏆 Server Leaderboard`)
            .setDescription(`${total.toLocaleString()} potatoes across ${sortedUsers.length.toLocaleString()} players`)
            .setColor("Gold")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createUserStarchLeaderboardEmbed(sortedUsers, total, userIndex) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        const topCount = Math.min(5, sortedUsers.length);
        const formatEntry = (element, index) => {
            const isYou = index === userIndex;
            return {
                name: `${rankLabel(index)} ${element.username}${isYou ? ' (You)' : ''}`,
                value: `${element.starches.toLocaleString()} starches (${(element.starches / total * 100).toFixed(2)}% of server)`,
                inline: false,
            };
        };

        let userList = [];
        for (let index = 0; index < topCount; index++) {
            userList.push(formatEntry(sortedUsers[index], index));
        }

        if (userIndex >= topCount) {
            userList.push({ name: '​', value: '​', inline: false });
            const youEntry = formatEntry(sortedUsers[userIndex], userIndex);
            userList.push({ name: `Your Rank — ${youEntry.name}`, value: youEntry.value, inline: false });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🥔 Starch Leaderboard`)
            .setDescription(`${total.toLocaleString()} starches across ${sortedUsers.length.toLocaleString()} players`)
            .setColor("Gold")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(userList)
        return embed;
    }

    createGuildLeaderboardEmbed(sortedGuilds) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        const topCount = Math.min(5, sortedGuilds.length);
        let guildList = []

        for (let index = 0; index < topCount; index++) {
            const element = sortedGuilds[index];
            // A guild with a data anomaly (no member holding LEADER) shouldn't take the
            // whole leaderboard down with it — show it as "Unknown" instead of crashing.
            const leader = element.memberList.find((currentMember) => currentMember.role == GuildRoles.LEADER)
            const leaderName = leader ? leader.username : 'Unknown';
            const { level } = getRaidLevelInfo(element.raidCount);

            guildList.push({
                name: `${rankLabel(index)} ${element.guildName} — Level ${level}`,
                value: `👑 ${leaderName} • 👥 ${element.memberList.length}/${element.memberCap} members • ⚔️ ${element.raidCount.toLocaleString()} raids`,
                inline: false,
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏰 Guild Leaderboard`)
            .setDescription(`${sortedGuilds.length.toLocaleString()} guilds, ranked by raid wins (level is a readout of that, see /guild)`)
            .setColor("Gold")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(guildList)
        return embed;
    }

    // Paginated exactly like createAchievementsPageEmbed/createQuestsPageEmbed — shop
    // item lists (up to 10 entries) made for a very long single embed otherwise.
    createShopPageEmbed(shopDetails, pageItems, pageIndex, totalPages) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        const shopList = pageItems.map(element => ({
            name: `${element.id}) ${element.name} (${element.amount.toLocaleString()})`,
            value: `${element.description}\nId: ${element.id} | Cost: ${element.cost.toLocaleString()}`,
            inline: false,
        }));

        const embed = new EmbedBuilder()
            .setTitle(`${shopDetails.title}`)
            .setDescription(`${shopDetails.description}\nPage ${pageIndex + 1} / ${totalPages}`)
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
        // Computed live from raidCount (wins only) rather than a stored field — see
        // raidFactory.js's getRaidLevelInfo and constants.js's RaidLevel.
        const raidLevelInfo = getRaidLevelInfo(guild.raidCount);

        fields.push({
            name: `Leader:`,
            value: leader ? `${leader.username}` : 'Unknown',
            inline: true
        })
        fields.push({
            name: `Members:`,
            value: `${guild.memberList.length}/${guild.memberCap}`,
            inline: true
        })
        fields.push({
            name: `Guild Level:`,
            value: raidLevelInfo.winsToNextLevel !== null
                ? `${raidLevelInfo.level} (${raidLevelInfo.winsToNextLevel.toLocaleString()} raid wins to next level)`
                : `${raidLevelInfo.level} (max)`,
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
            value: `${raidLevelInfo.multiplier.toFixed(2)}x (raid wins only)`,
            inline: true
        })
        fields.push({
            name: `Guild Buff:`,
            value: GuildBuffLabels[guild.guildBuff] || `${guild.guildBuff}`,
            inline: false
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

    // Shown before /start-raid actually rolls — a raid's difficulty bracket (Metal
    // King/T3/T2/T1) is picked randomly, so there's no single "success chance" to
    // preview like /rob has; instead this breaks down every bracket you could land in
    // along with its own odds, success chance, and stakes, so whoever's starting it (and
    // committing the whole roster's raid list) isn't picking blind.
    createRaidPreviewEmbed(guildName, raidSelection, raiderCount, totalMultiplier, brackets, guildLevel, raidRewardMultiplier) {
        const fields = brackets.map(bracket => ({
            name: `${bracket.name} (${(bracket.odds * 100).toFixed(0)}% odds of this bracket)`,
            value: `${(bracket.successChance * 100).toFixed(1)}% success chance\n✅ ${bracket.rewardText}\n❌ ${bracket.penaltyText}`,
            inline: false,
        }));

        // Reward numbers in each bracket above already have the level multiplier baked
        // in — this line just makes it visible why, instead of leaving players to infer
        // it from the raw numbers.
        const levelNote = guildLevel > 1 ? ` Guild Level ${guildLevel} (${raidRewardMultiplier.toFixed(2)}x reward multiplier) is already applied below.` : '';

        const embed = new EmbedBuilder()
            .setTitle(`${guildName}, start a ${raidSelection} raid?`)
            .setDescription(`${raiderCount} raider${raiderCount == 1 ? '' : 's'} joined, ${totalMultiplier.toFixed(2)}x combined work multiplier.${levelNote} Confirm to roll — whichever bracket below you land in resolves immediately, no second chance to back out once rolled.`)
            .setColor("Yellow")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRaidCancelledEmbed(guildName) {
        const embed = new EmbedBuilder()
            .setTitle(`${guildName}'s raid was not started`)
            .setDescription(`No roll happened — the raid roster is untouched, start it again whenever ready.`)
            .setColor("Grey")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // Paginated exactly like createAchievementsPageEmbed/createShopPageEmbed — unlike a
    // guild raid (capped at memberCap, currently 5), anyone on the server can join a
    // world raid, so raidList has no upper bound and could otherwise exceed Discord's
    // 25-field embed limit and throw.
    createWorldRaidPageEmbed(pageItems, pageIndex, totalPages, totalMultiplier, name, thumbnail) {
        const embed = new EmbedBuilder()
            .setTitle(`${name}: (Total Multiplier: ${totalMultiplier.toFixed(2)}x)`)
            .setDescription(`Below is the list of the current raid members\nPage ${pageIndex + 1} / ${totalPages}`)
            .setColor("Orange")
            .setThumbnail(thumbnail)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(pageItems);
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

        // Surfaces the hourly special-odds event (if one's live) right on the result
        // embed, since the announcement in chat is easy to miss/scroll past and there
        // was previously no way to check "is something boosted right now?".
        const activeEvent = eventFactory.getCurrentEvent();
        if (activeEvent) {
            footerText += ` • 🎉 ${activeEvent}`;
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

    // result: { isNew, companion, potatoesGained } from workFactory.handleCompanionEncounter.
    // A brand-new companion shows its perk and a reminder to /companion equip it (won,
    // not auto-equipped — equipping stays a deliberate choice); a duplicate pull shows
    // the consolation potato payout instead, same "Gained" framing as every other
    // potato-reward encounter.
    createCompanionEncounterEmbed(userDisplayName, newWorkCount, result) {
        const { isNew, companion, potatoesGained } = result;
        let fields = [{
            name: `Work Count:`,
            value: `${newWorkCount.toLocaleString()}`,
            inline: true,
        }];

        let description, footerText = "Made by Beggar";
        if (isNew) {
            fields.push({
                name: `Perk:`,
                value: formatCompanionPerks(companion),
                inline: true,
            });
            description = `${companion.description}\n\nUse \`/companion equip\` to make ${companion.name} your active companion!`;
        } else {
            fields.push({
                name: `Potatoes Gained:`,
                value: `${potatoesGained.toLocaleString()} potatoes`,
                inline: true,
            });
            description = `${companion.description}\n\nYou already have a ${companion.name} — it hands over a consolation bag of potatoes instead.`;
        }

        const activeEvent = eventFactory.getCurrentEvent();
        if (activeEvent) {
            footerText += ` • 🎉 ${activeEvent}`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} encountered a wandering companion: ${companion.name}! (${COMPANION_RARITY_LABEL[companion.rarity]})`)
            .setDescription(description)
            .setColor(COMPANION_RARITY_COLOR[companion.rarity])
            .setThumbnail(companion.thumbnailUrl)
            .setFooter({ text: footerText })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // pageItems: full companion objects (owned ids already resolved to roster entries)
    // for this page. Paginated exactly like createAchievementsPageEmbed/createQuestsPageEmbed.
    createCompanionListEmbed(userDisplayName, pageItems, pageIndex, totalPages, activeId, totalOwned) {
        const fields = pageItems.length > 0 ? pageItems.map(companion => {
            const status = companion.id === activeId ? '✅ Active' : companion.id;
            return {
                name: `${companion.name} (${COMPANION_RARITY_LABEL[companion.rarity]})`,
                value: `${formatCompanionPerks(companion)}\n${status}`,
                inline: false,
            };
        }) : [{ name: 'No companions yet', value: 'Keep working — Wandering Companion encounters can happen on any /work!', inline: false }];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Companions`)
            .setDescription(`${totalOwned} / ${Companions.length} collected\nPage ${pageIndex + 1} / ${totalPages}\n\nUse \`/companion equip\` to change your active companion.`)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
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
            value: `${tailsCount.toLocaleString()} tails`,
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

    // Shown before the roll happens so the player can back out — previously the odds
    // and stakes were only ever revealed in the same embed as the already-decided result.
    createRobPreviewEmbed(userDisplayName, userId, userAvatar, targetUserDisplayName, chanceToRob, minGain, maxGain, minFine, maxFine) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const fields = [
            {
                name: `Chance to Rob:`,
                value: `${chanceToRob}%`,
                inline: true,
            },
            {
                name: '\n',
                value: '\n',
                inline: false
            },
            {
                name: `If Successful:`,
                value: `+${minGain.toLocaleString()} to ${maxGain.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `If Caught:`,
                value: `-${minFine.toLocaleString()} to ${maxFine.toLocaleString()} potatoes`,
                inline: true,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}, rob ${targetUserDisplayName}?`)
            .setDescription(`Confirm to make the attempt — either outcome puts you on cooldown, and getting caught also extends your next /work.`)
            .setColor("Yellow")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRobCancelledEmbed(userDisplayName, userId, userAvatar, targetUserDisplayName) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} backed out`)
            .setDescription(`No attempt was made on ${targetUserDisplayName} — no cooldown applied, try again whenever.`)
            .setColor("Grey")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    createRebirthNotEligibleEmbed(userDisplayName, userId, userAvatar, missing) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} isn't ready to rebirth yet`)
            .setDescription(`Rebirth requires every base shop tier AND every regrade track fully maxed out. Still needed:\n${missing.map(m => `❌ ${m}`).join('\n')}`)
            .setColor("Grey")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    createRebirthPreviewEmbed(userDisplayName, userId, userAvatar, userDetails) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const nextRebirthCount = (userDetails.rebirthCount || 0) + 1;
        const fields = [
            {
                name: `Resets to zero:`,
                value: `Potatoes, banked potatoes, all 3 regrade tracks, and the shop-purchased portion of Work Multiplier / Passive Income / Bank Capacity / Starch Capacity`,
                inline: false,
            },
            {
                name: `Kept:`,
                value: `Achievements, personal records, starches, and every permanent buff you've earned (Sweet Potato, Metal Potato, raids, quests)`,
                inline: false,
            },
            {
                name: `Permanent gain:`,
                value: `+${Rebirth.WORK_MULTI_BONUS.toFixed(2)}x Work Multiplier, +${Rebirth.PASSIVE_BONUS.toLocaleString()} Passive Income, +${Rebirth.BANK_CAPACITY_BONUS.toLocaleString()} Bank Capacity — folded into your permanent buffs, stacks with every future rebirth`,
                inline: false,
            },
            {
                name: `This will be rebirth #:`,
                value: `${nextRebirthCount}`,
                inline: true,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}, rebirth? This cannot be undone.`)
            .setDescription(`You're maxed out on every shop tier and every regrade track. Confirm to reset and gain a permanent boost — decline and nothing changes.`)
            .setColor("Yellow")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createRebirthCancelledEmbed(userDisplayName, userId, userAvatar) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} backed out`)
            .setDescription(`Nothing was reset — your progress is untouched, rebirth whenever you're ready.`)
            .setColor("Grey")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    createRebirthCompleteEmbed(userDisplayName, userId, userAvatar, newState) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const fields = [
            {
                name: `Rebirth #:`,
                value: `${newState.rebirthCount}`,
                inline: true,
            },
            {
                name: `New Work Multiplier:`,
                value: `${newState.workMultiplierAmount.toFixed(2)}x`,
                inline: true,
            },
            {
                name: `New Passive Income:`,
                value: `${newState.passiveAmount.toLocaleString()} potatoes/day`,
                inline: true,
            },
            {
                name: `New Bank Capacity:`,
                value: `${newState.bankCapacity.toLocaleString()} potatoes`,
                inline: true,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} has been reborn!`)
            .setDescription(`Potatoes, bank, shops, and regrades are back to zero — but your permanent buffs, achievements, records, and starches came with you, plus this rebirth's boost.`)
            .setColor("Purple")
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

    createGiveEmbed(userDisplayName, userId, userAvatar, currencyLabel, amount, taxAmount, receivedAmount, userBalance, targetUserDisplayName, targetUserBalance) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const currencyLower = currencyLabel.toLowerCase();
        let fields = [];

        fields.push({
            name: `Current ${currencyLabel}:`,
            value: `${userBalance.toLocaleString()} ${currencyLower}`,
            inline: true,
        })
        fields.push({
            name: `Target's ${currencyLabel}:`,
            value: `${targetUserBalance.toLocaleString()} ${currencyLower}`,
            inline: true,
        })
        fields.push({
            name: '\n',
            value: '\n',
            inline: false
        })
        fields.push({
            name: `${currencyLabel} Given:`,
            value: `${amount.toLocaleString()} sent — ${receivedAmount.toLocaleString()} received (-${taxAmount.toLocaleString()} tax)`,
            inline: true,
        })

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName} gives ${currencyLower} to ${targetUserDisplayName}!`)
            .setDescription(`Displayed below are your current ${currencyLower}, your target's ${currencyLower}, and how many ${currencyLower} you gave.`)
            .setColor("Green")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Shown when /bank is run with no amount, offering quick percentage buttons instead
    // of requiring a typed number.
    createBankAmountPickerEmbed(userDisplayName, userId, userAvatar, action, userPotatoes, userBankStored, userBankCapacity) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const bar = buildProgressBar(userBankStored, userBankCapacity);
        const fillPercent = userBankCapacity > 0 ? (userBankStored / userBankCapacity * 100) : 0;
        const available = action === 'deposit' ? userPotatoes : userBankStored;
        const availableLabel = action === 'deposit' ? 'Liquid Potatoes' : 'Banked Potatoes';

        const fields = [
            {
                name: `${availableLabel}:`,
                value: `${available.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `Bank Capacity:`,
                value: `${bar} ${fillPercent.toFixed(1)}%\n${userBankStored.toLocaleString()} / ${userBankCapacity.toLocaleString()} potatoes`,
                inline: false,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`🏦 ${userDisplayName}, how much do you want to ${action}?`)
            .setDescription(`Pick a quick amount below, or run \`/bank\` again with a specific number.`)
            .setColor("Blue")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createBankEmbed(userDisplayName, userId, userAvatar, action, netAmount, feeAmount, userPotatoes, userBankStored, userBankCapacity) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const actionLabel = action === 'deposit' ? 'Deposited' : 'Withdrew';
        const color = action === 'deposit' ? 'Green' : 'Blue';
        const bar = buildProgressBar(userBankStored, userBankCapacity);
        const fillPercent = userBankCapacity > 0 ? (userBankStored / userBankCapacity * 100) : 0;

        const fields = [
            {
                name: `${actionLabel}:`,
                value: feeAmount > 0
                    ? `${netAmount.toLocaleString()} potatoes (${feeAmount.toLocaleString()} potato fee charged)`
                    : `${netAmount.toLocaleString()} potatoes`,
                inline: false,
            },
            {
                name: `Liquid Potatoes:`,
                value: `${userPotatoes.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `Bank Capacity:`,
                value: `${bar} ${fillPercent.toFixed(1)}%\n${userBankStored.toLocaleString()} / ${userBankCapacity.toLocaleString()} potatoes`,
                inline: false,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`🏦 ${userDisplayName}'s Bank`)
            .setColor(color)
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createGuildBankEmbed(userDisplayName, userId, userAvatar, guildName, action, netAmount, feeAmount, userPotatoes, guildBankStored, guildBankCapacity) {
        const avatarUrl = getUserAvatar(userId, userAvatar);
        const actionLabel = action === 'deposit' ? 'Deposited' : 'Withdrew';
        const color = action === 'deposit' ? 'Green' : 'Blue';
        const bar = buildProgressBar(guildBankStored, guildBankCapacity);
        const fillPercent = guildBankCapacity > 0 ? (guildBankStored / guildBankCapacity * 100) : 0;

        const fields = [
            {
                name: `${actionLabel}:`,
                value: feeAmount > 0
                    ? `${netAmount.toLocaleString()} potatoes (${feeAmount.toLocaleString()} potato fee charged)`
                    : `${netAmount.toLocaleString()} potatoes`,
                inline: false,
            },
            {
                name: `Your Liquid Potatoes:`,
                value: `${userPotatoes.toLocaleString()} potatoes`,
                inline: true,
            },
            {
                name: `${guildName}'s Guild Bank:`,
                value: `${bar} ${fillPercent.toFixed(1)}%\n${guildBankStored.toLocaleString()} / ${guildBankCapacity.toLocaleString()} potatoes`,
                inline: false,
            },
        ];

        const embed = new EmbedBuilder()
            .setTitle(`🏰 ${guildName}'s Guild Bank`)
            .setColor(color)
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

    createDailyStreakEmbed(userDisplayName, streak, reward) {
        const embed = new EmbedBuilder()
            .setTitle(`🥔 ${userDisplayName}'s Daily Spud Streak: Day ${streak}!`)
            .setDescription(`+${reward.toLocaleString()} potatoes for showing up today. Come back tomorrow to keep the streak going!`)
            .setColor("Orange")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    createTowerLeaderboardEmbed(sortedEntries) {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        let entryList = [];
        if (sortedEntries.length === 0) {
            entryList.push({
                name: "No survivors yet today!",
                value: "Be the first to leave the Tater Tower alive and claim the top spot.",
                inline: false,
            });
        } else {
            sortedEntries.slice(0, 5).forEach((entry, index) => {
                entryList.push({
                    name: `${rankLabel(index)} ${entry.username}`,
                    value: `Floor ${entry.floor.toLocaleString()}`,
                    inline: false,
                });
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("🗼 Tater Tower Leaderboard (Today)")
            .setDescription("Only survived runs count — die to an Elite and your run won't rank, no matter how deep you got. Resets daily at 4am UTC.")
            .setColor("Purple")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(entryList)
        return embed;
    }

    createTowerLeaderboardResultsEmbed(winners) {
        const medals = ['🥇', '🥈', '🥉'];
        const fields = winners.map((winner, index) => {
            const bonusParts = [];
            if (winner.bonus.potatoes > 0) bonusParts.push(`+${winner.bonus.potatoes.toLocaleString()} potatoes`);
            if (winner.bonus.workMultiplier > 0) bonusParts.push(`+${winner.bonus.workMultiplier.toFixed(1)}x work multiplier`);
            if (winner.bonus.passiveIncome > 0) bonusParts.push(`+${winner.bonus.passiveIncome.toLocaleString()} passive income`);
            if (winner.bonus.bankCapacity > 0) bonusParts.push(`+${winner.bonus.bankCapacity.toLocaleString()} bank capacity`);
            return {
                name: `${medals[index] || ''} #${winner.place} ${winner.username} — Floor ${winner.floor.toLocaleString()}`,
                value: bonusParts.length > 0 ? bonusParts.join('\n') : "No bonus earned this run",
                inline: false,
            };
        });

        const embed = new EmbedBuilder()
            .setTitle("🗼 Tater Tower Daily Results!")
            .setDescription("Today's top survivors of the Tater Tower have claimed their rewards!")
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // One page's worth (pageItems, already sliced by the caller) of the active quest
    // list — used by the /quests button-pagination flow, mirroring
    // createAchievementsPageEmbed's shape even though the active count (5) rarely needs
    // more than one page today.
    createQuestsPageEmbed(userDisplayName, pageItems, pageIndex, totalPages, completedCount, totalCount) {
        const fields = pageItems.map(({ quest, isCompleted, progress }) => {
            const status = isCompleted ? '✅' : '📜';
            const categoryLabel = quest.category === 'daily' ? 'Daily' : 'Weekly';
            const value = isCompleted
                ? `${quest.description} (${categoryLabel})`
                : `${quest.description} (${categoryLabel})\n(${progress.toLocaleString()} / ${quest.threshold.toLocaleString()})`;
            return {
                name: `${status} ${quest.name}`,
                value: value,
                inline: false,
            };
        });

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Quests`)
            .setDescription(`${completedCount} / ${totalCount} completed — dailies reset 4am UTC, weeklies reset Mondays\nPage ${pageIndex + 1} / ${totalPages}`)
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Paginated exactly like createQuestsPageEmbed — pageItems is already the reversed
    // (most-recent-first), sliced-to-page-size history array from guildHistory.js.
    createGuildHistoryPageEmbed(guildName, type, pageItems, pageIndex, totalPages, totalCount) {
        const fields = pageItems.map(entry => {
            const when = new Date(entry.timestamp || entry.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            if (type === 'raid') {
                const status = entry.won ? '✅ Won' : '❌ Lost';
                return {
                    name: `${when} — ${entry.raidTier} raid`,
                    value: `${status} — ${entry.potatoDelta.toLocaleString()} potatoes ${entry.won ? 'gained' : 'at stake'}`,
                    inline: false,
                };
            }
            return {
                name: `${when} — ${entry.templateName}`,
                value: `✅ Completed — +${entry.reward.toLocaleString()} Bank Capacity`,
                inline: false,
            };
        });

        if (fields.length === 0) {
            fields.push({
                name: 'Nothing here yet',
                value: type === 'raid' ? 'No guild raids have been fought yet.' : 'No Guild Contracts have been completed yet.',
                inline: false,
            });
        }

        const title = type === 'raid' ? `${guildName}'s Raid History` : `${guildName}'s Guild Contract History`;
        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(`${totalCount} total — Page ${pageIndex + 1} / ${totalPages}`)
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createQuestCompleteEmbed(userDisplayName, completedQuests, userMultiplier) {
        const fields = completedQuests.map(quest => {
            let rewardText;
            if (quest.category === 'daily') {
                const perQuestReward = Math.floor(DailyQuest.BASE_REWARD_PER_MULTIPLIER * userMultiplier);
                rewardText = `+${perQuestReward.toLocaleString()} potatoes`;
            } else if (quest.reward) {
                const labels = { workMultiplierAmount: 'Work Multiplier', passiveAmount: 'Passive Income', bankCapacity: 'Bank Capacity' };
                // grantedRewardAmount is the actual amount questFactory computed for this
                // player (ramped by their regrade progress on that stat) — not a flat
                // template value, so it varies player to player.
                const amount = quest.reward.statType === 'workMultiplierAmount'
                    ? `+${quest.grantedRewardAmount.toFixed(2)}x`
                    : `+${Math.round(quest.grantedRewardAmount).toLocaleString()}`;
                rewardText = `${amount} ${labels[quest.reward.statType]}`;
            }
            return {
                name: `✅ ${quest.name}`,
                value: `${quest.description}\n${rewardText}`,
                inline: false,
            };
        });

        const title = completedQuests.length > 1
            ? `${userDisplayName} completed ${completedQuests.length} quests!`
            : `${userDisplayName} completed a quest!`;

        const embed = new EmbedBuilder()
            .setTitle(`📜 ${title}`)
            .setColor("Green")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    createQuestRotationEmbed(activeQuests, weeklyRotated) {
        const dailyTemplates = Quests.filter(quest => activeQuests.dailyQuestIds.includes(quest.id));
        const fields = dailyTemplates.map(quest => ({
            name: `📜 ${quest.name}`,
            value: quest.description,
            inline: false,
        }));

        if (weeklyRotated) {
            const weeklyTemplates = Quests.filter(quest => activeQuests.weeklyQuestIds.includes(quest.id));
            weeklyTemplates.forEach(quest => {
                fields.push({
                    name: `🗓️ ${quest.name} (Weekly)`,
                    value: quest.description,
                    inline: false,
                });
            });
        }

        const embed = new EmbedBuilder()
            .setTitle("📜 New Quests Available!")
            .setDescription(weeklyRotated ? "Today's quests, plus this week's new weekly quests:" : "Today's quests (weeklies unchanged):")
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // /guild-contract — read-only display of the active weekly Guild Contract and this
    // guild's aggregate progress toward it. progressResult is whatever
    // GuildContractFactory.getProgress returned (never null here — the command replies
    // with a plain message instead of building this embed when there's no active
    // contract at all).
    createGuildContractEmbed(guild, progressResult, breakdown) {
        const { template, progress, threshold, isCompleted } = progressResult;

        const fields = [
            {
                name: "Progress",
                value: `${progress.toLocaleString()} / ${threshold.toLocaleString()}`,
                inline: true,
            },
            {
                name: "Status",
                value: isCompleted ? "✅ Completed — reward already granted" : "📜 In progress",
                inline: true,
            },
            {
                name: "Reward",
                value: `+${GuildContract.BANK_CAPACITY_REWARD.toLocaleString()} Bank Capacity (guild-wide)`,
                inline: false,
            }
        ];

        // Only worth showing once there's something to rank — a guild with no fresh
        // baseline yet (nobody's worked since the contract rotated in) gets an empty
        // breakdown, same case getProgress reports as 0 progress.
        if (breakdown && breakdown.length > 0) {
            const topContributors = breakdown.slice(0, 5)
                .map((member, index) => `${index + 1}. ${member.username}: ${member.delta.toLocaleString()}`)
                .join('\n');
            fields.push({
                name: "Top Contributors",
                value: topContributors,
                inline: false,
            });
        }

        if (!guild.thumbnailUrl) {
            guild.thumbnailUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';
        }

        const embed = new EmbedBuilder()
            .setTitle(`🤝 ${guild.guildName}'s Guild Contract`)
            .setDescription(`${template.name}: ${template.description}`)
            .setColor("Orange")
            .setThumbnail(guild.thumbnailUrl)
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Follow-up sent from /work when a guild member's action pushes their guild's
    // active Guild Contract over its threshold — mirrors createQuestCompleteEmbed's
    // shape, one level up (guild-wide instead of per-user).
    createGuildContractCompleteEmbed(guildName, template, bankCapacityReward) {
        const embed = new EmbedBuilder()
            .setTitle(`🤝 ${guildName} completed its Guild Contract!`)
            .setDescription(`${template.name}: ${template.description}`)
            .addFields({
                name: "Reward",
                value: `+${bankCapacityReward.toLocaleString()} Bank Capacity (guild-wide, permanent)`,
                inline: false,
            })
            .setColor("Green")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // Posted to the events channel by the 4am cron on the Mondays a new Guild Contract
    // actually rotates in (mirrors createQuestRotationEmbed, which only posts weekly
    // quest changes on the Mondays they actually happen).
    createGuildContractRotationEmbed(activeContract, template) {
        const embed = new EmbedBuilder()
            .setTitle("🤝 New Guild Contract Available!")
            .setDescription(`This week, every guild can work toward:\n**${template.name}** — ${template.description}`)
            .addFields({
                name: "Reward",
                value: `+${GuildContract.BANK_CAPACITY_REWARD.toLocaleString()} Bank Capacity (guild-wide) on completion`,
                inline: false,
            })
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
        return embed;
    }

    // Discord caps a single embed at 25 fields and a message at 10 embeds, so both
    // achievement embed builders below chunk into multiple embeds rather than risk
    // throwing (or silently truncating) once the achievement list grows past 25.
    createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked) {
        const fields = newlyUnlocked.map(achievement => ({
            name: achievement.name,
            value: achievement.description,
            inline: false,
        }));

        const title = newlyUnlocked.length > 1
            ? `${userDisplayName} unlocked ${newlyUnlocked.length} achievements!`
            : `${userDisplayName} unlocked an achievement!`;

        const chunks = chunkFields(fields, 25);
        return chunks.map((chunk, index) => {
            const embed = new EmbedBuilder()
                .setColor("Gold")
                .setFooter({ text: "Made by Beggar" })
                .setTimestamp(Date.now())
                .setFields(chunk)
            if (index === 0) embed.setTitle(`🏆 ${title}`);
            return embed;
        });
    }

    // One page's worth (pageItems, already sliced by the caller) of the achievement list —
    // used by the /achievements button-pagination flow in achievements.js, so each page
    // stays a single small embed rather than growing into a wall of text.
    createAchievementsPageEmbed(userDisplayName, pageItems, pageIndex, totalPages, unlockedCount, totalCount) {
        const fields = pageItems.map(({ achievement, isUnlocked, currentValue }) => {
            const status = isUnlocked ? '✅' : '🔒';
            const value = isUnlocked
                ? achievement.description
                : `${achievement.description}\n(${Math.min(currentValue, achievement.threshold).toLocaleString()} / ${achievement.threshold.toLocaleString()})`;
            return {
                name: `${status} ${achievement.name}`,
                value: value,
                inline: false,
            };
        });

        const embed = new EmbedBuilder()
            .setTitle(`${userDisplayName}'s Achievements`)
            .setDescription(`${unlockedCount} / ${totalCount} unlocked\nPage ${pageIndex + 1} / ${totalPages}`)
            .setColor("Gold")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }

    // Admin-only sanity-check dashboard (/admin-stats) — surfaces state that's already
    // cached/persisted elsewhere (economy stats doc, starch doc, world doc, active_quests
    // doc) in one place instead of admins checking DynamoDB directly. Every param can be
    // null/undefined (a fresh deploy before the relevant cron/tick has ever run) so each
    // field falls back to a "not available yet" string rather than throwing.
    createAdminStatsEmbed(economy, starchStatus, worldStatus, activeQuests) {
        let fields = [];

        fields.push({
            name: "Server Total",
            value: economy
                ? `${economy.serverTotal.toLocaleString()} potatoes\n${economy.serverTotalStarches.toLocaleString()} starches`
                : "Not cached yet",
            inline: true,
        });
        fields.push({
            name: "Median Lifetime Earnings",
            value: economy ? `${economy.medianTotalEarnings.toLocaleString()} potatoes` : "Not cached yet",
            inline: true,
        });
        fields.push({
            name: "Active Users",
            value: economy ? `${economy.activeUserCount.toLocaleString()}` : "Not cached yet",
            inline: true,
        });

        fields.push({
            name: "Starch Cycle",
            value: starchStatus.price != null
                ? `Currently **${starchStatus.phase === 'buy' ? 'buying' : 'selling'}** at ${starchStatus.price.toLocaleString()} potatoes/starch`
                : "Not cached yet",
            inline: false,
        });

        fields.push({
            name: "Active World Boss",
            value: worldStatus.active
                ? `${worldStatus.bossName} — ${worldStatus.raidMemberCount} joined`
                : "None active",
            inline: false,
        });

        const dailyNames = activeQuests
            ? Quests.filter(quest => activeQuests.dailyQuestIds?.includes(quest.id)).map(quest => quest.name)
            : [];
        const weeklyNames = activeQuests
            ? Quests.filter(quest => activeQuests.weeklyQuestIds?.includes(quest.id)).map(quest => quest.name)
            : [];
        fields.push({
            name: `Daily Quests${activeQuests ? ` (since ${activeQuests.dailyRotationDate})` : ''}`,
            value: dailyNames.length ? dailyNames.join(", ") : "Not rotated yet",
            inline: false,
        });
        fields.push({
            name: `Weekly Quests${activeQuests ? ` (since ${activeQuests.weeklyRotationDate})` : ''}`,
            value: weeklyNames.length ? weeklyNames.join(", ") : "Not rotated yet",
            inline: false,
        });

        const embed = new EmbedBuilder()
            .setTitle("🛠️ Admin Economy Dashboard")
            .setDescription("Cached game-health snapshot — refreshes every 5 minutes via the passive income tick, except quests/world which update on their own triggers.")
            .setColor("Blue")
            .setFooter({ text: "Made by Beggar" })
            .setTimestamp(Date.now())
            .setFields(fields)
        return embed;
    }
}

function chunkFields(fields, size) {
    const chunks = [];
    for (let i = 0; i < fields.length; i += size) {
        chunks.push(fields.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
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