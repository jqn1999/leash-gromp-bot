const dynamoHandler = require("./dynamoHandler");
const { RaidFactory } = require("./raidFactory");
const { EmbedFactory } = require("./embedFactory");
const startRaid = require("../commands/guilds/startRaid.js")
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();

class worldFactory{
    constructor(){}

    async setWorldBoss(){
        let random = Math.floor(Math.random() * worldBossMobs.length);
        this.mob = worldBossMobs[random];
        // aws set world_active to true
        await dynamoHandler.updateStatDatabase("world", "world_active", true)
        await dynamoHandler.updateStatDatabase("world", "world_index", random)
    }
    
    getWorldEmbed(){
        return embedFactory.createWorldEmbed(this.mob)
    }

    async popWorldBoss(){
        // DOES NOT DO ANYTHING IF RAID BOSS IS FALSE
        let world = await dynamoHandler.getStatDatabase("world")
        if(world.world_active != true){
            return
        }

        // run that boss  
        description = startWorldBoss(world, this.mob)

        // TODO: CREATE EMBED WITH RESULT (description)

        const empty = []
        await dynamoHandler.updateStatDatabase("world", "world_active", false)
        await dynamoHandler.updateStatDatabase("world", "world_list", empty)
    }
}

async function startWorldBoss(world, mob){

    let raidList = world.world_list
    let totalMultiplier = 0;
    for (const [index, element] of raidList.entries()) {
        const userDetails = await dynamoHandler.findUser(element.id, element.username);
        totalMultiplier += userDetails.workMultiplierAmount;
    }

    const randomMultiplier = startRaid.getRandomFromInterval(.8, 1.2);
    const successChance = determinRaidSuccessChance(totalMultiplier, mob.difficulty);
    const successfulRaid = determineRaidResult(successChance);
    if (successfulRaid) {
        totalRaidReward = Math.round(mob.potatoReward * randomMultiplier);
        splitRaidReward = await raidFactory.handleRaid(raidList, totalRaidReward);
        raidResultDescription = mob.successDescription;
    } else {
        raidResultDescription = mob.failureDescription;
    }

    return raidResultDescription
}

function determinRaidSuccessChance(totalMultiplier, raidDifficulty) {
    const totalRaidSuccessChance = totalMultiplier / raidDifficulty; // 1/10 = .1
    const actualRaidSuccessChance = totalRaidSuccessChance > Raid.MAXIMUM_RAID_SUCCESS_RATE ? Raid.MAXIMUM_RAID_SUCCESS_RATE : totalRaidSuccessChance
    return actualRaidSuccessChance
}

// TODO: PUT REAL BOSSES IN
const worldBossMobs = [
    {
        name: "Griseous, the Dragon Fruit",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1146091052781011026/1206040896672370759/cover4.png?ex=65da901c&is=65c81b1c&hm=3c2f67f963960013fd5cecf2fcf8e79a8b0a8c32e12f157fbc2e2fcc24d3c406&",
        description: `Once a loyal servant to the Potato Kingdom, the Dragon Fruit Griseous was banished for its violence. It retreated to a warped dimension on the flipside of the vegetable realm, where common knowledge is distorted and strange. Having gazed upon the prosperous kingdom silently for years, the exiled Griseous has grown bitter with resentment. Now, this ferocious serpent descends upon the land once more, threatening to reign fiery vengeance and enshroud the world in eternal darkness.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `The heroes sunder the monstrous Dragon Fruit from the sky, sending Griseous plummeting toward the Earth. Their foe, now grounded, adapts quickly by firmly planting its six legs and bellowing shadowy flames. Guarding against the devastating dark onslaught, the potato adventurers execute a valiant maneuver that silences the unruly renegade. The Dragon Fruit sinks back into its shadowy exile, leaving the Potato Kingdom safe from its vengeance… for now.`,
        failureDescription: `Despite their best efforts, the potato adventurers are no match for Griseous’s spectral assault of shadowy flames. Succumbing to their foe’s merciless onslaught, the inhabitants of the potato kingdom are forced to seek shelter as their Kingdom is laid to waste by the rancorous Dragon Fruit.`,
        potatoReward: 20000000,
        multiReward: 5,
        passiveReward: 5000000,
        bankReward: 20000000,
        difficulty: 800
    }

]

module.exports = {
    worldFactory,
}