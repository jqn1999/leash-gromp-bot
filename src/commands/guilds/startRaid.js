const dynamoHandler = require("../../utils/dynamoHandler");
const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles, Raid, metalKingRaidBoss, regularStatRaidMobs } = require("../../utils/constants")
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval } = require("../../utils/helperCommands")
const { RaidFactory } = require("../../utils/raidFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();

const regularRaidMobs = [
    [
        {
            name: "Celerity, the Swift Stalk",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
            description: `Journeying through the Verdant Forests of the Potato Kingdom, the potato adventurers reach the clearing of Celerity, the Swift Stalk. They pursue their target, a celery stick infused with the essence of unparalleled speed, in a high-paced raid laden with rushing vines. The party\'s agility and coordination will be tested as they aim to claim victory over this fleet-footed foe.`,
            successDescription: 'With synchronized precision, the brave warriors strategically servers Celerity\'s roots, halting its lightning-speed assaults and claiming triumph over the Swift Stalk.',
            failureDescription: 'Overwhelmed by the relentless barrage of swift strikes, the adventurers succumb to Celerity\'s lightning-fast onslaught, leaving the forest engulfed in the echoes of their unsuccessful struggle.',
            credit: 'Inspired by Moonwave'
        },
        {
            name: "Baron Durianwrath, the Aromatic Abomination",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1198039614112399542/image.png?ex=65bd7456&is=65aaff56&hm=4a1bca2d540e14b0c2258bcb6a4b5ca6ddb9289d8221bc4fb5294df98e62247e&",
            description: `Venturing deep into the dimly lit caverns below the Potato Kingdom, the spud adventurers encounter Baron Durianwrath! The Baron, infused with the essence of foul-smelling durians, offers the heroes a daunting challenge as the air thickens with a pungent aroma. The party must navigate the cavernous battleground carefully by dodging Durianwrath\s explosive attacks and dispatching his nefarious minions if they hope to emerge victoriously from this aromatic raid.`,
            successDescription: 'The courageous raiders withstand the overwhelming stench long enough to overcome Baron Durianwrath by prioritizing his minions. They deliver a decisive blow and purge the Aromatic Abomination from the depths of the kingdom… for now.',
            failureDescription: 'The party is overwhelmed by the potent combination of odor and destructive force unleashed by the Baron and his minions. They succumb to the noxious fumes and explosive durian attacks, falling one by one.',
            credit: 'Inspired by Moonwave'
        }
    ],
    [
        Scallionshade, the Shadowy Scion 
    ],
    [
        Garlicore, the Pungent Overlord 
    ]
]

const eliteRaidMobs = [
    [Radishreaper, the Reaper of Roots

    ],
    [
        {
            name: "Basilbane, the Herbaceous Harbinger",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1205682852172271727/baycil.png?ex=65d942a8&is=65c6cda8&hm=499bab1149a7948b3811db877a628775b9a9a4725cc1382fa14571281575baa7&",
            description: `In the twisted jungles beyond the Potato Kingdom grows the Herbaceous Harbinger, Basilbane. Standing as a colossal basil plant adorned with twisting vines and eerily vibrant leaves, this formidable foe harnesses the power of nature. It unleashes entangling vines, toxic spores, and a pervasive herbal aura that challenges even the bravest of the Potato Kingdom\'s adventurers.`,
            successDescription: 'The potato adventurers combine their herbal expertise with keen tactics to counter Basilbane\'s botanical onslaught, plucking the Herbaceous Harbinger from its roots and restoring balance to the jungle.',
            failureDescription: 'The spud adventurers are overwhelmed by the entangling vines and toxic spores unleashed by Basilbane. As its heroes succumb to an agricultural onslaught, the Potato Kingdom edges closer to a dominion under the Herbaceous Harbinger.',
            credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
        }
    ],
    [

    ]
]

const legendaryRaidMobs = [
    [
        {
            name: "Gourdor, the Pumpkin Knight",
            thumbnailUrl: "",
            description: `Gourdor, the Pumpkin Knight, is a malevolent entity draped in twisted pumpkin vines and wielding a sinister blade forged from the darkest gourd. His presence instills fear and dread as he roams the realms, seeking to sow chaos and destruction with his wicked powers.`,
            successDescription: 'Through sheer determination and cunning strategy, the spud heroes vanquish Gourdor, the embodiment of autumnal terror, shattering his malevolent reign and restoring peace to the realms. The shadow of his evil dissipates, allowing hope to blossom once more.',
            failureDescription: 'Overpowered by Gourdor\'s dark magic and relentless fury, the potato adventurers fall before the Pumpkin Knight\'s tyranny, leaving the realms to languish in eternal darkness under his oppressive rule, their hopes crushed beneath the weight of his malevolence.',
            credit: 'Made by Beggar'
        }
    ],
    [
        {
            name: "Netherfig, the Abyssal Figwraith",
            thumbnailUrl: "https://media.discordapp.net/attachments/221456693127675904/1201738231243341885/plant.png?ex=65cae8f1&is=65b873f1&hm=44ed099acc8954ccd201e86299bebd47fcf660430fd54aae7e98f9df089aea5d&",
            description: `Not far from the Potato Kingdom, a great fissure erupts with the emergence of Netherfig, the Abyssal Figwraith. As it slithers from the depths draped in ethereal foliage, the Figwraith\'s baleful core pulsates with an eerily familiar dark energy. The potato adventurers set out to combat this insidious invader, whose sinister spells and horrifying hellspawn threaten to ensnare the realm and swallow it whole.`,
            successDescription: 'The heroes of the Potato Kingdom pierce Netherfig\'s abyssal veil of evil energy with unwavering resolve. Narrowly avoiding menacing minions, the party launches a full-force attack that ruptures the Figwraith\'s sinister core. Having suffered significant damage, Netherfig is banished back to the shadowy depths it emerged from.',
            failureDescription: 'The potato adventurers prove to be no match for the Figwraith\'s dark enchantments, relentless minions, and abyssal forces. Now unopposed, Netherfig continues to spread darkness and chaos throughout the realm. Left unchecked, it will plunge the world into a never-ending nightfall.',
            credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
        },
        {
            name: "Behemoth Broccoli, the Green Guardian",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198836128179032125/SPOILER_image.png?ex=65c05a26&is=65ade526&hm=ae08d9219546b86ef8a79e0de03c87ba36245c0cfdb302999da13bd05dbd3305&",
            description: `Despite their intentions, the heroes of the peaceful Potato Kingdom are not an objective good. Their wonton violence against innocent vegetables is answered by an immense being adorned with towering florets and leafy armor: Behemoth Broccoli. A primal entity tasked with safeguarding helpless vegetables, the Green Guardian awakens and emerges from the heart of the Verdant Forests to pass judgment.`,
            successDescription: 'Strategic teamwork and perseverance allow the spud heroes to defend against the Green Guardian\'s assault. Standing steadfast against the forces of nature, they dismantle Behemoth Broccoli\'s leafy defenses and strike at its core, where it is most vulnerable. Having been pushed back and sapped of its energy, the towering sentinel returns to its slumber deep within the Verdant Forests.',
            failureDescription: 'The spud heroes fail to break through the Behemoth\'s resilient defenses. They fall victim to primordial punishment, dropping one by one to its potent vegetable magic and formidable might. Though the Potato Kingdom suffers a significant thrashing, the Green Guardian leaves it standing and returns to the Verdant Forests to keep watch for any adventurer daring enough to harm another vegetable.',
            credit: 'Inspired by Zoodbarg'
        }
    ],
    [
        Bitterblade, the Brutal Blight-bringer
    ]
]

function chooseMobFromList(mobList) {
    let random = Math.floor(Math.random() * mobList.length);
    const reward = mobList[random];
    return reward
}

function calculateRaidSuccessChance(totalMultiplier, raidDifficulty, maximumSuccessRate) {
    const totalRaidSuccessChance = totalMultiplier / raidDifficulty;
    const actualRaidSuccessChance = totalRaidSuccessChance > maximumSuccessRate ? maximumSuccessRate : totalRaidSuccessChance
    return actualRaidSuccessChance
}

async function removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost) {
    let raidSplit = null;
    if (guildBankStored + totalRaidCost >= 0) {
        guildBankStored += totalRaidCost;
        await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
    } else {
        raidSplit = await raidFactory.handlePotatoSplit(raidList, totalRaidCost);
    }
    return raidSplit
}

