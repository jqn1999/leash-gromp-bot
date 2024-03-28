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
            description: `Scallionshade, the Shadowy Scion, haunts a once peaceful village located in the Potato Kingdom's outskirts. Answering the call of the village's fearful residents, the kingdom's heroes venture out to liberate it from his shadowy grasp. Their arrival triggers the emergence of the scion himself: a mysterious figure obscured by shadows that dance around him like wisps of smoke.`,
            successDescription: 'The potato adventurers beat back Scallionshade\'s dark forces and neutralize his shadowy minions. His influence begins to wane, and the dark veil that the scion once cast is lifted from the village. As their weakened foe recoils in the sunlight, the party lands a decisive blow that sends Scallionshade back into the obscurity of the beyond.',
            failureDescription: 'Try as they might, the potato adventurers are ultimately suffocated by Scallionshade\'s darkness. The heroes\' and villagers\' souls alike succumb to the embrace of his shadows, and his veil of darkness begins to spread further beyond the walls of the wailing village.',
            credit: 'Made by Beggar'
        }
    ],
    [
        {
            name: "Garlicore, the Pungent Pilferer",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607411710689280/dacedaaa-00fe-11ee-8c31-f23c938336bc-9759-0.png?ex=6613318f&is=6600bc8f&hm=da68c0239e8813f999453ac161974cbc47c4485c8e6a7c2a92b177732fb8eaee&",
            description: `The economic equilibrium of the potato kingdom is threatened by Garlicore, a bulbous vegetable thief known throughout the criminal underworld. Making a name for himself as the “Pungent Pilferer,” Garlicore exercises his overpowering fragrance to incapacitate his opposition. Not particularly skilled in combat himself, he relies on hired hands to ensure his dark dealings continue unimpeded.`,
            successDescription: 'The potato adventurers infiltrate Garlicore\'s hideout, leading to a scuffle with his stenchy henchmen. Realizing his subordinates are no match for the heroes, he begins to flee. However, with speedy precision, the party braves the Pungent Pilferer\'s stench, apprehending him and delivering him to justice.',
            failureDescription: 'The potato adventurers\' infiltration mission takes an unfortunate turn when they\'re discovered and captured by Garlicore\'s underlings. The boss himself emerges from his lair, saturating the air with his unmistakable scent. The party\'s consciousness begins to fade, and it\'s only after they awaken that they realize their belongings have been pilfered by their putrid foe.',
            credit: 'Made by Beggar'
        }
    ]
]

const eliteRaidMobs = [
    [
        {
            name: "Scarlet, the Strawberry Seraph",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607252868206642/cefb8ca7615585269517650efddcfe7c.png?ex=66133169&is=6600bc69&hm=9a30d618ada308ee125e11320fee4f1042e2fdd8d953295ba1104aee49508dde&",
            description: `The majestic Strawberry Seraph, Scarlet, is said to exist within the vegetable realm to answer for the wrongdoings of the Sinister Strawberries. Though not an enemy of the kingdom, she offers adventurers the opportunity to test themselves against her. Sporting a regal attitude, potent fruity magic, and wings of crimson, this celestial being offers a considerable reward to those who can best her in combat.`,
            successDescription: 'The adventurers\' coordination allows them to halt Scarlet\'s flight with a staggering blow. They ward off her spells and subdue the Strawberry Seraph, leaving her no choice but to begrudgingly surrender. As the party boasts of their decisive victory, Scarlet contends that they simply got lucky this time around.',
            failureDescription: 'The Strawberry Seraph\'s agility and magic prove too overbearing for the party to manage. They suffer a rather embarrassing defeat in front of the other adventurers, and Scarlet jeers that heroes these days must be getting too soft.',
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
            name: "Evertart, the Blighted Bitterblade",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607142352621680/main-qimg-24a1dffefd5f8458caf079ad72ef15d4-lq.png?ex=6613314f&is=6600bc4f&hm=ede01984f3d4b0bafe8ea2790adfe83f4e7e01613b306d96ad7d2d24f4b3dcae&",
            description: `Travelers rumor of a ruthless fruit fully clad in a tough, bitter melon rind armor. They say he bears a gnarly blade exuding an aura of overwhelming malice, and his arrival heralds blight and decay. To assuage the growing grief of the kingdom's residents, the adventurers set out to put an end to this enigmatic figure's streak of woe.`,
            successDescription: 'Tracking him by his wake of corruption, the party comes face-to-face with Evertart, the Bitterblade. The heroes cut past his accursed blade and deliver a seemingly-fatal stab through his sordid figure, only for it to vanish into the air. Though he was surely vanquished, faint whispers persist of the wraithlike Bitterblade\'s supposed return…',
            failureDescription: 'Tracking him by his wake of corruption, the party comes face-to-face with Evertart, the Bitterblade. They\'re stunned by the malicious enchantments echoing from his blade, and are brutally beaten by an onslaught of steel and spellcraft. As the heroes lie broken in his wake, Evertart continues to wreak blight and havoc throughout the realm.',
            credit: 'Made by Beggar'
        }
    ]
]

