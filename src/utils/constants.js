require("dotenv").config();

const Work = {
    PERCENT_OF_TOTAL: .002,
    WORK_TIMER_SECONDS: 300,
    MAX_BASE_WORK_GAIN: 1000,
    MAX_LARGE_POTATO: 10000,
    MAX_METAL_POTATO: 100000,
    MAX_POISON_POTATO: 10000,
    MAX_GOLDEN_POTATO: 500000,
    POISON_POTATO_TIMER_INCREASE_MS: 3300000
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
    MAXIMUM_RAID_SUCCESS_RATE: .9,
    MAXIMUM_STAT_RAID_SUCCESS_RATE: .45,
    RAID_TIMER_SECONDS: 3600,

    REGULAR_RAID_REWARD: 100000,
    REGULAR_RAID_PENALTY: -100000,
    REGULAR_RAID_DIFFICULTY: 25,

    MEDIUM_RAID_REWARD: 500000,
    MEDIUM_RAID_PENALTY: -500000,
    MEDIUM_RAID_DIFFICULTY: 60,

    HARD_RAID_REWARD: 5000000,
    HARD_RAID_PENALTY: -2000000,
    HARD_RAID_DIFFICULTY: 150,

    LEGENDARY_RAID_REWARD: 10000000,
    LEGENDARY_RAID_MULTIPLIER_REWARD: 1.0,
    LEGENDARY_RAID_PASSIVE_REWARD: 1000000,
    LEGENDARY_RAID_CAPACITY_REWARD: 10000000,
    LEGENDARY_RAID_PENALTY: 0,
    LEGENDARY_RAID_DIFFICULTY: 500,

    REGULAR_STAT_RAID_REWARD: 0.2,
    REGULAR_STAT_RAID_COST: -200000,
    REGULAR_STAT_RAID_DIFFICULTY: 250
}

const GuildRoles = {
    LEADER: "Leader",
    COLEADER: "Co-Leader",
    ELDER: "Elder",
    MEMBER: "Member"
}

const regularRaidMobs = [
    {
        name: "Celerity, the Swift Stalk",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `Deep within the verdant forests of the Potato Realm, adventurers encounter Celerity, the Swift Stalk, a celery stick infused with the essence of unparalleled speed. In this high-paced raid, players must navigate through a maze of rapidly growing vines and swiftly dodging the Stalk's lightning-fast attacks, testing their agility and coordination to claim victory over this fleet-footed foe.`,
        successDescription: 'With synchronized precision, the brave warriors strategically severs Celerity\'s roots, halting its lightning-speed assaults and claiming triumph over the Swift Stalk.',
        failureDescription: 'Overwhelmed by the relentless barrage of swift strikes, the adventurers succumb to Celerity\'s lightning-fast onslaught, leaving the forest engulfed in the echoes of their unsuccessful struggle.',
        credit: 'Inspired by Moonwave'
    },
    {
        name: "Baron Durianwrath, the Aromatic Abomination",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1198039614112399542/image.png?ex=65bd7456&is=65aaff56&hm=4a1bca2d540e14b0c2258bcb6a4b5ca6ddb9289d8221bc4fb5294df98e62247e&",
        description: `In the dimly lit caverns of Potato Kingdom, brave spud adventurers face the daunting challenge of Baron Durianwrath, a colossal durian infused with the essence of foul-smelling durians. As the air becomes thick with the pungent aroma, players must navigate the stench-filled battleground, dodging explosive durian attacks and combating the Baron's formidable durian minions to emerge victorious in this aromatic raid.`,
        successDescription: 'The courageous group of hunters withstand the overwhelming stench, strategically targeting and neutralizing Baron Durianwrath\'s minions before delivering the final blow, purging the Potato Kingdom of the Aromatic Abomination... for now.',
        failureDescription: 'Succumbing to the noxious fumes and explosive durian attacks, the brave adventurers fall one by one, overwhelmed by the potent combination of odor and destructive force unleashed by Baron Durianwrath and his minions.',
        credit: 'Inspired by Moonwave'
    }
]

