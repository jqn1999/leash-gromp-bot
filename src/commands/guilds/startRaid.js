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
        {
            name: "Scallionshade, the Shadowy Scion",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607716355706971/kawaii-smiling-leek-vegetable-cartoon-illustration-spring-onions-on-color-background-smiling-leek-vegetable-cartoon-illustration-free-vector.png?ex=661331d7&is=6600bcd7&hm=3815e4de70195853ef982e0194b758fbd0f8fab0200adc5cb126d92bfce8c099&",
            description: `Scallionshade, the Shadowy Scion, emerges from the depths of the Potato Kingdom as a mysterious figure cloaked in darkness, his form obscured by swirling shadows that dance around him like wisps of smoke. With eyes gleaming like dimly lit embers, he wields the power of shadows, commanding them to do his bidding as he seeks to envelop the realm in eternal darkness.`,
            successDescription: 'Through unwavering resolve and strategic prowess, the spud heroes manage to penetrate Scallionshade\'s veil of darkness, dispersing his shadowy form and banishing him back into the abyss from whence he came. Though defeated for now, whispers linger of his inevitable return, a reminder that the Shadowy Scion\'s darkness may yet shroud the Potato Kingdom once more.',
            failureDescription: 'Overwhelmed by Scallionshade\'s relentless onslaught and the suffocating embrace of darkness, the potato adventurers fall one by one, their spirits consumed by the shadows. As Scallionshade\'s influence spreads unchecked, the Potato Kingdom plunges into eternal night, its inhabitants forever lost in the abyss of the Shadowy Scion\'s domain.',
            credit: 'Made by Beggar'
        }
    ],
    [
        {
            name: "Garlicore, the Pungent Overlord",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607411710689280/dacedaaa-00fe-11ee-8c31-f23c938336bc-9759-0.png?ex=6613318f&is=6600bc8f&hm=da68c0239e8813f999453ac161974cbc47c4485c8e6a7c2a92b177732fb8eaee&",
            description: `Garlicore, the Pungent Overlord, rises from the depths of the Potato Kingdom as a towering figure draped in robes of garlic cloves, emanating an overpowering aroma that strikes fear into the hearts of all who dare to oppose him. With each step, his presence saturates the air with the unmistakable scent of garlic, a harbinger of his potent and pungent power.`,
            successDescription: 'Through strategic teamwork and unwavering determination, the spud heroes manage to overcome Garlicore, dispersing his pungent aura and banishing him back into the depths from whence he came. The Potato Kingdom celebrates the defeat of the Pungent Overlord, breathing a sigh of relief as the air clears of his oppressive scent.',
            failureDescription: 'Overwhelmed by Garlicore\'s relentless assault and the suffocating aroma of garlic, the potato adventurers fall one by one, their senses overwhelmed by the pungent onslaught. As Garlicore\'s influence spreads unchecked, the Potato Kingdom becomes forever tainted by the lingering scent of the Pungent Overlord, a reminder of their failure to rid the realm of his foul presence.',
            credit: 'Made by Beggar'
        }
    ]
]

const eliteRaidMobs = [
    [
        {
            name: "Scarlet Seraph, the Strawberry Sovereign",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607252868206642/cefb8ca7615585269517650efddcfe7c.png?ex=66133169&is=6600bc69&hm=9a30d618ada308ee125e11320fee4f1042e2fdd8d953295ba1104aee49508dde&",
            description: `Scarlet Seraph, the Strawberry Sovereign, stands as a majestic figure, draped in robes the color of ripe strawberries and crowned with a halo of strawberry leaves. With wings of crimson and a regal demeanor, this celestial being commands the essence of strawberries, exuding an aura of fruity power and majesty.`,
            successDescription: 'Through unwavering courage and strategic prowess, the spud heroes manage to weaken Scarlet Seraph, the Strawberry Sovereign, forcing it to retreat into the celestial realm. Though temporarily defeated, whispers linger of its inevitable return, reminding all that the Strawberry Sovereign may rise again to reign over the Potato Kingdom.',
            failureDescription: 'Overwhelmed by Scarlet Seraph\'s formidable powers and celestial aura, the potato adventurers fall one by one, their efforts futile against the Strawberry Sovereign\'s might. As Scarlet Seraph retreats to the celestial realm, the Potato Kingdom remains under the shadow of its impending return, its inhabitants living in fear of the Strawberry Sovereign\'s inevitable resurgence.',
            credit: 'Made by Beggar'
        }
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
        {
            name: "Bitterblade, the Brutal Blight-bringer",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607142352621680/main-qimg-24a1dffefd5f8458caf079ad72ef15d4-lq.png?ex=6613314f&is=6600bc4f&hm=ede01984f3d4b0bafe8ea2790adfe83f4e7e01613b306d96ad7d2d24f4b3dcae&",
            description: `Bitterblade, the Brutal Blight-bringer, stands as a menacing figure clad in armor forged from the darkest of bitter melon rinds. His blade, honed to perfection, exudes an aura of malevolence as he seeks to spread decay and despair throughout the Potato Kingdom, his every strike heralding the onset of blight.`,
            successDescription: 'Through unwavering determination and strategic cunning, the spud heroes manage to overcome Bitterblade, temporarily driving him back into the depths from whence he came. Yet, whispers persist of his inevitable return, a constant reminder that the Brutal Blight-bringer\'s reign may yet resume, casting a shadow over the realm\'s future.',
            failureDescription: 'Overwhelmed by Bitterblade\'s relentless assault and dark magic, the potato adventurers fall one by one, their hopes dashed against the unyielding might of the Blight-bringer. As Bitterblade\'s influence spreads unchecked, the Potato Kingdom descends further into darkness, its inhabitants left to lament the failure to stem the tide of blight and despair.',
            credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
        }
    ]
]

