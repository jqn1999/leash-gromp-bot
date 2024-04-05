require("dotenv").config();

const Work = {
    PERCENT_OF_TOTAL: .002,
    WORK_TIMER_SECONDS: 300,
    MAX_BASE_WORK_GAIN: 1000,
    MAX_LARGE_POTATO: 10000,
    MAX_METAL_POTATO: 100000,
    MAX_POISON_POTATO: 10000,
    MAX_GOLDEN_POTATO: 500000,
    POISON_POTATO_TIMER_INCREASE_SECONDS: 3600
}

const Bet = {
    PERCENT_OF_SERVER_TOTAL_TO_BASE: .025
}

const Bank = {
    TAX_BASE: 1000,
    TAX_PERCENT: .05,
    GUILD_TAX_BASE: 5000,
    GUILD_TAX_PERCENT: .05
}

const Rob = {
    WORK_TIMER_INCREASE_MS: 6900000,
    ROB_TIMER_SECONDS: 3600,
    BASE_ROB_PENALTY: 5000
}

const Raid = {
    REGULAR_MAXIMUM_RAID_SUCCESS_RATE: .9,
    ELITE_MAXIMUM_RAID_SUCCESS_RATE: .75,
    LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE: .6,
    MAXIMUM_STAT_RAID_SUCCESS_RATE: .5,
    RAID_TIMER_SECONDS: 3600,

    T1_RAID_REWARD: 100000,
    T1_RAID_PENALTY: -100000,
    T1_RAID_DIFFICULTY: 25,

    T2_RAID_REWARD: 500000,
    T2_RAID_PENALTY: -500000,
    T2_RAID_DIFFICULTY: 60,

    T3_RAID_REWARD: 5000000,
    T3_RAID_PENALTY: -5000000,
    T3_RAID_DIFFICULTY: 150,

    METAL_KING_REWARD: 10000000,
    METAL_KING_MULTIPLIER_REWARD: 2.0,
    METAL_KING_PASSIVE_REWARD: 1000000,
    METAL_KING_CAPACITY_REWARD: 10000000,
    METAL_KING_PENALTY: 0,
    METAL_KING_DIFFICULTY: 500,

    REGULAR_STAT_RAID_REWARD: 0.2,
    REGULAR_STAT_RAID_COST: -300000,
    REGULAR_STAT_RAID_DIFFICULTY: 250
}

const GuildRoles = {
    LEADER: "Leader",
    COLEADER: "Co-Leader",
    ELDER: "Elder",
    MEMBER: "Member"
}

const metalKingRaidBoss = {
    name: "Metal King Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198661965015416842/latest.png?ex=65c8f272&is=65b67d72&hm=05a83ee3e8a39e6a0f3b8904e127f6655aeafcf239562d5ce484cd9ec42cd789&",
    description: `You had an extremely lucky encounter with the Metal King Potato! It\'s said that this silvery sovereign, an amalgamation of eight Metal Potatoes, presides over them all. Like its subjects, the King boasts impenetrable defence and its signature evasion. With the addition of advanced magic to its arsenal, this regal rival offers your party an unusual challenge.`,
    successDescription: 'The potato adventurers struggle in a race against the clock, praying they can discover a weakness in the King\'s preposterous defence and dispel it before it can escape. A desperate gambit on an all-or-nothing attack catches the fleeting foe off guard, and it suffers a critical blow in its stupor! Thanks to their decisive maneuver, the adventurers earn astronomical augments to each of their stats!',
    failureDescription: 'The potato adventurers struggle in a race against the clock, praying they can discover a weakness in the King\'s preposterous defence and dispel it before it can escape. However, following a disorienting explosion spell, our heroes come to the sad realization that their slippery assailant is nowhere to be found...',
    credit: 'Inspired by RednaxeIa'
}