const mediumRaidMobs = [
    {
        name: "Basilbane, the Herbaceous Harbinger",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1205682852172271727/baycil.png?ex=65d942a8&is=65c6cda8&hm=499bab1149a7948b3811db877a628775b9a9a4725cc1382fa14571281575baa7&",
        description: `Basilbane, the Herbaceous Harbinger, stands as a colossal basil plant adorned with twisting vines and vibrant basil leaves. This formidable foe harnesses the power of nature, unleashing entangling vines, toxic spores, and a pervasive herbal aura that challenges even the bravest spud adventurers in the heart of the Potato Kingdom.`,
        successDescription: 'Through keen tactics and herbal expertise, the potato adventurers successfully counter Basilbane\'s botanical onslaught, plucking the herbaceous harbringer from its roots and restoring balance to the Potato Kingdom.',
        failureDescription: 'Overwhelmed by the entangling vines and toxic spores unleashed by Basilbane, the spud heroes succumb to the relentless onslaught of nature\'s fury, leaving the Potato Kingdom in the clutches of the herbaceous menace.',
        credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
    }
]

const hardRaidMobs = [
    {
        name: "Netherfig, the Abyssal Figwraith",
        thumbnailUrl: "https://media.discordapp.net/attachments/221456693127675904/1201738231243341885/plant.png?ex=65cae8f1&is=65b873f1&hm=44ed099acc8954ccd201e86299bebd47fcf660430fd54aae7e98f9df089aea5d&",
        description: `Netherfig, the Abyssal Figwraith, emerges from the shadowy depths of the Potato Kingdom, a sinister fig draped in ethereal fig foliage. Dark energy emanates from its core, as it commands otherworldly fig minions and weaves dark spells to ensnare any daring adventurers.`,
        successDescription: 'With unwavering resolve, the spud heroes dispel the abyssal energies, shattering the spectral figwraith\'s influence and banishing Netherfig back into the shadows, restoring peace to the Potato Kingdom.',
        failureDescription: 'Succumbing to the dark enchantments and relentless figwraith minions, the potato adventurers are consumed by the abyssal forces, leaving the Potato Kingdom plunged into an eternal night under the rule of Netherfig, the malevolent harbinger of darkness.',
        credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
    },
    {
        name: "Behemoth Broccoli, the Green Guardian",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198836128179032125/SPOILER_image.png?ex=65c05a26&is=65ade526&hm=ae08d9219546b86ef8a79e0de03c87ba36245c0cfdb302999da13bd05dbd3305&",
        description: `Behemoth Broccoli, the Green Guardian, looms over the Potato Kingdom as an immense, sentient broccoli with towering florets and a formidable, leafy armor. Its presence exudes an aura of plant-based might, defending the vegetable realm with unwavering determination.`,
        successDescription: 'Through strategic teamwork and perseverance, the spud heroes dismantle Behemoth Broccoli\'s leafy defenses, exposing its vulnerable core and bringing an end to its reign as the Green Guardian, restoring harmony to the Potato Kingdom.',
        failureDescription: 'Overpowered by the broccoli behemoth\'s resilient defenses and potent vegetable magic, the potato adventurers succumb to the Green Guardian\'s formidable might, leaving the Potato Kingdom under the eternal watch of Behemoth Broccoli.',
        credit: 'Inspired by Zoodbarg'
    }
]

const metalKingRaidBoss = {
    name: "Metal King Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198661965015416842/latest.png?ex=65c8f272&is=65b67d72&hm=05a83ee3e8a39e6a0f3b8904e127f6655aeafcf239562d5ce484cd9ec42cd789&",
    description: `Metal Potatoes rumor that there exists a silvery sovereign presiding over them all. This mythical figure, the Metal King Potato, is said be an amalgamation of eight Metal Potatoes! Boasting devastating magic, impenetrable defence, and its signature evasion, this regal rival offers your party an unusual challenge.`,
    successDescription: 'In a desperate gambit, the potato adventurers launch an all-or-nothing attack at the fleeting foe. The Metal King is caught off guard, and in its stupor suffers a critical blow! Thanks to their decisive maneuver, the adventurers earn a beautiful bounty!',
    failureDescription: 'The potato adventurers struggle in a race against the clock, praying they can discover a weakness in the King\'s preposterous defence and dispell it before it can escape. However, following a disorienting explosion spell, the adventurers come to the sad realization that their slippery assailant is nowhere to be found...',
    credit: 'Inspired by RednaxeIa'
}

