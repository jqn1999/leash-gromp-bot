const dynamoHandler = require("../utils/dynamoHandler");
const bjConsts = require("./blackJackConstants");
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder} = require("discord.js");

class blackJackFactory{

    async createInitalEmbed() {
        const avatarUrl = 'https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png';

        const embed = new EmbedBuilder()
            .setTitle(`Blackjack`)
            .setDescription(`This is a game of blackjack`)
            .setColor("Blue")
            .setThumbnail(avatarUrl)
            .setFooter({ text: "Made by AiRz" })
            .setTimestamp(Date.now())


            const row = new ActionRowBuilder().addComponents(bjConsts.HIT, bjConsts.STAND)
            const reply = await this.interaction.editReply({
                embeds: [embed],
                components: [row],
            });
            console.log("reply ",reply);
            
        return embed;
    }


    async startRun(){
        cont = await this.execNormalFloor()
    }

    async startGame(){
        index = await this.createInitalEmbed()
        }
    }

}


module.exports = {
    blackJackFactory
}







