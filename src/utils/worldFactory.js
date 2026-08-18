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
    let raidList = world.world_list;
    let totalMultiplier = 0;
    let raidListByMulti = [];
    if (raidList.length > 0) {
        const raidMemberDetails = await Promise.all(raidList.map(element => dynamoHandler.findUser(element.id, element.username)));
        raidList.forEach((element, index) => {
            const userDetails = raidMemberDetails[index];
            // A malformed participant record (missing workMultiplierAmount) would
            // otherwise poison totalMultiplier to NaN for every participant, which
            // guarantees the raid resolves as a failure (Math.random() < NaN is always
            // false) regardless of anyone else's actual multiplier.
            const memberMultiplier = Number.isFinite(userDetails?.workMultiplierAmount) ? userDetails.workMultiplierAmount : 0;
            totalMultiplier += memberMultiplier;
            raidListByMulti.push({id: element.id, username: element.username, multiplier: memberMultiplier})
        })
        for (const element of raidListByMulti) {
            element.raidShare = totalMultiplier > 0 ? element.multiplier / totalMultiplier : 0;
        }
    }
    const randomMultiplier = getRandomFromInterval(.8, 1.2);
    const successChance = determinRaidSuccessChance(totalMultiplier, mob.difficulty);
    const successfulRaid = determineRaidResult(successChance);
    let totalRaidReward = 0,
        workMultiReward = 0,
        passiveReward = 0,
        bankCapacityReward = 0;
    if (successfulRaid) {
        totalRaidReward = Math.round(mob.potatoReward * randomMultiplier);
        raidListByMulti = await raidFactory.handlePotatoSplitByShare(raidListByMulti, totalRaidReward);
        workMultiReward = mob.workMultiReward;
        passiveReward = mob.passiveReward;
        bankCapacityReward = mob.bankCapacityReward;
        await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', workMultiReward);
        await raidFactory.handleStatSplit(raidList, 'passiveAmount', passiveReward);
        await raidFactory.handleStatSplit(raidList, 'bankCapacity', bankCapacityReward);
        await raidFactory.incrementCounter(raidList, 'worldBossWinCount');
        raidResultDescription = mob.successDescription;
    } else {
        totalRaidReward = Math.round(mob.potatoPenalty * randomMultiplier);
        raidListByMulti = await raidFactory.handlePotatoSplitByShare(raidListByMulti, totalRaidReward);
        raidResultDescription = mob.failureDescription;
    }
    return embedFactory.createWorldResultEmbed(raidListByMulti, totalRaidReward, mob, successChance,
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
    const actualRaidSuccessChance = totalRaidSuccessChance > .75 ? .75 : totalRaidSuccessChance
    return actualRaidSuccessChance
}

