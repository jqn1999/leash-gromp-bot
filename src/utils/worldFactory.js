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

    // index lets a caller (the admin trigger command) force a specific mob instead of
    // the usual random pick the hourly cron uses.
    async setWorldBoss(index = null){
        const selectedIndex = index !== null ? index : Math.floor(Math.random() * worldBossMobs.length);
        this.mob = worldBossMobs[selectedIndex];
        // aws set world_active to true
        await dynamoHandler.updateStatDatabase("world", "world_active", true)
        await dynamoHandler.updateStatDatabase("world", "world_index", selectedIndex)
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
        bankCapacityReward = 0,
        worldBuff = null;
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
        // Server-wide temporary buff (see each mob's own `buff` field above) — on top of,
        // never instead of, the per-participant rewards just granted. Only a WIN grants
        // one; `mob.buff` is falsy only on a LOSS (`worldBuff` stays whatever it was
        // initialized to above), still passed through to createWorldResultEmbed so it can
        // say so explicitly. A new kill's buff replaces whatever was previously stored
        // outright — see setActiveWorldBuff's own comment for why this doesn't stack or
        // extend a running timer.
        if (mob.buff) {
            worldBuff = {
                bossName: mob.name,
                buffType: mob.buff.type,
                value: mob.buff.value,
                expiresAt: Date.now() + WORLD_BUFF_DURATION_SECONDS * 1000
            };
            await dynamoHandler.setActiveWorldBuff(worldBuff);
        }
    } else {
        totalRaidReward = Math.round(mob.potatoPenalty * randomMultiplier);
        raidListByMulti = await raidFactory.handlePotatoSplitByShare(raidListByMulti, totalRaidReward);
        raidResultDescription = mob.failureDescription;
    }
    return embedFactory.createWorldResultEmbed(raidListByMulti, totalRaidReward, mob, successChance,
                                    raidResultDescription, workMultiReward, passiveReward, bankCapacityReward, worldBuff, successfulRaid)
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

