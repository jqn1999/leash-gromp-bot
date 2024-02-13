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

const RUN = {
    [PAYOUT.POTATOES]: 0,
    [PAYOUT.WORK_MULTIPLIER]: 0,
    [PAYOUT.PASSIVE_INCOME]: 0,
    [PAYOUT.BANK_CAPACITY]: 0,
    [MODIFIER.WORK_MULTIPLIER]: 0,
}

const FLOOR_TYPES = ["COMBAT", "ENCOUNTER", "TRANSACTION", "REWARD", "ELITE"]
const FLOOR_WEIGHTS = [4, 6, 8, 9]

const ENCOUNTERS = [
    {
        name: "DABABY",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1206040896672370759/cover4.png?ex=65da901c&is=65c81b1c&hm=3c2f67f963960013fd5cecf2fcf8e79a8b0a8c32e12f157fbc2e2fcc24d3c406&",
        description: "DABABY OFFERS YOU 200 POTATOES OR 1 WORK MULTIPLIER FOR THIS RUN.\n\nWhat will you take?",
        choices: [{name: '200 potats', outcome: PAYOUT.POTATOES, value: 200, result: "DABABY grants your POTATOES! NOW HE GONNA CAP A WALMART"}, 
                 {name: 'work multi', outcome: MODIFIER.WORK_MULTIPLIER, value: 1, result: "DABABY SCREAMS OUT LESSSSS GOOOOOO!!!! YOU HAVE RECEIVED YOUR WORK MULTI"}],
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
    LEAVE
}

