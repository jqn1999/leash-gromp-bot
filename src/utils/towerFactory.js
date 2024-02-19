const dynamoHandler = require("../utils/dynamoHandler");
const tC = require("./towerConstants.js");
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder} = require("discord.js");

class towerFactory{

    constructor(_interaction, _username, multi) {
        this.floor = 0
        this.events = ["LARGEX2", "SWEETX2", "METALX2", "POISONX2", "GOLDENX5", "METALX5", "POISONX5"];
        this.eventWeights = [3, 3, 3, 3, 1, 1 ,1];
        this.run = tC.RUN
        this.username = _username
        this.interaction = _interaction
        this.multi = multi
        this.difficulty = 1
    }

    async startRun(){
        let floor_type = "COMBAT"
        var cont = true
        while(cont){
            this.floor++
            console.log(this.run)
            if(this.floor % 10 == 0){
                // EVERY TEN: THROW ELITE ASK FOR CONTINUE THEN RAISE DIFFICULTY
                cont = await this.execElite(this.difficulty)
                this.difficulty += 2
                floor_type = getFloor()
                continue;
            }

            cont = await this.execNormalFloor(floor_type)
            floor_type = getFloor()
        }
        return this.run, this.floor
    }

    async execNormalFloor(floor_type){
        let fl
        let index
        // TODO: remove this later
        //floor_type = "REWARD"
        switch(floor_type){
            case "COMBAT":
                // think we just throw a normal mob from /work that you cant fail
                fl = tC.COMBATS[Math.floor(Math.random() * tC.COMBATS.length)]
                index = await this.createFloorEmbed(fl, "COMBAT", "Orange", fl.description)
                return this.updateValue(fl, index)
            case "ENCOUNTER":
                fl = tC.ENCOUNTERS[Math.floor(Math.random() * tC.ENCOUNTERS.length)]
                index = await this.createFloorEmbed(fl, "ENCOUNTER", "Yellow", fl.description)
                return this.updateValue(fl, index)
            case "TRANSACTION":
                fl = tC.TRANSACTIONS[Math.floor(Math.random() * tC.TRANSACTIONS.length)]
                index = await this.createFloorEmbed(fl, `TRANSACTION (${this.run[tC.PAYOUT.POTATOES]} potatoes)`, "Blue", fl.description)
                return this.updateTransaction(fl, index)
            case "REWARD":
                fl = tC.REWARDS[Math.floor(Math.random() * tC.REWARDS.length)]
                if(fl.kill_elite == true){
                    let nextElite = (Math.floor(this.floor / 10) + 1) * 10
                    index = await this.createFloorEmbed(fl, "REWARD", "Purple", fl.description + `${nextElite}` + fl.description2)
                    return this.updateValue(fl, index)
                }
                index = await this.createFloorEmbed(fl, "REWARD", "Purple", fl.description)
                return this.updateValue(fl, index)
        }
    }

    async execElite(difficulty){
        let fl = tC.ELITES[Math.floor(Math.random() * tC.ELITES.length)]
        let success = (this.multi + this.run[tC.MODIFIER.WORK_MULTIPLIER]) / (difficulty * fl.difficulty)
        if(success > 1){
            success = 1
        }
        let fight = await this.createEliteEmbed(fl, success)
        
        if(!fight){
            this.floor--
            return false
        }
        if (Math.random() < success){
            this.run[tC.PAYOUT.POTATOES] += fl.choices[0].value
            // handle reward payouts
            this.checkElitePayout()
            return this.createNextEmbed(fl, fl.choices[0].result)
        }
        this.run[tC.PAYOUT.POTATOES] = 0
        return this.createDeathEmbed(fl.lose)

    }

    async updateValue(fl, index){
        switch(fl.choices[index].outcome){
            case tC.CHOICES.EXIT:
                return this.createNextEmbed(fl, fl.choices[index].result)
            case tC.CHOICES.ELITE:
                await this.createEliteEncounter(fl, fl.choices[index].result)
                return this.execElite(this.difficulty)
            case tC.PAYOUT.ELITE_KILL:
                let nextElite = (Math.floor(this.floor / 10) + 1) * 10
                let elite_kill = [nextElite, fl.choices[index].type, fl.choices[index].value]
                this.run[tC.PAYOUT.ELITE_KILL].push(elite_kill)
                return this.createNextEmbed(fl, fl.choices[index].result)
            default:
                this.run[fl.choices[index].outcome] += fl.choices[index].value
                return this.createNextEmbed(fl, fl.choices[index].result)
        }
    }

    async updateTransaction(fl, index){
        let poor = this.run[tC.PAYOUT.POTATOES] < fl.choices[index].price
        if(fl.choices[index].outcome == tC.CHOICES.EXIT){
            return this.createNextEmbed(fl, fl.choices[index].result)
        }else if(fl.choices[index].outcome==tC.CHOICES.ELITE ){
            await this.createEliteEncounter(fl, fl.choices[index].result)
            return this.execElite(this.difficulty)
        }
        // check if enough money
        if(poor){
            if(fl.poor_outcome == tC.CHOICES.ELITE){
                await this.createEliteEncounter(fl, fl.poor)
                return this.execElite(this.difficulty)
            }
            return this.createNextEmbed(fl, fl.poor)
        }

        // update outcome + value then subtract price
        this.run[fl.choices[index].outcome] += fl.choices[index].value
        this.run[tC.PAYOUT.POTATOES]-= fl.choices[index].price
        return this.createNextEmbed(fl, fl.choices[index].result)
    }