const regularStatRaidMobs = [
    {
        name: "Spectral Spudspecter, the Ghostly Potato Monarch",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1205607647781453914/1mwXHpdt6CTQHxH78dwc6NA.png?ex=65d8fc9e&is=65c6879e&hm=4cd919639eb3529c9a807565c3abfdd5f497db00ed9eb36bd9788e1801d5ec86&",
        description: `The Spectral Spudspecter, the Ghostly Potato Monarch, materializes as a haunting apparition, cloaked in ethereal potato skins and wreathed in wisps of ghostly vapors. Its spectral form exudes an otherworldly aura, commanding the very essence of the afterlife within the Potato Kingdom.`,
        successDescription: 'Through courage and cunning, the spud heroes banish the Spectral Spudspecter, dispersing its ghostly visage and restoring peace to the Potato Kingdom. The spectral monarch\'s reign of ethereal terror comes to an end, and the realm is freed from its haunting grasp.',
        failureDescription: 'Enveloped by the chilling embrace of the Spectral Spudspecter\'s ghostly powers, the potato adventurers fade into the shadows, their efforts to vanquish the Ghostly Potato Monarch thwarted. The realm of potatoes falls deeper into the spectral abyss, haunted by the ghostly presence of its malevolent ruler.',
        credit: 'Inspired by Moonwave'
    },
    {
        name: "Shiitakethane, the Fungal Tyrant",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1205607647781453914/1mwXHpdt6CTQHxH78dwc6NA.png?ex=65d8fc9e&is=65c6879e&hm=4cd919639eb3529c9a807565c3abfdd5f497db00ed9eb36bd9788e1801d5ec86&",
        description: `Shiitakethane, the Fungal Tyrant, emerges from the depths of the Potato Kingdom as a towering mushroom sovereign, adorned with spores and mycelial tendrils that writhe with eerie sentience. Its presence heralds a reign of fungal dominance, threatening the very balance of the vegetable realm.`,
        successDescription: 'Through stalwart resolve and strategic prowess, the spud heroes dismantle Shiitakethane\'s fungal empire, purging the Potato Kingdom of its tyrannical grip. The fungal tyrant\'s reign crumbles, and the realm is restored to harmony and balance.',
        failureDescription: 'Overwhelmed by the relentless onslaught of fungal minions and toxic spores unleashed by Shiitakethane, the potato adventurers succumb to the fungal tyrant\'s dominion. The Potato Kingdom plunges into darkness, ensnared by the tendrils of the Fungal Tyrant\'s malevolent rule.',
        credit: 'Inspired by Moonwave'
    }
]

