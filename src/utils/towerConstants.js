const { ButtonBuilder, ButtonStyle } = require("discord.js")
const { Raid } = require("./constants")

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

// Tower Revamp (2026-08-31) — see systems/tower.md's "Tower Revamp: Technical Design" section.
const POLICY = {
    SAFE: 'safe',
    GREEDY: 'greedy'
}

// Elite success-chance cap. Reused, not duplicated: imports Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE
// directly (0.9), the same constant mercenaryFactory.js's Bounty success-chance calc already
// reuses, rather than a second independent 90% magic number drifting out of sync with it later.
const ELITE_SUCCESS_CAP = Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE

// Replaces this.difficulty's old starting value of 1 and its old flat `+= 4.5` per forced Elite
// with a constant-ratio geometric climb — see systems/tower.md's "Difficulty curve rework" for the
// full rationale (arithmetic growth's ratio between consecutive Elites approaches 1 as N grows,
// which is the "flattens out later" dead zone this replaces).
const TOWER_ELITE_DIFFICULTY_INITIAL = 4.0
const TOWER_ELITE_DIFFICULTY_RATIO = 1.45

// Elite content banding — tier is a pure content/flavor selector, NEVER a balance input
// (elite.difficulty itself stays flat ~10.0 on every entry, in every band — see tower.md).
// maxN is inclusive; bands are walked in order, first match wins.
const ELITE_TIER_BANDS = [
    { maxN: 3,        tier: 1 },   // forced-elite # 1-3  (floors 10-30)
    { maxN: 8,        tier: 2 },   // forced-elite # 4-8  (floors 40-80)
    { maxN: 20,       tier: 3 },   // forced-elite # 9-20 (floors 90-200)
    { maxN: Infinity, tier: 4 }    // forced-elite # 21+  (floors 210+, reused forever)
]