const regularStatRaidMobs = [
    {
        name: "Grimtater, the Ghostly Potato Monarch",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1203364521540853911/1206781637254455327/spudspecter.png?ex=65dd41fb&is=65caccfb&hm=a79ff5b02170d5690a8c2634a56fdf84be15293c60df86558596325b446d3b46&",
        description: `Once the ruler of a distant, long-forgotten Potato Kingdom, Grimtater conquered the afterlife through a pact with the Spud Entity. Mindlessly serving its dark master, this spectral scion materializes in the living world cloaked in ethereal potato skins and wreathed in wisps of ghostly vapors. Now without a will of its own, the ghastly monarch commands the essence of the afterlife against the peaceful Potato Kingdom.`,
        successDescription: 'The spud heroes vanquish Grimtater with courage and cunning, dispersing its ghostly visage and freeing their realm from its haunting grasp. The spectral monarch\'s threat of ethereal terror over the living wanes, and it returns to the beyond to gather its strength once more...',
        failureDescription: 'The Potato Kingdom is enveloped by the chilling embrace of Grimtater\'s otherworldly powers. With the heroes\' efforts having been thwarted, many of the kingdom\'s inhabitants fade into an abyss of shadows. As they plunge deeper into the malevolent void, the line between the living and the dead begins to blur...',
        credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
    },
    {
        name: "Shiitakethane, the Fungal Tyrant",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1203364521540853911/1208436318984601670/muchroom.png?ex=65e34706&is=65d0d206&hm=5a67d856537f6d4323d81b954fbe81fe98486b9e4d641310a5de2712af320590&",
        description: `From the swampy wetlands emerges Shiitakethane, the Fungal Tyrant. This towering mushroom sovereign is adorned with spores and mycelial tendrils that writhe with eerie sentience. It heralds a reign of fungal dominance that threatens the peace of the Potato Kingdom and the wider vegetable realm.`,
        successDescription: 'The potato adventurers demonstrate stalwart resolve and strategic prowess, driving back the Fungal Tyrant\'s twisted advances. As Shiitakethane is repelled, its fungal dominion wanes and harmony returns to the vegetable realm.',
        failureDescription: 'The potato adventurers are overwhelmed by a relentless onslaught of toxic spores, fungal minions, and writhing tendrils. The party is left with no choice but to submit to the Fungal Tyrant and watch as Shiitakethane\'s cruel dominion spreads further throughout the realm.',
        credit: 'Inspired by Moonwave'
    }
]