// TODO: Brassica and Yamsalot below still need real commissioned artwork — currently
// using the bot's generic avatar as a thumbnail placeholder.
const worldBossMobs = [
    {
        name: "Griseous, the Dragon Fruit",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1223775304926105680/griseous.png?ex=661b1491&is=66089f91&hm=0594a7df323206658c9394f882fcd9121776d3584d28c91f621e15667397ab04&",
        description: `Once a loyal servant to the Potato Kingdom, the Dragon Fruit Griseous was banished for its violence. It retreated to a warped dimension on the flipside of the vegetable realm, where common knowledge is distorted and strange. Having gazed upon the prosperous kingdom silently for years, the exiled Griseous has grown bitter with resentment. Now, this ferocious serpent descends upon the land once more, threatening to reign fiery vengeance and enshroud the world in eternal darkness.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `The heroes sunder the monstrous Dragon Fruit from the sky, sending Griseous plummeting toward the Earth. Their foe, now grounded, adapts quickly by firmly planting its six legs and bellowing shadowy flames. Guarding against the devastating dark onslaught, the potato adventurers execute a valiant maneuver that silences the unruly renegade. The Dragon Fruit sinks back into its shadowy exile, leaving the Potato Kingdom safe from its vengeance… for now.`,
        failureDescription: `Despite their best efforts, the potato adventurers are no match for Griseous's spectral assault of shadowy flames. Succumbing to their foe's merciless onslaught, the inhabitants of the potato kingdom are forced to seek shelter as their Kingdom is laid to waste by the rancorous Dragon Fruit.`,
        potatoReward: 150000000,
        potatoPenalty: 0,
        workMultiReward: 1,
        passiveReward: 500000,
        bankCapacityReward: 5000000,
        difficulty: 1800
    },
    {
        name: "Thunderlord Raikon",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1224532503163830306/raikon.png?ex=661dd5c3&is=660b60c3&hm=3ed00e0fc70caa556a3a40cc50445b27d6c009315fee47bc376372301dcb1342&",
        description: `Atop the stately peaks beyond the Potato Kingdom resides Thunderlord Raikon, a daikon wielding terrifying storm magic. Rumor has it that Raikon and the reigning Potato King held a friendly rivalry during their younger years. However, a bitter defeat at the hands of his adversary led Raikon down a dark path. Rather than lend his talents to supporting the kingdom, he struck a deal with the Spud Entity to access forbidden magic. Now, this heinous root vegetable intends to seize the crown for himself. The Thunderlord's dark clouds loom over his old rival's kingdom, threatening to rip the realm apart with vicious lightning.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `Our heroes weather Raikon's terrible storm, driving back his howling gales and deflecting his wicked lightning bolts. Having been outclassed, the Thunderlord begrudgingly surrenders and retreats deeper into the mountains.`,
        failureDescription: `Despite their best efforts, the potato adventurers are overwhelmed by Raikon's unrelenting storm. As our heroes are forced to retreat, the Thunderlord takes another step toward overthrowing his nemesis's peaceful Potato Kingdom.`,
        potatoReward: 50000000,
        potatoPenalty: 0,
        workMultiReward: 2,
        passiveReward: 1000000,
        bankCapacityReward: 10000000,
        difficulty: 1800
    },
    // Both bosses above share the exact same difficulty (1800) — these two add a real
    // gradient either side of it: Brassica is the accessible/early pull, Yamsalot is the
    // apex threat. thumbnailUrl is a placeholder (the bot's own generic avatar, same
    // fallback already used safely across other embeds in this codebase) since real
    // custom artwork like Griseous/Raikon's needs actual commissioned art, not something
    // generated here — swap it out once real art exists.
    {
        name: "Brassica, the Blooming Calamity",
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: `Deep within the Kingdom's overgrown Bramblewood, a dormant patch of cauliflower has stirred into something far stranger: Brassica, the Blooming Calamity. Once a humble vegetable bed tended by kingdom farmers, the patch was overtaken by wild floral magic during a forgotten storm, and now sprawls across the woods as a writhing mass of blossoming heads and thorned vines. It isn't malicious so much as mindlessly hungry, consuming everything in its path as it creeps toward the Kingdom's outskirts. Adventurers are needed to cut it back before it reaches the fields.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `The potato adventurers hack through Brassica's thorned vines and sever its central bud before the calamity can bloom any further. Robbed of its ability to spread, the mass of cauliflower heads wilts and retreats into the Bramblewood, dormant once more — for now.`,
        failureDescription: `The adventurers can't keep pace with Brassica's relentless growth, and the blooming calamity swallows their formation beneath a wave of thorned vines. Forced to retreat, the heroes watch helplessly as the patch creeps ever closer to the Kingdom's fields.`,
        potatoReward: 70000000,
        potatoPenalty: 0,
        workMultiReward: 0.75,
        passiveReward: 350000,
        bankCapacityReward: 3500000,
        difficulty: 1200
    },
    {
        name: "Yamsalot, the Iron Yam",
        thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
        description: `Legends of the Kingdom speak of an ancient yam knight forged in the molten root-fires beneath the mountains, sealed away after nearly toppling the throne generations ago. That seal has broken. Yamsalot, the Iron Yam, marches from the mountain passes clad in plating of hardened root-bark, wielding a blade quenched in the same fires that forged him — and he intends to finish what he started. The Kingdom's greatest heroes are needed to stand a chance.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `Through coordinated assault and no small amount of luck, the potato adventurers find the seams in Yamsalot's root-bark plating and drive their weapons home. The Iron Yam roars in fury as the ancient seal reasserts itself, dragging him back into the mountain passes — the Kingdom is safe, for now, from its oldest enemy.`,
        failureDescription: `Yamsalot's ancient fury proves too much even for the Kingdom's finest. His molten blade cuts through their ranks with contemptuous ease, and the adventurers are forced into a humiliating retreat as the Iron Yam continues his march toward the throne.`,
        potatoReward: 140000000,
        potatoPenalty: 0,
        workMultiReward: 3,
        passiveReward: 1500000,
        bankCapacityReward: 15000000,
        difficulty: 2500
    },
    {
        name: "Mochi, the Undying Stray",
        thumbnailUrl: "https://cdn.discordapp.com/emojis/1048769954910060544.webp?size=96",
        description: `Nobody in the Kingdom quite remembers whose cat Mochi used to be. What they do know is that the old graveyard behind the potato patch fields has been dug up, and a small, stitched-together, faintly glowing stray has been padding through the crops ever since — leaving trails of wilted vines and confused, half-rotten sprouts in its wake. It doesn't seem to mean any harm. It just wants headpats, and it does not understand that its claws are undead and enormous. The fields need tending before the "affection" spreads any further.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `The potato adventurers manage to corner Mochi with a trail of treats instead of a fight, and the little zombie cat flops over contentedly, purring static and glowing embers, before wandering back to its graveyard for a nap. The fields are safe, and somehow everyone leaves a little fonder of the Kingdom's new undead mascot.`,
        failureDescription: `Mochi headbutts the lead adventurer so hard it knocks them clean off their feet, and in the resulting chaos its glowing fur sheds sparks across half the field, wilting an entire season's crop. The stray saunters off unbothered, tail held high, leaving the Kingdom's farmers to clean up the mess.`,
        potatoReward: 90000000,
        potatoPenalty: 0,
        workMultiReward: 1,
        passiveReward: 450000,
        bankCapacityReward: 4500000,
        difficulty: 1500
    }
]

module.exports = {
    worldFactory,
    worldBossMobs
}