// Reward-decay safeguard — a per-run diminishing multiplier on non-Elite floor payouts past a
// floor threshold, so the difficulty-curve rework's "more players survive deeper" doesn't also
// mean "unbounded risk-free persistent income." See tower.md's "Reward safeguard" section for the
// closed-form ceiling this produces (~19 full-value floors' worth of extra reward, no matter how
// many floors past the grace point a run survives).
const TOWER_REWARD_GRACE_FLOOR = 100     // floors 1-100 pay full value, no decay
const TOWER_REWARD_DECAY_RATIO = 0.95    // per floor past the grace floor

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
    },
    {
        // Content widening (2026-08-31) — see tower.md part 3.
        name: "Ferocious Fennel",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1208522991315587132/pngtree-image-of-broccoli-angry-vector-or-color-illustration-png-image_5274821.png?ex=65e397be&is=65d122be&hm=5b0e7253cfa86ed6fe7c168fb69beaf8292c7be0c16e988a842b7223c27c990e&",
        description: `As you ascend the tower's floors, you encounter a Ferocious Fennel, bristling with sharpened fronds. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 40000, result: "With the defeat of the Ferocious Fennel, its bristling fronds go still and the tower floor grows quiet once more." }]
    },
    {
        name: "Ravenous Rhubarb",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1208520322609848330/image.png?ex=65e39542&is=65d12042&hm=32442c7b1cd2b37d59df9989915c32237019e62c8926d48d12f659b8edbe6e3b&",
        description: `As you ascend the tower's floors, you encounter a Ravenous Rhubarb, snapping wildly at anything within reach. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 50000, result: "With the defeat of the Ravenous Rhubarb, its wild snapping finally stops." }]
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
    },
    {
        // Content widening (2026-08-31) — Grouchy Garlic, a Magic-Mango-shaped encounter (one
        // EXIT choice, one MODIFIER.WORK_MULTIPLIER choice). Mirrored pair below keeps the
        // deterministic-by-index convention every ENCOUNTERS entry relies on.
        name: "Grouchy Garlic",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "A grouchy clove of garlic guards two baskets, one holding 2x work modifier and the other holding nothing.\n\nWhich basket will you check?",
        choices: [{ name: 'This basket!', outcome: CHOICES.EXIT, result: "You check this basket but do not find anything......" },
        { name: 'That basket!', outcome: MODIFIER.WORK_MULTIPLIER, value: 2, result: "Behind this basket you find 2x work modifier!" }],
    },
    {
        name: "Grouchy Garlic",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "A grouchy clove of garlic guards two baskets, one holding 2x work modifier and the other holding nothing.\n\nWhich basket will you check?",
        choices: [{ name: 'This basket!', outcome: MODIFIER.WORK_MULTIPLIER, value: 2, result: "Behind this basket you find 2x work modifier!" },
        { name: 'That basket!', outcome: CHOICES.EXIT, result: "You check this basket but do not find anything......" }],
    },
    {
        // Ominous Onion, a Despicable-Dragonfruit-shaped encounter (both choices the same
        // outcome type, one positive/one negative).
        name: "Ominous Onion",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "An ominous onion rolls to a stop in front of you, layers rustling. What will you do?",
        choices: [{ name: 'Peel it!', outcome: PAYOUT.POTATOES, value: 100000, result: "You peel back its layers and find 100,000 potatoes tucked inside." },
        { name: 'Kick it!', outcome: PAYOUT.POTATOES, value: -100000, result: "You kick the onion and it bursts into stinging fumes, forcing you to drop 100,000 potatoes as you flee." }]
    },
    {
        name: "Ominous Onion",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1013160515897397289/1207538767741845514/isolated-mussels-seafood-cartoon_1308-126259.png?ex=65e0031d&is=65cd8e1d&hm=81b5cc137ba52355567e8c8ad7a8eed4d985ca57faeb798b3e0ffb2576b7b10d&",
        description: "An ominous onion rolls to a stop in front of you, layers rustling. What will you do?",
        choices: [{ name: 'Peel it!', outcome: PAYOUT.POTATOES, value: -100000, result: "You peel back its layers and it bursts into stinging fumes, forcing you to drop 100,000 potatoes as you flee." },
        { name: 'Kick it!', outcome: PAYOUT.POTATOES, value: 100000, result: "You kick the onion and it splits open, revealing 100,000 potatoes inside." }]
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
    {
        // Content widening (2026-08-31) — see tower.md part 3.
        name: "The Baron's Beet",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1208231024673161257/ori_3803828_982lh0b0qiq0s1eoiek9fii8bxlopkodr0ztvhnz_lime-fruit-wizard-cartoon-character.png?ex=65e287d4&is=65d012d4&hm=61a1fdd22142d6915596ffa043cf931f02b042b3f8cc61b4eb9afba0e7fc3c7b&",
        description: "A well-dressed beet offers you 1 million PERMANENT bank capacity for 450,000 potatoes.\n\nWill you take the offer?",
        choices: [{ name: 'Yes', outcome: PAYOUT.BANK_CAPACITY, value: 1000000, price: 450000, result: `You buy the permanent bank capacity upgrade from the baron!` },
        { name: 'No', outcome: CHOICES.EXIT, result: `You choose not to take the baron's offer and depart` }],
        poor: "As much as you want to buy the bank capacity, you don't have enough potatoes to buy it",
        poor_outcome: CHOICES.EXIT
    }
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
    },
    {
        // Content widening (2026-08-31) — a plain, non-conditional third REWARD so the pool
        // isn't just Fairy Fig/King Kiwi. See tower.md part 3.
        name: "Golden Ginger",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1206040896672370759/cover4.png?ex=65da901c&is=65c81b1c&hm=3c2f67f963960013fd5cecf2fcf8e79a8b0a8c32e12f157fbc2e2fcc24d3c406&",
        description: "A radiant ginger root offers you 200,000 passive income or 1.5 million bank capacity, both permanent.\n\nWhat will you take?",
        kill_elite: false,
        choices: [{ name: '200,000 passive income', outcome: PAYOUT.PASSIVE_INCOME, value: 200000, result: "The ginger dissolves into golden light, granting you 200,000 passive income!" },
        { name: '1.5 million bank capacity', outcome: PAYOUT.BANK_CAPACITY, value: 1500000, result: "The ginger dissolves into golden light, granting you 1.5 million bank capacity!" }],
    }
]

