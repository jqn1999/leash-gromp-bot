const { ButtonBuilder, ButtonStyle } = require("discord.js")

const PAYOUT = {
    POTATOES: 0,
    WORK_MULTIPLIER: 1,
    PASSIVE_INCOME: 2,
    BANK_CAPACITY: 3,
    ELITE_KILL: 5
}

const MODIFIER = {
    WORK_MULTIPLIER: 4,
}

const CHOICES = {
    EXIT: -1,
    ELITE: 6
}

const REWARD_PAYOUT = {
    FLOOR: 0,
    TYPE: 1,
    AMOUNT: 2
}

//const 

const RUN = {
    [PAYOUT.POTATOES]: 0,
    [PAYOUT.WORK_MULTIPLIER]: 0,
    [PAYOUT.PASSIVE_INCOME]: 0,
    [PAYOUT.BANK_CAPACITY]: 0,
    [MODIFIER.WORK_MULTIPLIER]: 0,
    [PAYOUT.ELITE_KILL]: []
}

const FLOOR_TYPES = ["COMBAT", "ENCOUNTER", "TRANSACTION", "REWARD", "ELITE"]
const FLOOR_WEIGHTS = [9, 12, 15, 18]
const COMBATS = [
    {
        name: "Baby Broccoli",
        thumbnailUrl: "https://banner2.cleanpng.com/20231112/oze/transparent-vegetable-cartoon-cartoon-broccoli-head-with-single-eyeball-kawaii6550d690299e20.5817524016997966241705.jpg",
        description: `As you ascend the tower's floors, you encounter an innocent Baby Broccoli, its small stature and innocent demeanor bringing a touch of warmth to the stone walls. However, you know this is no place for such an innocent creature. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 30000, result: "You slay the Baby Broccoli in a single strike and continue to ascend the tower, unsure whether you've made a mistake or not." }]
    },
    {
        name: "Malevolent Pineapple",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1208520322609848330/image.png?ex=65e39542&is=65d12042&hm=32442c7b1cd2b37d59df9989915c32237019e62c8926d48d12f659b8edbe6e3b&",
        description: `As you ascend the tower's floors, you encounter the Malevolent Pineapple, its sinister aura permeating the air with a sense of dread. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 60000, result: "With the defeat of the Malevolent Pineapple, its malevolent grip on this tower floor dissipates, allowing you to ascend higher with renewed determination." }]
    },
    {
        name: "Blighted Broccoli",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1208522991315587132/pngtree-image-of-broccoli-angry-vector-or-color-illustration-png-image_5274821.png?ex=65e397be&is=65d122be&hm=5b0e7253cfa86ed6fe7c168fb69beaf8292c7be0c16e988a842b7223c27c990e&",
        description: `As you ascend the tower's winding floors, you encounter a Blighted Broccoli, once an innocent baby broccoli now twisted by a dark curse, its presence unsettling. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 45000, result: "With the defeat of the Blighted Broccoli, the curse that plagued the baby broccoli lifts, allowing the tower floor to regain its tranquility and purity." }]
    }
]

const ENCOUNTERS = [
    {
        name: "Magic Mango",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "There are two mangos in front of you, behind one is 2x work modifier, and behind the other there is nothing.\n\nWhich mango will you check?",
        choices: [{ name: 'This one!', outcome: CHOICES.EXIT, result: "You check behind this mango but do not find anything......" },
        { name: 'No, this one!', outcome: MODIFIER.WORK_MULTIPLIER, value: 2, result: "Behind this mango you find 2x work modifier!" }],
    },
    {
        name: "Magic Mango",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "There are two mangos in front of you, behind one is 2x work modifier, and behind the other there is nothing.\n\nWhich mango will you check?",
        choices: [{ name: 'this one!', outcome: MODIFIER.WORK_MULTIPLIER, value: 2, result: "Behind this mango you find 2x work modifier!" },
        { name: 'that one!', outcome: CHOICES.EXIT, result: "You check behind this mango but do not find anything......" }],
    },
    {
        name: "Wacky Watermelon",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "You run into an eccentric looking watermelon who offers you two slices of watermelon but you can only choose one.\nWhich slice will you choose?",
        choices: [{ name: 'The left one!', outcome: MODIFIER.WORK_MULTIPLIER, value: 2, result: `You eat the slice of watermelon and suddenly feel much more energetic!\n\nYour work modifier has increased by 2!` },
        { name: 'The right one!', outcome: MODIFIER.WORK_MULTIPLIER, value: -2, result: "You eat the slice of watermelon and start feeling very dizzy......you black out\n\nYour work modifier has decreased by 2." }],
    },
    {
        name: "Wacky Watermelon",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "You run into an eccentric looking watermelon who offers you two slices of watermelon but you can only choose one.\nWhich slice will you choose?",
        choices: [{ name: 'The left one!', outcome: MODIFIER.WORK_MULTIPLIER, value: -2, result: "You eat the slice of watermelon and start feeling very dizzy......you black out\n\nYour work modifier has decreased by 2." },
        { name: 'The right one!', outcome: MODIFIER.WORK_MULTIPLIER, value: 2, result: `You eat the slice of watermelon and suddenly feel much more energetic!\n\nYour work modifier has increased by 2!` }]
    },
    {
        name: "Despicable Dragonfruit",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "An evil looking dragonfruit appears before you! What will you do?",
        choices: [{ name: 'Stab it!', outcome: PAYOUT.POTATOES, value: 100000, result: "You plunge your knife into the dragonfruit, causing its demise.\n\nYou collect 100,000 potatoes from the deceased fruit." },
        { name: 'Compliment it!', outcome: PAYOUT.POTATOES, value: -100000, result: `You try complimenting the dragonfruit's charming flaps, but you only seem to anger it. It overpowers you and steals your potatoes.\n\nYou have lost 100,000 potatoes.` }]
    },
    {
        name: "Despicable Dragonfruit",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "An evil looking dragonfruit appears before you! What will you do?",
        choices: [{ name: 'Stab it!', outcome: PAYOUT.POTATOES, value: -100000, result: "You attempt to stab the dragonfruit, but your blade shatters against the tough dragonfruit skin. The dragonfruit attacks, clearly angered by your actions.\n\nYou have lost 100,000 potatoes." },
        { name: 'Compliment it!', outcome: PAYOUT.POTATOES, value: 100000, result: `You tell the dragonfruit that you love its pink complexion. The dragonfruit blushes at your compliment and leaves you some potatoes for your adventure!\n\nYou have gained 100,000 potatoes!` }]
    },
    {
        name: "Wandering Woods",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "You enter a dense forest and before long, you seem to be lost within the trees. You eventually find your way to a path with two choices....\n\nWhich path will you take?",
        choices: [{ name: 'Left!', outcome: CHOICES.EXIT, result: `You find your way back onto the main path and manage to leave the forest!` },
        { name: 'Right!', outcome: CHOICES.ELITE, result: `The path leads you to the lair of a ferious elite......prepare for combat!` }]
    },
    {
        name: "Wandering Woods",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "You enter a dense forest and before long, you seem to be lost within the trees. You eventually find your way to a path with two choices....\n\nWhich path will you take?",
        choices: [{ name: 'Left!', outcome: CHOICES.ELITE, result: `The path leads you to the lair of a ferious elite......prepare for combat!` },
        { name: 'Right!', outcome: CHOICES.EXIT, result: `You find your way back onto the main path and manage to leave the forest!` }]
    }
]