const regularWorkMobs = [
    {
        name: "Baby Broccoli",
        thumbnailUrl: "https://banner2.cleanpng.com/20231112/oze/transparent-vegetable-cartoon-cartoon-broccoli-head-with-single-eyeball-kawaii6550d690299e20.5817524016997966241705.jpg",
        description: `You have worked and slain a rather cute vegetable... you still gain some potatoes, but people look at you a bit differently now.`
    },
    {
        name: "Cruel Carrot",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196674754199949312/image.png?ex=65b87d36&is=65a60836&hm=3d3c266d540733a97911817a7fd46ee349d5987fb08b54d829edd98b509e1711&",
        description: `You have worked and slain a dangerous vegetable. You gain some potatoes for your efforts!`
    },
    {
        name: "Blasphemous Bitter Melon",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196815721909452810/image.png?ex=65b9007f&is=65a68b7f&hm=8ace537de38b4a6878160e82a71467a8d18a7007f7fd4543f9d1579595175d16&",
        description: `You have worked and encountered a wanted criminal, the Bitter Melon! After a short battle you defeat them and are rewarded potatoes for keeping the kingdom safe!`,
        credit: `Inspired by Saeriel`
    },
    {
        name: "Egregious Eggplant",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196832421270798549/image.png?ex=65b9100d&is=65a69b0d&hm=4002206f8b697b426c2bfb31b894bb8ee6f14526ed78b0d7b014b44b4355543f&",
        description: `You have worked and run into the notorious Egregious Eggplant! You defeat the malevolent vegetable before it can continue its reign of terror and earn a fair share of potatoes!`,
        credit: `Inspired by Sinfonia`
    },
    {
        name: "Sinister Strawberry",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196837035235881020/image.png?ex=65b91459&is=65a69f59&hm=dd107d74060982694b4d7a9be2509717a8680caa3c8a515263fa938cadb7d7b8&",
        description: `You have worked and ran into the Sinister Strawberry! After a fierce battle, you defeat the Sinister Strawberry and earn a plentiful reward of potatoes!`
    },
    {
        name: "Raging Radish",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838130590961754/image.png?ex=65b9155e&is=65a6a05e&hm=29e67c5a4e3405bc36783b1688334a1bad8ac906fd755afe3487bdf339b9f5a1&",
        description: `You have worked and run into a Raging Radish! You defeat the fiery root vegetable, proving your mettle, and earn a hearty bag of potatoes!`
    },
    {
        name: "Treacherous Tomato",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838369779527701/image.png?ex=65b91597&is=65a6a097&hm=1413759e4e446646cda9a44b21fe1df99247975454ab787c496f4cf3aff19a48&",
        description: `You have worked and encounter the Treacherous Tomato! After a hard-fought struggle against the cunning and deceitful fruit, you emerge victorious and earn a generous amount of potatoes!`
    },
    {
        name: "Menacing Mango",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196838574188924928/image.png?ex=65b915c8&is=65a6a0c8&hm=8488d83d107d86c56839abbb5ae0656103f26e036e6b923016baaa19b635ddfe&",
        description: `You have worked and stumbled into a Menacing Mango! You fight bravely against this malevolent fruit and after a fierce struggle you slay it and earn a bountiful harvest of potatoes!`
    },
    {
        name: "Cowardly Cantaloupe",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196839012434980864/image.png?ex=65b91630&is=65a6a130&hm=e9f83f932c02e936de5ac6772659fe570d8f1140f3e6289a162360b9816f4475&",
        description: `You have worked and stumbled into a Cowardly Cantaloupe! It tries to roll away and escape! However you catch up, break it apart with no remorse, and earn a small share of potatoes!`,
        credit: `Inspired by Sinfonia`
    }
]

const largePotato = {
    name: "Large Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196675140117868695/image.png?ex=65b87d92&is=65a60892&hm=fe8d9d61369d404e19ca9aa07d337b0e62ec964c6dd99c0ed6f9ff98dde5a73f&",
    description: `You come across a rather Large Potato and slay it. You gain many potatoes for your bravery!`
}

const sweetPotato = {
    name: "Sweet Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196681406164770836/image.png?ex=65b88368&is=65a60e68&hm=0eac1e59888d567736222ece1106e06474cb9b8ac3a6b349aa7ce567033c83ac&",
    description: `You meet a lovely sweet potato and it convinces you to spare its life in exchange for buffing one of your stats. Check your profile!`
}

const poisonPotato = {
    name: "Poisonous Potato",
    thumbnailUrl: "https://static.wikia.nocookie.net/minecraft_gamepedia/images/c/c0/Poisonous_Potato_JE3_BE2.png/revision/latest?cb=20200521233152",
    description: `OH NO! While wandering around, you encounter a Poisonous Potato and you get dealthly ill. You lose many potatoes to pay for medicine and have to take a longer break from working!`,
    credit: `Inspired by Saeriel`
}

const goldenPotato = {
    name: "Golden Potato",
    thumbnailUrl: "https://ih0.redbubble.net/image.4402449953.5486/raf,360x360,075,t,fafafa:ca443f4786.jpg",
    description: `You discovered and sold a Golden Potato! You gain LOTS of potatoes for your amazing discovery!`
}