const regularWorkMobs = [
    {
        name: "Baby Broccoli",
        thumbnailUrl: "https://banner2.cleanpng.com/20231112/oze/transparent-vegetable-cartoon-cartoon-broccoli-head-with-single-eyeball-kawaii6550d690299e20.5817524016997966241705.jpg",
        description: `You happen upon a rather cute vegetable and bring yourself to slay it. You gain some potatoes as a reward, but people seem to look at you a bit differently now...`
    },
    {
        name: "Cruel Carrot",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196674754199949312/image.png?ex=65b87d36&is=65a60836&hm=3d3c266d540733a97911817a7fd46ee349d5987fb08b54d829edd98b509e1711&",
        description: `You encounter a Cruel Carrot, a malevolent vegetable whose orange hues conceal a fierce determination. Bravely beating it in battle, you earn a bountiful harvest of potatoes as a reward!`
    },
    {
        name: "Blasphemous Bitter Melon",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196815721909452810/image.png?ex=65b9007f&is=65a68b7f&hm=8ace537de38b4a6878160e82a71467a8d18a7007f7fd4543f9d1579595175d16&",
        description: `You come across a Blasphemous Bitter Melon, which are common criminals known for their bitter deeds. After a swift battle, you bring the bitter baddie to justice and earn a generous reward of potatoes!`,
        credit: `Inspired by Saeriel`
    },
    {
        name: "Egregious Eggplant",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196832421270798549/image.png?ex=65b9100d&is=65a69b0d&hm=4002206f8b697b426c2bfb31b894bb8ee6f14526ed78b0d7b014b44b4355543f&",
        description: `You encounter an Egregious Eggplant, a notoriously dark creature known for terrorizing the innocent. Hastily putting an end to its schemes, you claim a considerable reward of potatoes!`,
        credit: `Inspired by Sinfonia`
    },
    {
        name: "Sinister Strawberry",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196837035235881020/image.png?ex=65b91459&is=65a69f59&hm=dd107d74060982694b4d7a9be2509717a8680caa3c8a515263fa938cadb7d7b8&",
        description: `You’re startled by a Sinister Strawberry, whose crimson exterior pulsates with dark energy. You take down your nefarious foe and are rewarded with a plentiful harvest of potatoes!`
    },
    {
        name: "Raging Radish",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838130590961754/image.png?ex=65b9155e&is=65a6a05e&hm=29e67c5a4e3405bc36783b1688334a1bad8ac906fd755afe3487bdf339b9f5a1&",
        description: `You stumble upon a Raging Radish, a creature known for its fiery temperament and fierce determination. After beating back the furious root vegetable, you claim a hearty bag of potatoes!`
    },
    {
        name: "Treacherous Tomato",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838369779527701/image.png?ex=65b91597&is=65a6a097&hm=1413759e4e446646cda9a44b21fe1df99247975454ab787c496f4cf3aff19a48&",
        description: `You face a Treacherous Tomato, whose ripe red skin belies its deceitfulness. Outwitting its cunning tactics, you claim victory and a generous harvest of potatoes as a reward!`
    },
    {
        name: "Menacing Mango",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838574188924928/image.png?ex=65b915c8&is=65a6a0c8&hm=8488d83d107d86c56839abbb5ae0656103f26e036e6b923016baaa19b635ddfe&",
        description: `You encounter a Menacing Mango, whose glistening skin radiates with malice. Summoning your courage, you vanquish your malevolent foe and claim a bountiful harvest of potatoes!`
    },
    {
        name: "Cowardly Cantaloupe",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196839012434980864/image.png?ex=65b91630&is=65a6a130&hm=e9f83f932c02e936de5ac6772659fe570d8f1140f3e6289a162360b9816f4475&",
        description: `You stumble upon a Cowardly Cantaloupe, its pale rind trembling with fear. Despite its attempts to flee, you give chase and break it apart without remorse. As it yields, you claim a fair share of potatoes!`,
        credit: `Inspired by Sinfonia`
    }
]

const largePotato = {
    name: "Large Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196675140117868695/image.png?ex=65b87d92&is=65a60892&hm=fe8d9d61369d404e19ca9aa07d337b0e62ec964c6dd99c0ed6f9ff98dde5a73f&",
    description: `You come across an irresistibly cute Large Potato, its round form and endearing eyes tugging at your heartstrings. Despite its adorable nature, the allure of potatoes is too powerful to resist. With a heavy heart, you slay the Large Potato, its sacrifice granting you a bountiful harvest of potatoes.`
}

const sweetPotato = {
    name: "Sweet Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196681406164770836/image.png?ex=65b88368&is=65a60e68&hm=0eac1e59888d567736222ece1106e06474cb9b8ac3a6b349aa7ce567033c83ac&",
    description: `You encounter a lovely Sweet Potato and are subsequently charmed by its evident sincerity. A heartwarming exchange ensues, and it convinces you to spare its life. In return, the Sweet Potato augments one of your stats as a show of gratitude. Check your profile to see the benefits of this heartwarming interaction!`
}

const taroTrader = {
    name: "Taro Trader",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1208137579002597456/pngtree-taro-hand-drawn-illustration-png-image_8343874.png?ex=65e230cc&is=65cfbbcc&hm=66bad9c30f1671640fdf9adc7a37698381cbf694bd71c092b1960b52a589637d&",
    description: `You encounter a wandering Taro Trader and receive a convincing starch market pitch. Feeling overwhelmed by the nomadic merchant's proposal, you accept his gesture of goodwill: a small sample of starches. With a clever strategy, this generous gift could become a lucrative trade in the future!`
}

