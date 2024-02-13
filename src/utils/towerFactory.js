const dynamoHandler = require("../utils/dynamoHandler");
const tC = require("./towerConstants.js");
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder} = require("discord.js");

class towerFactory{

    constructor(_interaction) {
        this.floor = 0
        this.events = ["LARGEX2", "SWEETX2", "METALX2", "POISONX2", "GOLDENX5", "METALX5", "POISONX5"];
        this.eventWeights = [3, 3, 3, 3, 1, 1 ,1];
        this.run = tC.RUN
        
        
        this.interaction = _interaction
    }

    async startRun(multi){
        let floor_type
        var cont = true
        while(cont){
            this.floor++
            console.log(this.run)
            if(this.floor % 10 == 0){
                // EVERY TEN: THROW ELITE ASK FOR CONTINUE THEN RAISE DIFFICULTY
                break;
            }

            floor_type = getFloor()
            cont = await this.execNormalFloor(floor_type)
        }
    }

    async execNormalFloor(floor_type){
        let fl
        let index
        // remove this later
        floor_type = "ENCOUNTER"
        switch(floor_type){
            case "COMBAT":
                // think we just throw a normal mob from /work that you cant fail
                break;
            case "ENCOUNTER":
                fl = tC.ENCOUNTERS[Math.floor(Math.random() * tC.ENCOUNTERS.length)]
                index = await this.createFloorEmbed(fl, "ENCOUNTER")
                this.updateValues(fl, index)
                return this.createNextEmbed(fl, index)
            case "TRANSACTION":
                break;
            case "REWARD":
                break;
        }
    }

    async createFloorEmbed(fl, type){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}: ${type}\n${fl.name}`)
            .setDescription(fl.description)
            .setColor('Yellow')
            .setTimestamp(Date.now())
            .setThumbnail(fl.thumbnailUrl)
            .setFooter({text: "Made by Beggar"});
    
        const buttons = fl.choices.map((choice) =>{
            return new ButtonBuilder()
                .setCustomId(choice.name)
                .setLabel(choice.name)
                .setStyle(ButtonStyle.Primary)
        });
    
        const row = new ActionRowBuilder().addComponents(buttons)
        const reply = await this.interaction.followUp({
            embeds: [embed],
            components: [row],
        });
    
        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter})
    
        for (var i in fl.choices){
            if(confirmation.customId == fl.choices[i].name){
                await confirmation.update({content: '', components: []})
                return i
            }
        }
    }

    updateValues(fl, index){
        this.run[fl.choices[index].outcome] += fl.choices[index].value
    }

    async createNextEmbed(fl, index){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}`)
            .setDescription(`${fl.choices[index].result}\n\nCONTINUE UP THE TOWER?`)
            .setColor('Green')
            .setTimestamp(Date.now())
            .setThumbnail("https://cdn.discordapp.com/attachments/1146091052781011026/1206817828842242090/F5irpvObIAARN4W.png?ex=65dd63af&is=65caeeaf&hm=e10cc3c6ebc3809ab6907b17f4d710cca58b6e88da6f3a22d4c2bb2d97fc17ac&")
            .setFooter({text: "Made by Beggar"});
    
        const row = new ActionRowBuilder().addComponents(tC.CONT, tC.LEAVE)
        const reply = await this.interaction.followUp({
            embeds: [embed],
            components: [row],
        });
    
        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter})
        
        if(confirmation.customId == "continue"){
            await confirmation.update({content: '', components: []})
            return true
        }else if(confirmation.customId == "leave"){
            await confirmation.update({content: '', components: []})
            return false
        }
        console.log("retard")
    }
}

function getFloor() {
    var random = Math.floor(Math.random() * tC.FLOOR_WEIGHTS[tC.FLOOR_WEIGHTS.length - 1]);
    for (var i = 0; i < tC.FLOOR_WEIGHTS.length; i++)
        if (random < tC.FLOOR_WEIGHTS[i])
            break;
    return tC.FLOOR_TYPES[i];
}

module.exports = {
    towerFactory
}