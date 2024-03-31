const dynamoHandler = require("./dynamoHandler");
const { RaidFactory } = require("./raidFactory");
const { EmbedFactory } = require("./embedFactory");
const { Raid } = require("../utils/constants")
const { getRandomFromInterval } = require("../utils/helperCommands")
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();

class worldFactory{
    constructor(){
        this.mob = null
    }

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
        if (world.world_active != true){
            return [false, null]
        }

        // run that boss  
        if (this.mob == null) {
            this.mob = worldBossMobs[world.world_index];
        }
        const embed = await startWorldBoss(world, this.mob)
        await dynamoHandler.updateStatDatabase("world", "world_active", false)
        await dynamoHandler.updateStatDatabase("world", "world_list", [])
        return [true, embed]
    }
}

async function startWorldBoss(world, mob){
    let raidList = world.world_list
    let totalMultiplier = 0;
    if (raidList.length > 0) {
        for (const [index, element] of raidList.entries()) {
            const userDetails = await dynamoHandler.findUser(element.id, element.username);
            totalMultiplier += userDetails.workMultiplierAmount;
        }    
    }
    const randomMultiplier = getRandomFromInterval(.8, 1.2);
    const successChance = determinRaidSuccessChance(totalMultiplier, mob.difficulty);
    const successfulRaid = determineRaidResult(successChance);
    let totalRaidReward = 0,
        splitRaidReward = 0,
        workMultiReward = 0,
        passiveReward = 0,
        bankCapacityReward = 0;
    if (successfulRaid) {
        totalRaidReward = Math.round(mob.potatoReward * randomMultiplier);
        splitRaidReward = await raidFactory.handlePotatoSplit(raidList, totalRaidReward);
        workMultiReward = mob.workMultiReward;
        passiveReward = mob.passiveReward;
        bankCapacityReward = mob.bankCapacityReward;
        await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', workMultiReward);
        await raidFactory.handleStatSplit(raidList, 'passiveAmount', passiveReward);
        await raidFactory.handleStatSplit(raidList, 'bankCapacity', bankCapacityReward);
        raidResultDescription = mob.successDescription;
    } else {
        totalRaidReward = Math.round(mob.potatoPenalty * randomMultiplier);
        splitRaidReward = await raidFactory.handlePotatoSplit(raidList, totalRaidReward);
        raidResultDescription = mob.failureDescription;
    }
    return embedFactory.createWorldResultEmbed(raidList, totalRaidReward, splitRaidReward, mob, successChance,
                                    raidResultDescription, workMultiReward, passiveReward, bankCapacityReward)
}

function determineRaidResult(successChance) {
    const result = Math.random();
    if (result < successChance) {
        return true
    }
    return false
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
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1223775304926105680/griseous.png?ex=661b1491&is=66089f91&hm=0594a7df323206658c9394f882fcd9121776d3584d28c91f621e15667397ab04&",
        description: `Once a loyal servant to the Potato Kingdom, the Dragon Fruit Griseous was banished for its violence. It retreated to a warped dimension on the flipside of the vegetable realm, where common knowledge is distorted and strange. Having gazed upon the prosperous kingdom silently for years, the exiled Griseous has grown bitter with resentment. Now, this ferocious serpent descends upon the land once more, threatening to reign fiery vengeance and enshroud the world in eternal darkness.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `The heroes sunder the monstrous Dragon Fruit from the sky, sending Griseous plummeting toward the Earth. Their foe, now grounded, adapts quickly by firmly planting its six legs and bellowing shadowy flames. Guarding against the devastating dark onslaught, the potato adventurers execute a valiant maneuver that silences the unruly renegade. The Dragon Fruit sinks back into its shadowy exile, leaving the Potato Kingdom safe from its vengeance… for now.`,
        failureDescription: `Despite their best efforts, the potato adventurers are no match for Griseous’s spectral assault of shadowy flames. Succumbing to their foe’s merciless onslaught, the inhabitants of the potato kingdom are forced to seek shelter as their Kingdom is laid to waste by the rancorous Dragon Fruit.`,
        potatoReward: 20000000,
        potatoPenalty: -2000000,
        workMultiReward: 1,
        passiveReward: 1000000,
        bankCapacityReward: 5000000,
        difficulty: 1000
    }

]

module.exports = {
    worldFactory,
}