const legendaryRaidMobs = [
    [
        {
            name: "Gourdor, the Pumpkin Knight",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221606969618600018/dgbnu01-7f36e865-7ecd-490b-885a-0400daa36655.png?ex=66133125&is=6600bc25&hm=72d0d36cfed52d777e96c65e91b5e5b364de42b8bb67490c8caaabf0639b0b01&",
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
        {
            name: "Radishreaper, the Reaper of Roots",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221606879978061854/illustration-of-evil-radish-mascot-character-free-vector.png?ex=66133110&is=6600bc10&hm=804ab41db2a44b15fdd46b98ab75da68f1edc152829bfeaa4a04e508da3e5d96&",
            description: `Radishreaper, the Reaper of Roots, emerges from the depths of the Potato Kingdom as a sinister figure draped in tattered robes adorned with gnarled radish roots. His presence instills fear as he wields a scythe crafted from the toughest radish stems, harvesting souls with every swing.`,
            successDescription: 'With steadfast resolve, the spud heroes manage to banish Radishreaper, dispersing his spectral form for now and freeing the Potato Kingdom from immediate peril. However, whispers persist that his dark presence may one day return, lurking in the depths of the earth, biding its time for another harvest.',
            failureDescription: 'Overwhelmed by Radishreaper\'s relentless onslaught and spectral minions, the potato adventurers fall one by one, their souls harvested by the Reaper of Roots. Despite their efforts, Radishreaper\'s power remains unchecked, and his return is foretold, casting a shadow of uncertainty over the Potato Kingdom\'s future.',
            credit: 'Made by Beggar'
        }
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
            const hardRaidMob = chooseMobFromList(regularRaidMobs[2]);
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
            const mediumRaidMob = chooseMobFromList(regularRaidMobs[1]);
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
            const regularRaidMob = chooseMobFromList(regularRaidMobs[0]);
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
            const hardRaidMob = chooseMobFromList(eliteRaidMobs[2]);
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
            const mediumRaidMob = chooseMobFromList(eliteRaidMobs[1]);
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
            const regularRaidMob = chooseMobFromList(eliteRaidMobs[0]);
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
            const hardRaidMob = chooseMobFromList(legendaryRaidMobs[2]);
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
            const mediumRaidMob = chooseMobFromList(legendaryRaidMobs[1]);
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
            const regularRaidMob = chooseMobFromList(legendaryRaidMobs[0]);
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

        const timeUntilRaidAvailableInMS = guild.raidTimer - Date.now()
        if (timeUntilRaidAvailableInMS > 0) {
            interaction.editReply(`${userDisplayName}, your guild has raided recently and must wait ${convertSecondstoMinutes(Math.floor(timeUntilRaidAvailableInMS/1000))} before raiding again!`);
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

        guild.guildBuff == "raidTimer"
            ? await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now() + Raid.RAID_TIMER_SECONDS * 1000 - (Raid.RAID_TIMER_SECONDS * 1000 * .10))
            : await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now() + Raid.RAID_TIMER_SECONDS * 1000);

        await dynamoHandler.updateGuildDatabase(guildId, 'raidList', []);
    }
}