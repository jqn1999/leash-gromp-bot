require("dotenv").config();

const Work = {
    PERCENT_OF_TOTAL: .002,
    WORK_TIMER_SECONDS: 300,
    MAX_BASE_WORK_GAIN: 1000,
    MAX_LARGE_POTATO: 10000,
    MAX_METAL_POTATO: 100000,
    MAX_POISON_POTATO: 5000,
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
    RAID_TIMER_SECONDS: 3600,
    REGULAR_RAID_REWARD: 100000,
    REGULAR_RAID_PENALTY: -100000,
    REGULAR_RAID_DIFFICULTY: 25,
    MEDIUM_RAID_REWARD: 500000,
    MEDIUM_RAID_PENALTY: -200000,
    MEDIUM_RAID_DIFFICULTY: 75,
}

const GuildRoles = {
    LEADER: "Leader",
    MEMBER: "Member"
}

const regularRaidMobs = [
    {
        name: "Celerity, the Swift Stalk",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1198039459271282819/image.png?ex=65bd7431&is=65aaff31&hm=53491255e3e9ae4d0802b84df5a17a3256d28bee34b9ee70f6dea221d4021805&",
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1198393298507792565/image.png?ex=65bebdbb&is=65ac48bb&hm=c50f01ea8a03bc05e296c17f53abc34aa9dd068239f579c232751af1095925c2&",
        description: `Basilbane, the Herbaceous Harbinger, stands as a colossal basil plant adorned with twisting vines and vibrant basil leaves. This formidable foe harnesses the power of nature, unleashing entangling vines, toxic spores, and a pervasive herbal aura that challenges even the bravest spud adventurers in the heart of the Potato Kingdom.`,
        successDescription: 'Through keen tactics and herbal expertise, the potato adventurers successfully counter Basilbane\'s botanical onslaught, plucking the herbaceous harbringer from its roots and restoring balance to the Potato Kingdom.',
        failureDescription: 'Overwhelmed by the entangling vines and toxic spores unleashed by Basilbane, the spud heroes succumb to the relentless onslaught of nature\'s fury, leaving the Potato Kingdom in the clutches of the herbaceous menace.',
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
    awsConfigurations,
    Work,
    Bet,
    Bank,
    Rob,
    GuildRoles,
    Raid,
    regularRaidMobs,
    mediumRaidMobs,
    regularWorkMobs,
    largePotato,
    sweetPotato,
    poisonPotato,
    goldenPotato,
    metalPotatoSuccess,
    metalPotatoFailure
}