// How long a World Boss kill's server-wide buff (see each mob's own `buff` field below)
// lasts before going stale — flat across every boss rather than varying by difficulty, so
// a player only ever has to reason about one number ("about until the next boss might show
// up," roughly this game's own dormant-boss spawn cadence). See
// systems/raids-and-world-events.md#server-wide-buff.
const WORLD_BUFF_DURATION_SECONDS = 86400;

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
        difficulty: 1800,
        // Server-wide buff on a win (2026-08-29, product-owner scoped — see
        // systems/raids-and-world-events.md#server-wide-buff): exact match to Fieldmouse's
        // own permanent Common-tier workCooldownSkipChance (0.05) — "give the whole server
        // Fieldmouse's perk for a day" — deliberately below Spudsprite (0.15)/Mochi (0.20)
        // so those pulls stay meaningfully better than the free version.
        buff: { type: "cooldownSkip", value: 0.05 }
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
        difficulty: 1800,
        // Server-wide buff on a win — +10% of each player's own workMultiplierAmount,
        // applied the same additive shape getGuildWorkMulti/getCompanionWorkMulti already
        // use. Sits under both nearby investment-gated ceilings (guild workMulti caps at
        // +15% at guild level 10; the best companion workMultiplierPercent is Mochi's
        // +12%) — a free, temporary +10% is a real treat without out-earning either
        // progression path. See systems/raids-and-world-events.md#server-wide-buff.
        buff: { type: "workMulti", value: 0.10 }
    },
    // Both bosses above share the exact same difficulty (1800) — these two add a real
    // gradient either side of it: Brassica is the accessible/early pull, Yamsalot is the
    // apex threat.
    {
        name: "Brassica, the Blooming Calamity",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543699186912854026/NzQwJnE9ODA.png?ex=6a95d166&is=6a947fe6&hm=8186bbb99fc05c113a906a918e7f0ec01a61a92f861e28b003e27fa90f5e441b&",
        description: `Deep within the Kingdom's overgrown Bramblewood, a dormant patch of cauliflower has stirred into something far stranger: Brassica, the Blooming Calamity. Once a humble vegetable bed tended by kingdom farmers, the patch was overtaken by wild floral magic during a forgotten storm, and now sprawls across the woods as a writhing mass of blossoming heads and thorned vines. It isn't malicious so much as mindlessly hungry, consuming everything in its path as it creeps toward the Kingdom's outskirts. Adventurers are needed to cut it back before it reaches the fields.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `The potato adventurers hack through Brassica's thorned vines and sever its central bud before the calamity can bloom any further. Robbed of its ability to spread, the mass of cauliflower heads wilts and retreats into the Bramblewood, dormant once more — for now.`,
        failureDescription: `The adventurers can't keep pace with Brassica's relentless growth, and the blooming calamity swallows their formation beneath a wave of thorned vines. Forced to retreat, the heroes watch helplessly as the patch creeps ever closer to the Kingdom's fields.`,
        potatoReward: 70000000,
        potatoPenalty: 0,
        workMultiReward: 0.75,
        passiveReward: 350000,
        bankCapacityReward: 3500000,
        difficulty: 1200,
        // Reversal of an earlier "deliberately no buff" scoping call (2026-08-29) — Brassica
        // now grants a server-wide passive income boost, keeping every boss on the roster
        // paired with a buff type (Griseous: cooldown skip, Raikon: work multiplier,
        // Yamsalot: starch discount, Brassica: passive income).
        buff: { type: "passiveBoost", value: 0.10 }
    },
    {
        name: "Yamsalot, the Iron Yam",
        thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543699244047663195/NzI1NDQ5LmpwZw.png?ex=6a95d174&is=6a947ff4&hm=1d8cb3f859f4082a8df0a9e6963ce40259c1d21537f50fd3c321a551f0c46d40&",
        description: `Legends of the Kingdom speak of an ancient yam knight forged in the molten root-fires beneath the mountains, sealed away after nearly toppling the throne generations ago. That seal has broken. Yamsalot, the Iron Yam, marches from the mountain passes clad in plating of hardened root-bark, wielding a blade quenched in the same fires that forged him — and he intends to finish what he started. The Kingdom's greatest heroes are needed to stand a chance.\n\nJoin this world raid with /join-world-raid!`,
        successDescription: `Through coordinated assault and no small amount of luck, the potato adventurers find the seams in Yamsalot's root-bark plating and drive their weapons home. The Iron Yam roars in fury as the ancient seal reasserts itself, dragging him back into the mountain passes — the Kingdom is safe, for now, from its oldest enemy.`,
        failureDescription: `Yamsalot's ancient fury proves too much even for the Kingdom's finest. His molten blade cuts through their ranks with contemptuous ease, and the adventurers are forced into a humiliating retreat as the Iron Yam continues his march toward the throne.`,
        potatoReward: 140000000,
        potatoPenalty: 0,
        workMultiReward: 3,
        passiveReward: 1500000,
        bankCapacityReward: 15000000,
        difficulty: 2500,
        // Server-wide buff on a win — a starch cycle discount (buy -10%, sell +10%). Real
        // starch_buy already ranges ~9,500-10,999 (~14.6% band) day to day, so 10% is a
        // real, felt discount without beating the best organic roll; also lands at the low
        // end of the existing starchSellBonusPercent companion ladder (Mole 9% / Rootcarver
        // 12% / Elder Rootbeard 15%) rather than matching or beating Elder Rootbeard's
        // Mythic-tier value. See systems/raids-and-world-events.md#server-wide-buff.
        buff: { type: "starchDiscount", value: 0.10 }
    }
]
// Mochi, the Undying Stray previously lived here as a world boss (difficulty 1500,
// between Brassica and Griseous/Raikon) — moved to roadmap.md's planned companion system
// instead, as a top-tier companion rather than a raid target. Its established flavor
// (zombie cat, graveyard, headpats) fit a "joins you" companion far better than a "fight
// it" world boss, and the character carries over rather than being retired outright.

module.exports = {
    worldFactory,
    worldBossMobs,
    WORLD_BUFF_DURATION_SECONDS
}