const poisonPotato = {
    name: "Poisonous Potato",
    thumbnailUrl: "https://static.wikia.nocookie.net/minecraft_gamepedia/images/c/c0/Poisonous_Potato_JE3_BE2.png/revision/latest?cb=20200521233152",
    description: `OH NO! While wandering around, you’re met with a Poisonous Potato and come down with a terrible illness. You pay a hefty sum of potatoes for medicinal herbs and are left with no choice but to take a long break from working as you recuperate!`,
    credit: `Inspired by Saeriel`
}

const goldenPotato = {
    name: "Golden Potato",
    thumbnailUrl: "https://ih0.redbubble.net/image.4402449953.5486/raf,360x360,075,t,fafafa:ca443f4786.jpg",
    description: `Congratulations! You encountered a Golden Potato, one of a select few mythical tubers who reward keen adventurers with considerable riches. As you covet the bounty granted by the benevolent tuber, it vanishes, returning to the magical garden it once grew from.`
}

const metalPotatoSuccess = {
    name: "Metal Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196999133697953802/image.png?ex=65b9ab50&is=65a73650&hm=5bcd001cd5ab30d2e03bc09137a1df25109399326484ccc1bdea87fc7427a443&",
    description: `You had a lucky encounter with a Metal Potato! Thanks to its extraordinary speed and aggravating defences, none of your attacks seem to affect it. Frustrated beyond your wit\'s end, you launch a careless attack that critically strikes the slippery spud! Left in disbelief, you earn a deceptively large stimulus of potatoes and a significant increase to each of your stats!`,
    credit: `Inspired by Rednaxeia`
}

const metalPotatoFailure = {
    name: "Metal Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196999133697953802/image.png?ex=65b9ab50&is=65a73650&hm=5bcd001cd5ab30d2e03bc09137a1df25109399326484ccc1bdea87fc7427a443&",
    description: `You had a lucky encounter with a Metal Potato! Thanks to its extraordinary speed and aggravating defences, none of your attacks seem to affect it. Thoroughly content with its confounding routine, the Metal Potato casually hops away. You\'re left winded and confused, yet excited for the chance to find another.`,
    credit: `Inspired by Rednaxeia`
}

