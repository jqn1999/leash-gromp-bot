const {ButtonBuilder, ButtonStyle} = require("discord.js")

const PAYOUT = {
    POTATOES: 0,
    WORK_MULTIPLIER: 1,
    PASSIVE_INCOME: 2,
    BANK_CAPACITY: 3
}

const MODIFIER = {
    WORK_MULTIPLIER: 4, 
}

const CHOICES = {
    EXIT: -1,
    ELITE: 5
}

const RUN = {
    [PAYOUT.POTATOES]: 0,
    [PAYOUT.WORK_MULTIPLIER]: 0,
    [PAYOUT.PASSIVE_INCOME]: 0,
    [PAYOUT.BANK_CAPACITY]: 0,
    [MODIFIER.WORK_MULTIPLIER]: 0,
}

const FLOOR_TYPES = ["COMBAT", "ENCOUNTER", "TRANSACTION", "REWARD", "ELITE"]
const FLOOR_WEIGHTS = [4, 6, 8, 9]

const COMBATS = [
    {
        name: "Baby Broccoli",
        thumbnailUrl: "https://banner2.cleanpng.com/20231112/oze/transparent-vegetable-cartoon-cartoon-broccoli-head-with-single-eyeball-kawaii6550d690299e20.5817524016997966241705.jpg",
        description: `You encounter a baby broccoli! Prepare for combat!`,
        choices: [{name: "Fight", outcome: PAYOUT.POTATOES, value: 10000, result: "You have slain the baby broccoli! YOU MONSTER"}]
    }
]

const ENCOUNTERS = [
    {
        name: "MAGIC MUSSEL",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "BEHIND ONE MUSSESL IS 1 WORK MULTI, BEHIND THE OTHER IS NOTHING. WHICH ONE WILL YOU CHECK?",
        choices: [{name: 'this one!', outcome: CHOICES.EXIT, result: "there is nothing............"}, 
                 {name: 'that one!', outcome: MODIFIER.WORK_MULTIPLIER, value: 1, result: "you have chosen the work multi! congrats!"}],
    },
    {
        name: "MAGIC MUSSEL",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "BEHIND ONE MUSSESL IS 1 WORK MULTI, BEHIND THE OTHER IS NOTHING. WHICH ONE WILL YOU CHECK?",
        choices: [{name: 'this one!', outcome: MODIFIER.WORK_MULTIPLIER, value: 1, result: "you have chosen the work multi! congrats!"}, 
                 {name: 'that one!', outcome: CHOICES.EXIT, result: "there is nothing............"}],
    }
]

const TRANSACTIONS = [
    {
        name: "TATER WITCH",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/679508657058480147/1205176046001983569/IMG_0011.jpg?ex=65d76aa8&is=65c4f5a8&hm=cee60db47d5bfdd2389a78e62ce8a2cb99d0fa63ac03e96c10ffad90b67dc991&",
        description: "OLD HO COMES UP AND OFFERS YOU 1 WORK MULTIPLIER ON THIS RUN FOR 10000 POTATOES\n\nDO YOU ACCEPT?",
        choices: [{name: "ACCEPT HER OFFER!", outcome: MODIFIER.WORK_MULTIPLIER, value: 1, price: 10000, result: "YOU GET THAT WORK MULTI"},
                {name: "LEAVE", outcome: CHOICES.EXIT, result: "DONT TRUST THAT HO! WE OUT!"}],
        poor: "YOU WANT TO TAKE HER OFFER, BUT YOU ARE A BROKE BITCH! YOU LEAVE IN SHAME"
    }
]

const REWARDS = [
    {
        name: "DABABY",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1206040896672370759/cover4.png?ex=65da901c&is=65c81b1c&hm=3c2f67f963960013fd5cecf2fcf8e79a8b0a8c32e12f157fbc2e2fcc24d3c406&",
        description: "DABABY OFFERS YOU 200 POTATOES OR 1 WORK MULTIPLIER FOR THIS RUN.\n\nWhat will you take?",
        choices: [{name: '200 potats', outcome: PAYOUT.POTATOES, value: 200, result: "DABABY grants your POTATOES! NOW HE GONNA CAP A WALMART"}, 
                 {name: 'work multi', outcome: MODIFIER.WORK_MULTIPLIER, value: 1, result: "DABABY SCREAMS OUT LESSSSS GOOOOOO!!!! YOU HAVE RECEIVED YOUR WORK MULTI"}],
    }
]

const ELITES = [
    {
        name: "Celerity, the Swift Stalk",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `old description was too long lol`, 
        choices: [{name: "Fight", outcome: PAYOUT.POTATOES, value: 100000, result: "You have trimphed over Celerity!"}],
        difficulty: 10.0,
        lose: "you suck better luck next time"
    }
]

const CONT = new ButtonBuilder()
    .setCustomId('continue')
    .setLabel('CONTINUE')
    .setStyle(ButtonStyle.Success);

const LEAVE = new ButtonBuilder()
    .setCustomId('leave')
    .setLabel('LEAVE')
    .setStyle(ButtonStyle.Danger);

module.exports = {
    ENCOUNTERS,
    PAYOUT,
    FLOOR_TYPES,
    FLOOR_WEIGHTS,
    RUN,
    CONT,
    LEAVE,
    CHOICES,
    COMBATS,
    TRANSACTIONS,
    MODIFIER,
    ELITES,
    REWARDS
}

