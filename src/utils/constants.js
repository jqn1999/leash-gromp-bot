const Work = {
    PERCENT_OF_TOTAL: .002,
    WORK_TIMER_SECONDS: 300,
    MAX_BASE_WORK_GAIN: 1000,
    MAX_LARGE_POTATO: 10000,
    MAX_POISON_POTATO: 5000,
    MAX_GOLDEN_POTATO: 500000,
    POISON_POTATO_TIMER_INCREASE_MS: 3300000
}

const Bet = {
    PERCENT_OF_SERVER_TOTAL_TO_BASE: .025
}

const Bank = {
    TAX_BASE: 1000,
    TAX_PERCENT: .05
}

const Rob = {
    WORK_TIMER_INCREASE_MS: 6900000,
    ROB_TIMER_SECONDS: 3600,
    BASE_ROB_PENALTY: 5000
}

const regularWorkMobs = [
    {
        name: "Broccoli",
        thumbnailUrl: "https://banner2.cleanpng.com/20231112/oze/transparent-vegetable-cartoon-cartoon-broccoli-head-with-single-eyeball-kawaii6550d690299e20.5817524016997966241705.jpg",
        description: `You have worked and slain a rather cute vegetable... you still gain some potatoes, but people look at you a bit differently now.`
    },
    {
        name: "Evil Carrot",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196674754199949312/image.png?ex=65b87d36&is=65a60836&hm=3d3c266d540733a97911817a7fd46ee349d5987fb08b54d829edd98b509e1711&",
        description: `You have worked and slain a dangerous vegetable. You gain some potatoes for your efforts!`
    },
    {
        name: "Blasphemous Bitter Melon",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1196815721909452810/image.png?ex=65b9007f&is=65a68b7f&hm=8ace537de38b4a6878160e82a71467a8d18a7007f7fd4543f9d1579595175d16&",
        description: `You have worked and encountered a wanted criminal, the Bitter Melon! After a short battle you defeat them and are rewarded potatoes for keeping the kingdom safe!`
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
    description: `You meet a lovely sweet potato and it convinces you to spare it's life in exchange for buffing one of your stats. Check your profile!`
}

const poisonPotato = {
    name: "Poisonous Potato",
    thumbnailUrl: "https://static.wikia.nocookie.net/minecraft_gamepedia/images/c/c0/Poisonous_Potato_JE3_BE2.png/revision/latest?cb=20200521233152",
    description: `OH NO! While wandering around, you encounter a Poisonous Potato and you get dealthly ill. You lose many potatoes to pay for medicine and have to take a longer break from working!`
}

const goldenPotato = {
    name: "Golden Potato",
    thumbnailUrl: "https://ih0.redbubble.net/image.4402449953.5486/raf,360x360,075,t,fafafa:ca443f4786.jpg",
    description: `You discovered and sold a Golden Potato! You gain LOTS of potatoes for your amazing discovery!`
}

module.exports = {
    Work,
    Bet,
    Bank,
    Rob,
    regularWorkMobs,
    largePotato,
    sweetPotato,
    poisonPotato,
    goldenPotato
}