// Elite content banding (2026-08-31) — `tier` is a pure content-selection tag, never a balance
// input; every entry's `difficulty` stays flat ~10.0 deliberately (see tower.md part 3/4). Tiers
// 2-4 are placeholder flavor/thumbnails per the design's own "you do not need to author real
// names/flavor/thumbnails" allowance — structure is what matters here.
const ELITES = [
    {
        name: "Celerity, the Swift Stalk",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `You encounter the powerful Celerity. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 150000, result: "You have triumphed over Celerity!" }],
        difficulty: 10.0,
        lose: "You lost, better luck next time!",
        tier: 1
    },
    {
        name: "Rancid Radish",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `You encounter the reeking Rancid Radish. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 150000, result: "You have triumphed over the Rancid Radish!" }],
        difficulty: 10.0,
        lose: "You lost, better luck next time!",
        tier: 1
    },
    {
        name: "Grumpy Gourd",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `You encounter the towering Grumpy Gourd. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 150000, result: "You have triumphed over the Grumpy Gourd!" }],
        difficulty: 10.0,
        lose: "You lost, better luck next time!",
        tier: 2
    },
    {
        name: "Sour Squash",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `You encounter the venomous Sour Squash. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 150000, result: "You have triumphed over the Sour Squash!" }],
        difficulty: 10.0,
        lose: "You lost, better luck next time!",
        tier: 2
    },
    {
        name: "Ancient Artichoke",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `You encounter the ageless Ancient Artichoke. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 150000, result: "You have triumphed over the Ancient Artichoke!" }],
        difficulty: 10.0,
        lose: "You lost, better luck next time!",
        tier: 3
    },
    {
        name: "Corrupted Cauliflower",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `You encounter the writhing Corrupted Cauliflower. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 150000, result: "You have triumphed over the Corrupted Cauliflower!" }],
        difficulty: 10.0,
        lose: "You lost, better luck next time!",
        tier: 3
    },
    {
        name: "The Eternal Eggplant",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
        description: `You encounter the unending Eternal Eggplant. Prepare for combat!`,
        choices: [{ name: "Fight", outcome: PAYOUT.POTATOES, value: 150000, result: "You have triumphed over the Eternal Eggplant!" }],
        difficulty: 10.0,
        lose: "You lost, better luck next time!",
        tier: 4
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

const FAST_FORWARD = new ButtonBuilder()
    .setCustomId('fast_forward')
    .setLabel('Fast Forward to Next Elite')
    .setStyle(ButtonStyle.Secondary)

const SAFE_POLICY = new ButtonBuilder()
    .setCustomId('policy_safe')
    .setLabel('Play it safe')
    .setStyle(ButtonStyle.Primary)

const GREEDY_POLICY = new ButtonBuilder()
    .setCustomId('policy_greedy')
    .setLabel('Go for it')
    .setStyle(ButtonStyle.Danger)

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
    REWARD_PAYOUT,
    POLICY,
    ELITE_SUCCESS_CAP,
    TOWER_ELITE_DIFFICULTY_INITIAL,
    TOWER_ELITE_DIFFICULTY_RATIO,
    ELITE_TIER_BANDS,
    TOWER_REWARD_GRACE_FLOOR,
    TOWER_REWARD_DECAY_RATIO,
    FAST_FORWARD,
    SAFE_POLICY,
    GREEDY_POLICY
}