async function addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit) {
    let raidSplit = null;
    if (remainingBankSpace >= totalRaidSplit) {
        guildBankStored += totalRaidSplit;
        await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
    } else {
        raidSplit = await raidFactory.handlePotatoSplit(raidList, totalRaidSplit);
    }
    return raidSplit
}

const regularRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.LEGENDARY_RAID_MULTIPLIER_REWARD);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', Raid.LEGENDARY_RAID_PASSIVE_REWARD);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', Raid.LEGENDARY_RAID_CAPACITY_REWARD);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, Raid.LEGENDARY_RAID_MULTIPLIER_REWARD, Raid.LEGENDARY_RAID_PASSIVE_REWARD, Raid.LEGENDARY_RAID_CAPACITY_REWARD);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(legendaryRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.HARD_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.HARD_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.HARD_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .06
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(eliteRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.MEDIUM_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.MEDIUM_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.MEDIUM_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .26
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(regularRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.REGULAR_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.REGULAR_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: 1
    }
]

const harderRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.LEGENDARY_RAID_MULTIPLIER_REWARD);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', Raid.LEGENDARY_RAID_PASSIVE_REWARD);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', Raid.LEGENDARY_RAID_CAPACITY_REWARD);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, Raid.LEGENDARY_RAID_MULTIPLIER_REWARD, Raid.LEGENDARY_RAID_PASSIVE_REWARD, Raid.LEGENDARY_RAID_CAPACITY_REWARD);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 3;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(legendaryRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.HARD_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.HARD_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.HARD_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .11
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 4.5;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(eliteRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.MEDIUM_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.MEDIUM_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.MEDIUM_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .51
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 6;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(regularRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.REGULAR_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.REGULAR_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: 1
    }
]

const hardestRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.LEGENDARY_RAID_MULTIPLIER_REWARD);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', Raid.LEGENDARY_RAID_PASSIVE_REWARD);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', Raid.LEGENDARY_RAID_CAPACITY_REWARD);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, Raid.LEGENDARY_RAID_MULTIPLIER_REWARD, Raid.LEGENDARY_RAID_PASSIVE_REWARD, Raid.LEGENDARY_RAID_CAPACITY_REWARD);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 6;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(legendaryRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.HARD_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.HARD_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.HARD_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .21
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 8;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(eliteRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.MEDIUM_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.MEDIUM_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.MEDIUM_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .71
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 10;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(regularRaidMobs);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.REGULAR_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
            } else {
                totalRaidSplit = Math.round(Raid.REGULAR_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: 1
    }
]

const statRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction) => {
            let raidSplit = 0, totalRaidSplit = 0, raidResultDescription;
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_RAID_DIFFICULTY, Raid.MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                let workMultiReward = Raid.LEGENDARY_RAID_MULTIPLIER_REWARD * 2;
                let passiveReward = Raid.LEGENDARY_RAID_PASSIVE_REWARD * 2;
                let bankReward = Raid.LEGENDARY_RAID_CAPACITY_REWARD * 2;
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', workMultiReward);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', passiveReward);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', bankReward);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, workMultiReward, passiveReward, bankReward);
            } else {
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction) => {
            let raidSplit, totalRaidCost, raidResultDescription;
            const regularStatRaidMob = chooseMobFromList(regularStatRaidMobs);
            totalRaidCost = Math.round(Raid.REGULAR_STAT_RAID_COST * raidList.length);
            raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost);

            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_STAT_RAID_DIFFICULTY, Raid.MAXIMUM_STAT_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.REGULAR_STAT_RAID_REWARD);
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                raidResultDescription = regularStatRaidMob.successDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidCost, raidSplit, regularStatRaidMob, successChance, raidResultDescription, Raid.REGULAR_STAT_RAID_REWARD);
            } else {
                raidResultDescription = regularStatRaidMob.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidCost, raidSplit, regularStatRaidMob, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed] });
        },
        chance: 1
    }
]