const TRANSACTIONS = [
    {
        name: "Sales Spinach",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/932528787407642625/1209336128164073512/cute-spinach-on-white-background-vector-27328402.png?ex=65e68d09&is=65d41809&hm=91e5bf1c2d53606aeff23a1f5a23776558e5bee71666c75ee0faab720da45b2b&",
        description: "A spinach comes up and offers you 5x work modifier for 300,000 potatoes.\n\nWill you take the offer?",
        choices: [{ name: "Buy the work modifier", outcome: MODIFIER.WORK_MULTIPLIER, value: 5, price: 300000, result: "You agree to the spinach's deal and receive the work modifier!" },
        { name: "Leave", outcome: CHOICES.EXIT, result: "You decline the spinach's offer and move onto the next floor." }],
        poor: "You try to pay the spinach, but realize you don't have enough potatoes. The spinach leaves... get it?",
        poor_outcome: CHOICES.EXIT
    },
    {
        name: "The Wizard Lime",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1208231024673161257/ori_3803828_982lh0b0qiq0s1eoiek9fii8bxlopkodr0ztvhnz_lime-fruit-wizard-cartoon-character.png?ex=65e287d4&is=65d012d4&hm=61a1fdd22142d6915596ffa043cf931f02b042b3f8cc61b4eb9afba0e7fc3c7b&",
        description: "A magical looking lime threatens to send you to an elite if you don't pay 1,000,000 potatoes.\n\nWhat will you do?",
        choices: [{ name: 'Pay up', outcome: PAYOUT.POTATOES, value: 0, price: 1000000, result: `You pay the wizard who graciously takes the potatoes and leaves.` },
        { name: 'Keep your potatoes', outcome: CHOICES.ELITE, result: `The lime casts a spell on you, sending you straight to a dangerous elite!` }],
        poor: "You try to pay up but you do not have enough potatoes! The lime laughs as it starts casting a spell on you.......",
        poor_outcome: CHOICES.ELITE
    },
    {
        name: "The Traveling Turnip",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1208231024673161257/ori_3803828_982lh0b0qiq0s1eoiek9fii8bxlopkodr0ztvhnz_lime-fruit-wizard-cartoon-character.png?ex=65e287d4&is=65d012d4&hm=61a1fdd22142d6915596ffa043cf931f02b042b3f8cc61b4eb9afba0e7fc3c7b&",
        description: "A traveling turnip salesman is offering you 0.2 PERMANENT work multiplier for 600,000 potatoes.\n\nWill you take the offer?",
        choices: [{ name: 'Yes', outcome: PAYOUT.WORK_MULTIPLIER, value: 0.2, price: 600000, result: `You buy the permanent work multiplier from the turnip!` },
        { name: 'No', outcome: CHOICES.EXIT, result: `You choose not to take the turnip's offer and depart` }],
        poor: "As much as you want to buy the work multiplier, you don't have enough potatoes to buy it",
        poor_outcome: CHOICES.EXIT
    },

]