const shops = [
    {
        shopId: "workShop",
        description: "This is where you buy tools and gear to improve work yield",
        items: [
            {
                currentAmount: 1,
                amount: 1.5,
                cost: 50000,
                description: "A humble set of gear for beginners intended to facilitate the hunting process.",
                id: 1,
                name: "Novice Spud Seeker Set",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 1.5,
                amount: 3,
                cost: 200000,
                description: "A respectable set of gear that's vital for those pursuing a career in potato hunting.",
                id: 2,
                name: "Potato Pursuer Kit",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 3,
                amount: 5,
                cost: 1000000,
                description: "An intermediate set of accessories fit for a seasoned adventurer in the Potato Kingdom.",
                id: 3,
                name: "Spud Striker Gear",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 5,
                amount: 10,
                cost: 5000000,
                description: "Cutting-edge equipment that lends itself well to defending the Potato Kingdom against nefarious vegetables.",
                id: 4,
                name: "Starch Stalker's Ensemble",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 10,
                amount: 15,
                cost: 20000000,
                description: "This advanced arsenal provides heroes with the means to safeguard their kingdom in the face of the most vicious foes.",
                id: 5,
                name: "Veteran's Spud-Seeking Arsenal",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 15,
                amount: 20,
                cost: 50000000,
                description: "An elite array of imposing weapons that can fell the toughest of enemies with ease.",
                id: 6,
                name: "Special-Grade Spud Slaying Gear",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 20,
                amount: 25,
                cost: 75000000,
                description: "Ceremonious garments and gadgets said to have played a vital role in triumphing over an insurmountable force long ago.",
                id: 7,
                name: "Supreme Spud Gladiator's Garments",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 25,
                amount: 30,
                cost: 100000000,
                description: "A brilliant weapon, and one bearing a striking resemblance to those wielded by the first kings of the Potato Realm in the war to consolidate influence over their subjects.",
                id: 8,
                name: "Legendary Leader's Blade",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 30,
                amount: 50,
                cost: 500000000,
                description: "A glistening implement echoing with the success of its forebears, this tool is said to usher an age of good fortune for those blessed with the privilege of wielding it.",
                id: 9,
                name: "Divine Instrument of Potato Blessings",
                type: "workMultiplierAmount"
            },
            {
                currentAmount: 50,
                amount: 100,
                cost: 1500000000,
                description: "This assortment of otherworldly equipment exudes unimaginable ferocity, striking fear into the hearts of friends and foes alike in the Potato Kingdom.",
                id: 10,
                name: "Alien Armaments of Tuber Termination",
                type: "workMultiplierAmount"
            }
        ],
        title: "Work Tools Shop (multiplier for work)"
    },
    {
        shopId: "passiveIncomeShop",
        description: "This is where you buy workers to improve passive yield",
        items: [
            {
                currentAmount: 0,
                amount: 50000,
                cost: 50000,
                description: "An apprentice that helps gather some additional potatoes each day",
                id: 1,
                name: "Seedling Sprout Apprentice",
                type: "passiveAmount"
            },
            {
                currentAmount: 50000,
                amount: 100000,
                cost: 200000,
                description: "A rag-tag crew of volunteers led by your apprentice and generously harvesting potatoes on your behalf",
                id: 2,
                name: "Harvest-Helping Crew",
                type: "passiveAmount"
            },
            {
                currentAmount: 100000,
                amount: 180000,
                cost: 1000000,
                description: "A proficient squad of musicians whose magical melodies can accelerate potato cultivations",
                id: 3,
                name: "Spud Symphony Troop",
                type: "passiveAmount"
            },
            {
                currentAmount: 180000,
                amount: 500000,
                cost: 5000000,
                description: "A skilled squad of trained professionals in the art of potato cultivationn",
                id: 4,
                name: "Spud Team Six",
                type: "passiveAmount"
            },
            {
                currentAmount: 500000,
                amount: 1000000,
                cost: 20000000,
                description: "A regiment armed with cutting-edge techniques and skilled in sustainable practices, these growers leverage eco-friendly methods to ensure a lush harvest every day",
                id: 5,
                name: "Verdant Vanguard Growers",
                type: "passiveAmount"
            },
            {
                currentAmount: 1000000,
                amount: 3000000,
                cost: 50000000,
                description: "A top-class group of agricultural virtuosos that seamlessly combines whimsical ballads and precise cultivation techniques, creating a harmonious environment for potato growth",
                id: 6,
                name: "Harvest Harmony Elite",
                type: "passiveAmount"
            },
            {
                currentAmount: 3000000,
                amount: 7000000,
                cost: 75000000,
                description: "An integrated network of potato scientists, farmers, and distributors capable of supporting the global potato economy with their robust supply chain",
                id: 7,
                name: "Cultivation Conglomerate",
                type: "passiveAmount"
            },
            {
                currentAmount: 7000000,
                amount: 14000000,
                cost: 100000000,
                description: "Led by your once apprentice turned genius investor, this fund employs complex starch trading and hedging strategies to generate exceptional returns each day",
                id: 8,
                name: "Potato Wedge Fund",
                type: "passiveAmount"
            },
            {
                currentAmount: 14000000,
                amount: 27000000,
                cost: 250000000,
                description: "A permit granting you access to climb the Giant Potato\'s towering beanstalk, atop which grows a garden of golden potatoes",
                id: 9,
                name: "Admittance of Avarice",
                type: "passiveAmount"
            },
            {
                currentAmount: 27000000,
                amount: 60000000,
                cost: 500000000,
                description: "The ultimate symbol of wealth and power, this circlet heralds your unparalleled status as a monarch and the untold riches that accompany such a title",
                id: 10,
                name: "Potato King\'s Crown",
                type: "passiveAmount"
            }
        ],
        title: "Passive Income Workers Shop (amount per day)"
    },
    {
        shopId: "bankShop",
        description: "This is where you upgrade your bank to protect your potatoes from would-be robbers",
        items: [
            {
                currentAmount: 0,
                amount: 100000,
                cost: 50000,
                description: "A basic pouch fit for holding spuds safely",
                id: 1,
                name: "Spud Saver's Sack",
                type: "bankCapacity"
            },
            {
                currentAmount: 100000,
                amount: 500000,
                cost: 200000,
                description: "A rather secure holding for a more conscious potato collector",
                id: 2,
                name: "Savvy Saving Bank",
                type: "bankCapacity"
            },
            {
                currentAmount: 500000,
                amount: 2500000,
                cost: 1000000,
                description: "An underground vault built specifically to guard mountains of potatoes",
                id: 3,
                name: "Supreme Spud Vault",
                type: "bankCapacity"
            },
            {
                currentAmount: 2500000,
                amount: 10000000,
                cost: 5000000,
                description: "A colossal storage facility designed for the big dreamers of the potato farming world",
                id: 4,
                name: "Prodigious Potato Preservation",
                type: "bankCapacity"
            },
            {
                currentAmount: 10000000,
                amount: 25000000,
                cost: 20000000,
                description: "A prestigious storage solution for the truly distinguished potato farmer, offering a blend of elegance and functionality",
                id: 5,
                name: "Royal Russet Reserve",
                type: "bankCapacity"
            },
            {
                currentAmount: 25000000,
                amount: 50000000,
                cost: 50000000,
                description: "An archaic reserve of potato knowledge and preservation, equipped with magical reservoirs of extraordinary capacity",
                id: 6,
                name: "Ancient Spud Library",
                type: "bankCapacity"
            }
        ],
        title: "Potato Storage Shop (increase bank capacity)"
    },
    {
        shopId: "starchShop",
        description: "This is where you upgrade your max starches to continue on your investing journey",
        items: [
            {
                currentAmount: 25000,
                amount: 50000,
                cost: 125000000,
                description: "Better than nothin",
                id: 1,
                name: "Robinhood",
                type: "maxStarches"
            },
            {
                currentAmount: 50000,
                amount: 75000,
                cost: 187500000,
                description: "Slightly better than Robinhood... slightly",
                id: 2,
                name: "Ally Invest",
                type: "maxStarches"
            },
            {
                currentAmount: 75000,
                amount: 100000,
                cost: 250000000,
                description: "Trusted by many retail investors for their investment needs",
                id: 3,
                name: "Fidelity",
                type: "maxStarches"
            },
            {
                currentAmount: 100000,
                amount: 150000,
                cost: 500000000,
                description: "A good firm for holding large amounts of starches",
                id: 4,
                name: "Charles Schwab",
                type: "maxStarches"
            },
            {
                currentAmount: 150000,
                amount: 200000,
                cost: 750000000,
                description: "The best investment firm for holding your large stash of starches",
                id: 5,
                name: "Vanguard",
                type: "maxStarches"
            }
        ],
        title: "Starch Storage Shop (increase max starches)"
    }
]

const awsConfigurations = {
    aws_table_name: 'leash-gromp-bot-restored',
    aws_birthday_table_name: 'leash-gromp-bot-birthdays',
    aws_betting_table_name: 'leash-gromp-bot-betting',
    aws_stats_table_name: 'leash-gromp-stats',
    aws_shop_table_name: 'leash-gromp-bot-shop',
    aws_guilds_table_name: 'leash-gromp-bot-guilds',
    aws_local_config: {
        //Provide details for local configuration
    },
    aws_remote_config: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_ID,
        region: process.env.AWS_REGION,
    },
    testServer: "168379467931058176",
    clientId: "1187560268172116029",
    devs: ["103243257240121344"]
}

module.exports = {
    shops,
    awsConfigurations,
    Work,
    Bet,
    Bank,
    Rob,
    GuildRoles,
    Raid,
    metalKingRaidBoss,
    metalPotatoSuccess,
    metalPotatoFailure,
    regularStatRaidMobs,
    regularWorkMobs,
    largePotato,
    sweetPotato,
    taroTrader,
    poisonPotato,
    goldenPotato,
}