const metalPotatoSuccess = {
    name: "Metal Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196999133697953802/image.png?ex=65b9ab50&is=65a73650&hm=5bcd001cd5ab30d2e03bc09137a1df25109399326484ccc1bdea87fc7427a443&",
    description: `You had a rare chance encounter with a Metal Potato! Even when your attacks land on this elusive tater, they do very little damage. Your frustration mounts, as you know that this exceptional potato could escape at any moment! After an arduous battle against the metal spud, you emerge victorious. Check your profile for your increased stats and potatoes!`,
    credit: `Inspired by Rednaxeia`
}

const metalPotatoFailure = {
    name: "Metal Potato",
    thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196999133697953802/image.png?ex=65b9ab50&is=65a73650&hm=5bcd001cd5ab30d2e03bc09137a1df25109399326484ccc1bdea87fc7427a443&",
    description: `You have a rare chance encounter with a Metal Potato! With exceptional speed and defence, nearly all of your attacks seem futile against it. It hops on away from you, leaving you winded, confused, and most of all excited for the chance to find another one in the future. Better luck next time.`,
    credit: `Inspired by Rednaxeia`
}

const shops = [
    {
        shopId: "workShop",
        description: "This is where you buy tools and gear to improve work yield",
        items: [
            {
                amount: 1.5,
                cost: 50000,
                description: "A humble set of gear for beginners intended to facilitate the hunting process.",
                id: 1,
                name: "Novice Spud Seeker Set",
                type: "workMultiplierAmount"
            },
            {
                amount: 3,
                cost: 200000,
                description: "A respectable set of gear that's vital for those pursuing a career in potato hunting.",
                id: 2,
                name: "Potato Pursuer Kit",
                type: "workMultiplierAmount"
            },
            {
                amount: 5,
                cost: 1000000,
                description: "An intermediate set of accessories fit for a seasoned adventurer in the Potato Kingdom.",
                id: 3,
                name: "Spud Striker Gear",
                type: "workMultiplierAmount"
            },
            {
                amount: 10,
                cost: 5000000,
                description: "Cutting-edge equipment that lends itself well to defending the Potato Kingdom against nefarious vegetables.",
                id: 4,
                name: "Starch Stalker's Ensemble",
                type: "workMultiplierAmount"
            },
            {
                amount: 15,
                cost: 20000000,
                description: "This advanced arsenal provides heroes with the means to safeguard their kingdom in the face of the most vicious foes.",
                id: 5,
                name: "Veteran's Spud-Seeking Arsenal",
                type: "workMultiplierAmount"
            },
            {
                amount: 20,
                cost: 50000000,
                description: "An elite array of imposing weapons that can fell the toughest of enemies with ease.",
                id: 6,
                name: "Special-Grade Spud Slaying Gear",
                type: "workMultiplierAmount"
            },
            {
                amount: 30,
                cost: 200000000,
                description: "Ceremonious garments and gadgets said to have played a vital role in triumphing over an insurmountable force long ago.",
                id: 7,
                name: "Supreme Spud Gladiator's Garments",
                type: "workMultiplierAmount"
            },
            {
                amount: 40,
                cost: 1000000000,
                description: "A brilliant weapon, and one bearing a striking resemblance to those wielded by the first kings of the Potato Realm in the war to consolidate influence over their subjects.",
                id: 8,
                name: "Legendary Leader's Blade",
                type: "workMultiplierAmount"
            }
            // 9) Divine Instrument of Potato Blessings
            // -A glistening implement echoing with the success of its forebears, this tool is said to usher an age of good fortune for those blessed with the privilege of wielding it.

            // 10) Alien Armaments of Tuber Termination 
            // -This assortment of otherworldly equipment exudes unimaginable ferocity, striking fear into the hearts of friends and foes alike in the Potato Kingdom. 
        ],
        title: "Work Tools Shop (multiplier for work)"
    },
    {
        shopId: "passiveIncomeShop",
        description: "This is where you buy workers to improve passive yield",
        items: [
            {
                amount: 50000,
                cost: 50000,
                description: "An apprentice that helps gather some additional potatoes each day",
                id: 1,
                name: "Seedling Sprout Apprentice",
                type: "passiveAmount"
            },
            {
                amount: 100000,
                cost: 200000,
                description: "A small crew of workers that cultivate and harvest even more potatoes each day",
                id: 2,
                name: "Harvest Helpers Crew",
                type: "passiveAmount"
            },
            {
                amount: 180000,
                cost: 1000000,
                description: "A skilled squad of musicians that happen to love growing potatoes using their songs",
                id: 3,
                name: "Spud Symphony Squad",
                type: "passiveAmount"
            },
            {
                amount: 500000,
                cost: 5000000,
                description: "A large squad of trained professionals in the art of potato cultivation",
                id: 4,
                name: "Spud Team Six",
                type: "passiveAmount"
            },
            {
                amount: 1000000,
                cost: 20000000,
                description: "Armed with cutting-edge techniques and sustainable practices, this skilled team maximizes potato yields through eco-friendly methods, ensuring a lush harvest every day",
                id: 5,
                name: "Verdant Vanguard Growers",
                type: "passiveAmount"
            },
            {
                amount: 2000000,
                cost: 50000000,
                description: "This top-tier group of agricultural virtuosos seamlessly integrates various cultivation methods, creating a harmonious environment for potato growth",
                id: 6,
                name: "Harvest Harmony Elite",
                type: "passiveAmount"
            },
            {
                amount: 7000000,
                cost: 200000000,
                description: "An integrated network of potato scientists, farmers, and distributors capable of supporting the global potato economy with their robust supply chain",
                id: 7,
                name: "Cultivation Conglomerate",
                type: "passiveAmount"
            },
            {
                amount: 35000000,
                cost: 1000000000,
                description: "The greatest grower around",
                id: 8,
                name: "Lil David",
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
                amount: 100000,
                cost: 50000,
                description: "A basic pouch to hold some wealth and keep it safe",
                id: 1,
                name: "Spud Saver's Starter Pouch",
                type: "bankCapacity"
            },
            {
                amount: 500000,
                cost: 200000,
                description: "A rather secure holding for the more advanced potato collector",
                id: 2,
                name: "Savvy Spud Saver Bank",
                type: "bankCapacity"
            },
            {
                amount: 2500000,
                cost: 1000000,
                description: "A large hidden holding of potatoes hidden somewhere in a forest",
                id: 3,
                name: "Spud Hoarder Hideaway",
                type: "bankCapacity"
            },
            {
                amount: 10000000,
                cost: 5000000,
                description: "An underground vault specifically made to guard mountains of potatoes",
                id: 4,
                name: "Supreme Spud Vault",
                type: "bankCapacity"
            },
            {
                amount: 25000000,
                cost: 20000000,
                description: "A colossal storage facility designed for those who dream big in the world of potato farming",
                id: 5,
                name: "Prodigious Potato Reserve",
                type: "bankCapacity"
            },
            {
                amount: 150000000,
                cost: 50000000,
                description: "A prestigious storage solution for the truly distinguished potato farmer, offering a blend of elegance and functionality",
                id: 6,
                name: "Royal Russet Reserve",
                type: "bankCapacity"
            },
            {
                amount: 750000000,
                cost: 200000000,
                description: "An archaic reserve of potato knowledge and preservation, equipped with magical resevoirs of extraordinary capacity",
                id: 7,
                name: "Ancient Spud Library",
                type: "bankCapacity"
            },
            {
                amount: 4000000000,
                cost: 1000000000,
                description: "A mystical reservoir developed for the most illustrious potato gatherers with capacities that exceed mortal comprehension",
                id: 8,
                name: "Mystic Tuber Vault",
                type: "bankCapacity"
            }
        ],
        title: "Potato Storage Shop (increase bank capacity)"
    }
]

const awsConfigurations = {
    aws_table_name: 'leash-gromp-bot',
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
    regularRaidMobs,
    mediumRaidMobs,
    metalKingRaidBoss,
    metalPotatoSuccess,
    metalPotatoFailure,
    hardRaidMobs,
    regularStatRaidMobs,
    regularWorkMobs,
    largePotato,
    sweetPotato,
    poisonPotato,
    goldenPotato,
}