const REWARDS = [
    {
        name: "Fairy Fig",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1206040896672370759/cover4.png?ex=65da901c&is=65c81b1c&hm=3c2f67f963960013fd5cecf2fcf8e79a8b0a8c32e12f157fbc2e2fcc24d3c406&",
        description: "A flying fig offers you 500,000 potatoes or 5 work modifier on this run.\n\nWhat will you take?",
        kill_elite: false,
        choices: [{ name: '500,000 potatoes', outcome: PAYOUT.POTATOES, value: 500000, result: "The fig turned into dust and granted you 500,000 potatoes!" },
        { name: '5 work multiplier', outcome: MODIFIER.WORK_MULTIPLIER, value: 5, result: "The fig turned into dust and granted you 5 work modifier!" }],
    },
    {
        name: "King Kiwi",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1206040896672370759/cover4.png?ex=65da901c&is=65c81b1c&hm=3c2f67f963960013fd5cecf2fcf8e79a8b0a8c32e12f157fbc2e2fcc24d3c406&",
        description: `The King Kiwi, king of the Kiwi Plains, offers you either 0.2 work multiplier, 300,000 passive income, or 2 million bank capacity if you manage to defeat elite on floor `,
        description2: `.\n\nWhat will you choose?`,
        kill_elite: true,
        choices: [{name: '0.2 work multiplier', outcome: PAYOUT.ELITE_KILL, type: PAYOUT.WORK_MULTIPLIER, value: 0.2, result: "The king agrees to give you some work multiplier if you defeat the elite."},
        {name: '300,000 passive income', outcome: PAYOUT.ELITE_KILL, type: PAYOUT.PASSIVE_INCOME, value: 300000, result: "The king agrees to give you some passive if you defeat the elite."},
        {name: '2 million bank capacity', outcome: PAYOUT.ELITE_KILL, type: PAYOUT.BANK_CAPACITY, value: 2000000, result: "The king agrees to give you some bank capacity if you defeat the elite."}],
    }
]

const ELITES = [
    {
        name: "Celerity, the Swift Stalk",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `You encounter the powerful Celerity. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 150000, result: "You have triumphed over Celerity!" }],
        difficulty: 10.0,
        lose: "You lost, better luck next time!"
    }
]

const FIGHT = new ButtonBuilder()
    .setCustomId('fight')
    .setLabel('FIGHT')
    .setStyle(ButtonStyle.Success);

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
    REWARDS,
    FIGHT,
    REWARD_PAYOUT
}