    async checkElitePayout(){
        let remove_index = []
        for(const [i, payout] of this.run[tC.PAYOUT.ELITE_KILL].entries()){
            console.log(i)
            console.log(payout)
            if(this.floor == payout[tC.REWARD_PAYOUT.FLOOR]){
                this.run[payout[tC.REWARD_PAYOUT.TYPE]] += payout[tC.REWARD_PAYOUT.AMOUNT]
                remove_index.push(i)
            }
        }

        console.log(remove_index)
        for(let i = remove_index.length - 1; i >= 0; i--){
            this.run[tC.PAYOUT.ELITE_KILL].splice(remove_index[i], 1)
        }
    }

    async createFloorEmbed(fl, type, color, description){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}: ${type}\n${fl.name}`)
            .setDescription(description)
            .setColor(color)
            .setTimestamp(Date.now())
            .setThumbnail(fl.thumbnailUrl)
            .setFooter({text: `Tater Tower: ${this.username}`});
    
        const buttons = fl.choices.map((choice) =>{
            return new ButtonBuilder()
                .setCustomId(choice.name)
                .setLabel(choice.name)
                .setStyle(ButtonStyle.Primary)
        });
    
        const row = new ActionRowBuilder().addComponents(buttons)
        const reply = await this.interaction.editReply({
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

    async createNextEmbed(fl, description){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}: ${fl.name}\n${this.username}: ${(this.multi + this.run[tC.MODIFIER.WORK_MULTIPLIER]).toFixed(2)}x (${this.run[tC.MODIFIER.WORK_MULTIPLIER].toFixed(2)}x)`)
            .setDescription(`${description}`)
            .setColor('Green')
            .setTimestamp(Date.now())
            .setThumbnail("https://cdn.discordapp.com/attachments/1146091052781011026/1206817828842242090/F5irpvObIAARN4W.png?ex=65dd63af&is=65caeeaf&hm=e10cc3c6ebc3809ab6907b17f4d710cca58b6e88da6f3a22d4c2bb2d97fc17ac&")
            .setFooter({text: `Tater Tower: ${this.username}`})
            .addFields(
                {
                    name: "Potatoes:",
                    value: `${this.run[tC.PAYOUT.POTATOES].toLocaleString()}`,
                    inline: false,
                },
                {
                    name: "Work Multiplier:",
                    value: `${this.run[tC.PAYOUT.WORK_MULTIPLIER].toFixed(2)}x`,
                    inline: false,
                },
                {
                    name: "Passive Income:",
                    value: `${this.run[tC.PAYOUT.PASSIVE_INCOME].toLocaleString()}`,
                    inline: false,
                },
                {
                    name: "Bank Capacity:",
                    value: `${this.run[tC.PAYOUT.BANK_CAPACITY].toLocaleString()}`,
                    inline: false,
                }
            );
    
        const row = new ActionRowBuilder().addComponents(tC.CONT, tC.LEAVE)
        const reply = await this.interaction.editReply({
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
    }

    async createEliteEmbed(fl, success){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}: ELITE\n${fl.name}: ${(this.multi + this.run[tC.MODIFIER.WORK_MULTIPLIER]).toFixed(2)}x (${this.run[tC.MODIFIER.WORK_MULTIPLIER].toFixed(2)}x)`)
            .setDescription(fl.description + `\n\nSuccess Chance: ${(success*100).toFixed(2)}%`)
            .setColor("Red")
            .setTimestamp(Date.now())
            .setThumbnail(fl.thumbnailUrl)
            .setFooter({text: `Tater Tower: ${this.username}`});
    
        const row = new ActionRowBuilder().addComponents(tC.FIGHT, tC.LEAVE)
        const reply = await this.interaction.editReply({
            embeds: [embed],
            components: [row],
        });

        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter})
    
        if(confirmation.customId == "fight"){
            await confirmation.update({content: '', components: []})
            return true
        }else if(confirmation.customId == "leave"){
            await confirmation.update({content: '', components: []})
            return false
        }
    }

    async createEliteEncounter(fl, description){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}\n${fl.name}: ${(this.multi + this.run[tC.MODIFIER.WORK_MULTIPLIER]).toFixed(2)}x (${this.run[tC.MODIFIER.WORK_MULTIPLIER].toFixed(2)}x)`)
            .setDescription(description)
            .setColor('Red')
            .setTimestamp(Date.now())
            .setThumbnail(fl.thumbnailUrl)
            .setFooter({text: `Tater Tower: ${this.username}`});
    
        const row = new ActionRowBuilder().addComponents(tC.CONT)
        const reply = await this.interaction.editReply({
            embeds: [embed],
            components: [row],
        });
    
        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter})
        
        if(confirmation.customId == "continue"){
            await confirmation.update({content: '', components: []})
            return true
        }
    }

    async createDeathEmbed(description){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}`)
            .setDescription(`${description}\n\n`)
            .setColor("NotQuiteBlack")
            .setTimestamp(Date.now())
            .setThumbnail("https://cdn.discordapp.com/attachments/1146091052781011026/1207183304286277685/skull.png?ex=65deb810&is=65cc4310&hm=51a9b329d50a101665716d8fb73b35b95a172b3de732e4f7f9e69f31d5c41980&")
            .setFooter({text: `Tater Tower: ${this.username}`});
    
        const row = new ActionRowBuilder().addComponents(tC.LEAVE)
        const reply = await this.interaction.editReply({
            embeds: [embed],
            components: [row],
        });
    
        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter})
        
        await confirmation.update({content: '', components: []})
        this.floor--
        return false
        
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