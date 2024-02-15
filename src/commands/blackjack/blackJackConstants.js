const {ButtonBuilder, ButtonStyle} = require("discord.js")


const choices = [
    {name: 'Hit', emoji: '👊'},
    {name: 'Stand', emoji: '🤚'}
]

const HIT = new ButtonBuilder()
    .setCustomId('hit')
    .setLabel('HIT')
    .setStyle(ButtonStyle.Success)
    .setEmoji('👊')

const STAND = new ButtonBuilder()
    .setCustomId('stand')
    .setLabel('STAND')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🤚');


module.exports = {
    HIT,
    STAND,
}