module.exports = {
    name: "start-raid",
    description: "Starts a raid",
    deleted: false,
    options: [
        {
            name: 'raid-select',
            description: 'Which raid type to select',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'regular',
                    value: 'regular'
                },
                {
                    name: 'elite',
                    value: 'elite'
                },
                {
                    name: 'legendary',
                    value: 'legendary'
                },
                {
                    name: 'stat',
                    value: 'stat'
                }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const raidSelection = interaction.options.get('raid-select')?.value;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            interaction.editReply(`${userDisplayName} was not in the DB, they should now be added. Try again!`);
            return;
        }

        const userGuildId = userDetails.guildId;
        if (!userGuildId) {
            interaction.editReply(`${userDisplayName} you have no guild to start the raid of!`);
            return;
        }

        let guild = await dynamoHandler.findGuildById(userDetails.guildId);
        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }
        const guildId = guild.guildId;
        const guildName = guild.guildName;
        const memberList = guild.memberList;
        const raidRewardMultiplier = guild.raidRewardMultiplier;
        let raidList = guild.raidList;
        let raidCount = guild.raidCount;
        let guildTotalEarnings = guild.totalEarnings;
        let guildBankStored = guild.bankStored;
        let guildBankCapacity = guild.bankCapacity;
        let remainingBankSpace = guildBankCapacity - guildBankStored;

        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before starting!`);
            return;
        }

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        let canStartRaids = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER || member.role == GuildRoles.ELDER;
        if (!canStartRaids) {
            interaction.editReply(`${userDisplayName} you must be an elder, co-leader, or the guild leader to start a raid!`);
            return;
        }

        const timeSinceLastRaidInSeconds = Math.floor((Date.now() - guild.raidTimer) / 1000);
        const timeUntilRaidAvailableInSeconds = Raid.RAID_TIMER_SECONDS - timeSinceLastRaidInSeconds

        if (timeSinceLastRaidInSeconds < Raid.RAID_TIMER_SECONDS) {
            interaction.editReply(`${userDisplayName}, your guild has raided recently and must wait ${convertSecondstoMinutes(timeUntilRaidAvailableInSeconds)} before raiding again!`);
            return;
        }

        let totalMultiplier = 0;
        for (const [index, element] of raidList.entries()) {
            const userDetails = await dynamoHandler.findUser(element.id, element.username);
            totalMultiplier += userDetails.workMultiplierAmount;
        }

        // check for guild buff - multi
        if (guild.guildBuff == "raidMulti") {
            totalMultiplier *= 1.15;
        }

        const raidScenarioRoll = Math.random();
        let potatoesGained = 0;
        if (raidSelection == 'regular') {
            for (const scenario of regularRaidScenarios) {
                if (raidScenarioRoll < scenario.chance) {
                    potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction);
                    break;
                }
            }
            guildTotalEarnings += potatoesGained;
            await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
        } else if (raidSelection == 'elite') {
            for (const scenario of harderRaidScenarios) {
                if (raidScenarioRoll < scenario.chance) {
                    potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction);
                    break;
                }
            }
            guildTotalEarnings += potatoesGained;
            await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
        } else if (raidSelection == 'legendary') {
            for (const scenario of hardestRaidScenarios) {
                if (raidScenarioRoll < scenario.chance) {
                    potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction);
                    break;
                }
            }
            guildTotalEarnings += potatoesGained;
            await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
        } else if (raidSelection == 'stat') {
            for (const scenario of statRaidScenarios) {
                if (raidScenarioRoll < scenario.chance) {
                    await scenario.action(guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction);
                    break;
                }
            }
        }

        // check buff for raid timer - remove 5 minutes if true
        guild.guildBuff == "raidTimer"
            ? await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now() - 15 * 60000) // 15 minutes
            : await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now());

        await dynamoHandler.updateGuildDatabase(guildId, 'raidList', []);
    }
}