const legendaryRaidMobs = [
    [
        {
            name: "Gourdor, the Pumpkin Knight",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221606969618600018/dgbnu01-7f36e865-7ecd-490b-885a-0400daa36655.png?ex=66133125&is=6600bc25&hm=72d0d36cfed52d777e96c65e91b5e5b364de42b8bb67490c8caaabf0639b0b01&",
            description: `The Pumpkin Knight Gourdor was once a celebrated hero and champion of a neighboring kingdom's army. This once noble figure has been resurrected by evil energies, and he now gallops throughout the realm as a malevolent entity draped in twisted pumpkin vines. Brandishing a twisted, sinister blade forged from the darkest gourd, he seeks to sow chaos with his wicked powers.`,
            successDescription: 'The potato adventurers brave Gourdor\'s swarm of minions and madness, facing off against the Pumpkin Knight himself. Outclassed in one-on-one combat, the party relies on their numbers to triumph over the once proud knight. Though his weary soul may momentarily rest, the wicked powers that reanimated Gourdor still persist beyond the far reaches of the realm…',
            failureDescription: 'The party cannot hope to match Gourdor\'s fiendish powers, nor his martial prowess. They\'re swarmed by his malevolent munchkin pumpkins, allowing him to reap their souls with little effort. After humiliating the Potato Kingdom\'s finest, Gourdor continues to propagate discord throughout the realm unabated.',
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
            name: "Radishrend, the Root Reaper",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221606879978061854/illustration-of-evil-radish-mascot-character-free-vector.png?ex=66133110&is=6600bc10&hm=804ab41db2a44b15fdd46b98ab75da68f1edc152829bfeaa4a04e508da3e5d96&",
            description: `A physical personification of death itself, Radishrend is a primal force of evil. Like other great dangers to the kingdom, the Root Reaper's wicked powers are likely fueled by the Spud Entity. Yet his heinous tragedies precede even the void's emergence, and he needs no excuse to spread suffering with the swing of his radish-stemmed scythe.`,
            successDescription: 'As the Root Reaper\'s ghostly visage materializes before the potato adventurers, they steel their resolve for the ultimate showdown. Valiantly safeguarding their beloved kingdom, the party casts Radishrend away with their strongest weapons and most potent magic. Though momentarily vanquished, the reaper subsides into the beyond in preparation for yet another harvest of souls.',
            failureDescription: 'As the Root Reaper\'s ghostly visage materializes before the potato adventurers, they steel their resolve for the ultimate showdown. His hordes of undead vegetables overwhelm the heroes, and not even their finest fighters can find an opening in Radishrend\'s front. With his opposition occupied, the reaper continues unimpeded, harvesting soul after soul from the once peaceful kingdom.',
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
            interaction.editReply(`${userDisplayName}, your guild has raided recently and must wait ${convertSecondstoMinutes(Math.floor(timeUntilRaidAvailableInMS / 1000))} before raiding again!`);
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