const dynamoHandler = require("../../utils/dynamoHandler");
const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles, Raid, metalKingRaidBoss, regularStatRaidMobs, GuildHistory } = require("../../utils/constants")
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval, requireUserDetails, requireUserGuild, buildConfirmCancelRow } = require("../../utils/helperCommands")
const { RaidFactory, getRaidLevelInfo, getMinGuildLevelForTier, getLiveRaidRoster, getGuildLevelClosestToWins, getEligibleScenarios, getEffectiveRaidPower } = require("../../utils/raidFactory");
const companionFactory = require("../../utils/companionFactory");
const guildBuffFactory = require("../../utils/guildBuffFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();

const regularRaidMobs = [
    [
        {
            name: "Celerity, the Swift Stalk",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198683921672589363/celerity.png?ex=65bfcc65&is=65ad5765&hm=68e1484d6b97fa790c14950998de10cf5527abe766c90e53bd0a39f8d43ebb90&",
            description: `Journeying through the Verdant Forests of the Potato Kingdom, the potato adventurers reach the clearing of Celerity, the Swift Stalk. They pursue their target, a celery stick infused with the essence of unparalleled speed, in a high-paced raid laden with rushing vines. The party\'s agility and coordination will be tested as they aim to claim victory over this fleet-footed foe.`,
            successDescription: 'With synchronized precision, the brave warriors strategically servers Celerity\'s roots, halting its lightning-speed assaults and claiming triumph over the Swift Stalk.',
            failureDescription: 'Overwhelmed by the relentless barrage of swift strikes, the adventurers succumb to Celerity\'s lightning-fast onslaught, leaving the forest engulfed in the echoes of their unsuccessful struggle.',
            credit: 'Inspired by Moonwave'
        },
        {
            name: "Baron Durianwrath, the Aromatic Abomination",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1198039614112399542/image.png?ex=65bd7456&is=65aaff56&hm=4a1bca2d540e14b0c2258bcb6a4b5ca6ddb9289d8221bc4fb5294df98e62247e&",
            description: `Venturing deep into the dimly lit caverns below the Potato Kingdom, the spud adventurers encounter Baron Durianwrath! The Baron, infused with the essence of foul-smelling durians, offers the heroes a daunting challenge as the air thickens with a pungent aroma. The party must navigate the cavernous battleground carefully by dodging Durianwrath\s explosive attacks and dispatching his nefarious minions if they hope to emerge victoriously from this aromatic raid.`,
            successDescription: 'The courageous raiders withstand the overwhelming stench long enough to overcome Baron Durianwrath by prioritizing his minions. They deliver a decisive blow and purge the Aromatic Abomination from the depths of the kingdom… for now.',
            failureDescription: 'The party is overwhelmed by the potent combination of odor and destructive force unleashed by the Baron and his minions. They succumb to the noxious fumes and explosive durian attacks, falling one by one.',
            credit: 'Inspired by Moonwave'
        }
    ],
    [
        {
            name: "Scallionshade, the Shadowy Scion",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607716355706971/kawaii-smiling-leek-vegetable-cartoon-illustration-spring-onions-on-color-background-smiling-leek-vegetable-cartoon-illustration-free-vector.png?ex=661331d7&is=6600bcd7&hm=3815e4de70195853ef982e0194b758fbd0f8fab0200adc5cb126d92bfce8c099&",
            description: `Scallionshade, the Shadowy Scion, haunts a once peaceful village located in the Potato Kingdom's outskirts. Answering the call of the village's fearful residents, the kingdom's heroes venture out to liberate it from his shadowy grasp. Their arrival triggers the emergence of the scion himself: a mysterious figure obscured by shadows that dance around him like wisps of smoke.`,
            successDescription: 'The potato adventurers beat back Scallionshade\'s dark forces and neutralize his shadowy minions. His influence begins to wane, and the dark veil that the scion once cast is lifted from the village. As their weakened foe recoils in the sunlight, the party lands a decisive blow that sends Scallionshade back into the obscurity of the beyond.',
            failureDescription: 'Try as they might, the potato adventurers are ultimately suffocated by Scallionshade\'s darkness. The heroes\' and villagers\' souls alike succumb to the embrace of his shadows, and his veil of darkness begins to spread further beyond the walls of the wailing village.',
            credit: 'Made by Beggar'
        }
    ],
    [
        {
            name: "Garlicore, the Pungent Pilferer",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607411710689280/dacedaaa-00fe-11ee-8c31-f23c938336bc-9759-0.png?ex=6613318f&is=6600bc8f&hm=da68c0239e8813f999453ac161974cbc47c4485c8e6a7c2a92b177732fb8eaee&",
            description: `The economic equilibrium of the potato kingdom is threatened by Garlicore, a bulbous vegetable thief known throughout the criminal underworld. Making a name for himself as the “Pungent Pilferer,” Garlicore exercises his overpowering fragrance to incapacitate his opposition. Not particularly skilled in combat himself, he relies on hired hands to ensure his dark dealings continue unimpeded.`,
            successDescription: 'The potato adventurers infiltrate Garlicore\'s hideout, leading to a scuffle with his stenchy henchmen. Realizing his subordinates are no match for the heroes, he begins to flee. However, with speedy precision, the party braves the Pungent Pilferer\'s stench, apprehending him and delivering him to justice.',
            failureDescription: 'The potato adventurers\' infiltration mission takes an unfortunate turn when they\'re discovered and captured by Garlicore\'s underlings. The boss himself emerges from his lair, saturating the air with his unmistakable scent. The party\'s consciousness begins to fade, and it\'s only after they awaken that they realize their belongings have been pilfered by their putrid foe.',
            credit: 'Made by Beggar'
        }
    ],
    // Tier 4 — the ultra-late-game bracket, index [3]. thumbnailUrl is a placeholder
    // (the bot's own generic avatar, same fallback already used for Brassica/Yamsalot
    // in worldFactory.js) until real commissioned artwork exists.
    [
        {
            name: "Marrowveil, the Sovereign Squash",
            thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
            description: `Deep within a walled royal garden long thought abandoned, a butternut squash swollen with stolen magic has crowned itself sovereign: Marrowveil, the Sovereign Squash. Once an ordinary crop tended by the Kingdom's gardeners, it gorged itself on runoff from a buried ley line until its rind hardened into gilded armor and its vines grew long enough to strangle a throne room. It now holds court over a small army of loyal root vegetables, demanding tribute from every farmer who passes its garden walls. The adventurers who've handled every other troublemaker in the Kingdom are the only ones bold — or foolish — enough to challenge a squash that thinks it's a king.`,
            successDescription: 'Marrowveil\'s loyal root-vegetable court scatters the moment its gilded rind finally cracks open, the stolen ley-line magic hissing out in a burst of golden light. Stripped of its borrowed power, the Sovereign Squash rolls pathetically back into its garden bed, muttering about an eventual return to the throne. The adventurers, still faintly sticky with squash pulp, call it a win.',
            failureDescription: 'Marrowveil\'s vines prove sturdier than anyone expected, snaring the party one by one as its root-vegetable court jeers from the garden walls. Humbled and thoroughly out-squashed, the adventurers retreat to lick their wounds, while Marrowveil settles back onto its throne of stolen dirt, more insufferably regal than ever.'
        }
    ]
]

const eliteRaidMobs = [
    [
        {
            name: "Scarlet, the Strawberry Seraph",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607252868206642/cefb8ca7615585269517650efddcfe7c.png?ex=66133169&is=6600bc69&hm=9a30d618ada308ee125e11320fee4f1042e2fdd8d953295ba1104aee49508dde&",
            description: `The majestic Strawberry Seraph, Scarlet, is said to exist within the vegetable realm to answer for the wrongdoings of the Sinister Strawberries. Though not an enemy of the kingdom, she offers adventurers the opportunity to test themselves against her. Sporting a regal attitude, potent fruity magic, and wings of crimson, this celestial being offers a considerable reward to those who can best her in combat.`,
            successDescription: 'The adventurers\' coordination allows them to halt Scarlet\'s flight with a staggering blow. They ward off her spells and subdue the Strawberry Seraph, leaving her no choice but to begrudgingly surrender. As the party boasts of their decisive victory, Scarlet contends that they simply got lucky this time around.',
            failureDescription: 'The Strawberry Seraph\'s agility and magic prove too overbearing for the party to manage. They suffer a rather embarrassing defeat in front of the other adventurers, and Scarlet jeers that heroes these days must be getting too soft.',
            credit: 'Made by Beggar'
        }
    ],
    [
        {
            name: "Basilbane, the Herbaceous Harbinger",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1205682852172271727/baycil.png?ex=65d942a8&is=65c6cda8&hm=499bab1149a7948b3811db877a628775b9a9a4725cc1382fa14571281575baa7&",
            description: `In the twisted jungles beyond the Potato Kingdom grows the Herbaceous Harbinger, Basilbane. Standing as a colossal basil plant adorned with twisting vines and eerily vibrant leaves, this formidable foe harnesses the power of nature. It unleashes entangling vines, toxic spores, and a pervasive herbal aura that challenges even the bravest of the Potato Kingdom\'s adventurers.`,
            successDescription: 'The potato adventurers combine their herbal expertise with keen tactics to counter Basilbane\'s botanical onslaught, plucking the Herbaceous Harbinger from its roots and restoring balance to the jungle.',
            failureDescription: 'The spud adventurers are overwhelmed by the entangling vines and toxic spores unleashed by Basilbane. As its heroes succumb to an agricultural onslaught, the Potato Kingdom edges closer to a dominion under the Herbaceous Harbinger.',
            credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
        }
    ],
    [
        {
            name: "Evertart, the Blighted Bitterblade",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221607142352621680/main-qimg-24a1dffefd5f8458caf079ad72ef15d4-lq.png?ex=6613314f&is=6600bc4f&hm=ede01984f3d4b0bafe8ea2790adfe83f4e7e01613b306d96ad7d2d24f4b3dcae&",
            description: `Travelers rumor of a ruthless fruit fully clad in a tough, bitter melon rind armor. They say he bears a gnarly blade exuding an aura of overwhelming malice, and his arrival heralds blight and decay. To assuage the growing grief of the kingdom's residents, the adventurers set out to put an end to this enigmatic figure's streak of woe.`,
            successDescription: 'Tracking him by his wake of corruption, the party comes face-to-face with Evertart, the Bitterblade. The heroes cut past his accursed blade and deliver a seemingly-fatal stab through his sordid figure, only for it to vanish into the air. Though he was surely vanquished, faint whispers persist of the wraithlike Bitterblade\'s supposed return…',
            failureDescription: 'Tracking him by his wake of corruption, the party comes face-to-face with Evertart, the Bitterblade. They\'re stunned by the malicious enchantments echoing from his blade, and are brutally beaten by an onslaught of steel and spellcraft. As the heroes lie broken in his wake, Evertart continues to wreak blight and havoc throughout the realm.',
            credit: 'Made by Beggar'
        }
    ],
    // Tier 4 — placeholder thumbnail, same reasoning as regularRaidMobs' T4 entry above.
    [
        {
            name: "Solara, the Sunpeach Sovereign",
            thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
            description: `In the highest boughs of an orchard no living gardener ever planted, Solara, the Sunpeach Sovereign, has ripened into something far beyond an ordinary peach tree spirit. Elder to Scarlet, Basilbane, and Evertart alike — some whisper she raised each of them from seedlings — Solara radiates a warmth potent enough to wilt steel and a fragrance that lulls even hardened adventurers into false security. She does not attack so much as overwhelm, her orchard blooming and withering in the same breath as she tests whether a party is truly ready to stand among the Kingdom's elite.`,
            successDescription: 'The party pushes through Solara\'s disorienting fragrance and lands a coordinated strike at the heart of her orchard, severing the roots that anchor her power. The Sunpeach Sovereign\'s radiant bloom dims to a gentle glow, and she withdraws into dormancy, murmuring that few have ever earned the right to call themselves elite — but they have.',
            failureDescription: 'Solara\'s fragrance proves too much, and the party stumbles through her blooming orchard in a daze, easy prey for her thorned branches. She doesn\'t gloat — she simply lets her orchard fold back around her, unbothered, as the humbled adventurers retreat to reconsider whether "elite" was ever the right word for them.'
        }
    ]
]

const legendaryRaidMobs = [
    [
        {
            name: "Gourdor, the Pumpkin Knight",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221606969618600018/dgbnu01-7f36e865-7ecd-490b-885a-0400daa36655.png?ex=66133125&is=6600bc25&hm=72d0d36cfed52d777e96c65e91b5e5b364de42b8bb67490c8caaabf0639b0b01&",
            description: `The Pumpkin Knight Gourdor was once a celebrated hero and champion of a neighboring kingdom's army. This once noble figure has been resurrected by evil energies, and he now gallops throughout the realm as a malevolent entity draped in twisted pumpkin vines. Brandishing a twisted, sinister blade forged from the darkest gourd, he seeks to sow chaos with his wicked powers.`,
            successDescription: 'The potato adventurers brave Gourdor\'s swarm of minions and madness, facing off against the Pumpkin Knight himself. Outclassed in one-on-one combat, the party relies on their numbers to triumph over the once proud knight. Though his weary soul may momentarily rest, the wicked powers that reanimated Gourdor still persist beyond the far reaches of the realm…',
            failureDescription: 'The party cannot hope to match Gourdor\'s fiendish powers, nor his martial prowess. They\'re swarmed by his malevolent munchkin pumpkins, allowing him to reap their souls with little effort. After humiliating the Potato Kingdom\'s finest, Gourdor continues to propagate discord throughout the realm unabated.',
            credit: 'Made by Beggar'
        }
    ],
    [
        {
            name: "Netherfig, the Abyssal Figwraith",
            thumbnailUrl: "https://media.discordapp.net/attachments/221456693127675904/1201738231243341885/plant.png?ex=65cae8f1&is=65b873f1&hm=44ed099acc8954ccd201e86299bebd47fcf660430fd54aae7e98f9df089aea5d&",
            description: `Not far from the Potato Kingdom, a great fissure erupts with the emergence of Netherfig, the Abyssal Figwraith. As it slithers from the depths draped in ethereal foliage, the Figwraith\'s baleful core pulsates with an eerily familiar dark energy. The potato adventurers set out to combat this insidious invader, whose sinister spells and horrifying hellspawn threaten to ensnare the realm and swallow it whole.`,
            successDescription: 'The heroes of the Potato Kingdom pierce Netherfig\'s abyssal veil of evil energy with unwavering resolve. Narrowly avoiding menacing minions, the party launches a full-force attack that ruptures the Figwraith\'s sinister core. Having suffered significant damage, Netherfig is banished back to the shadowy depths it emerged from.',
            failureDescription: 'The potato adventurers prove to be no match for the Figwraith\'s dark enchantments, relentless minions, and abyssal forces. Now unopposed, Netherfig continues to spread darkness and chaos throughout the realm. Left unchecked, it will plunge the world into a never-ending nightfall.',
            credit: 'Inspired by Moonwave, artwork by RednaxeIa and Charizard'
        },
        {
            name: "Behemoth Broccoli, the Green Guardian",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1198660167168962693/1198836128179032125/SPOILER_image.png?ex=65c05a26&is=65ade526&hm=ae08d9219546b86ef8a79e0de03c87ba36245c0cfdb302999da13bd05dbd3305&",
            description: `Despite their intentions, the heroes of the peaceful Potato Kingdom are not an objective good. Their wonton violence against innocent vegetables is answered by an immense being adorned with towering florets and leafy armor: Behemoth Broccoli. A primal entity tasked with safeguarding helpless vegetables, the Green Guardian awakens and emerges from the heart of the Verdant Forests to pass judgment.`,
            successDescription: 'Strategic teamwork and perseverance allow the spud heroes to defend against the Green Guardian\'s assault. Standing steadfast against the forces of nature, they dismantle Behemoth Broccoli\'s leafy defenses and strike at its core, where it is most vulnerable. Having been pushed back and sapped of its energy, the towering sentinel returns to its slumber deep within the Verdant Forests.',
            failureDescription: 'The spud heroes fail to break through the Behemoth\'s resilient defenses. They fall victim to primordial punishment, dropping one by one to its potent vegetable magic and formidable might. Though the Potato Kingdom suffers a significant thrashing, the Green Guardian leaves it standing and returns to the Verdant Forests to keep watch for any adventurer daring enough to harm another vegetable.',
            credit: 'Inspired by Zoodbarg'
        }
    ],
    [
        {
            name: "Radishrend, the Root Reaper",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/1187561420406136843/1221606879978061854/illustration-of-evil-radish-mascot-character-free-vector.png?ex=66133110&is=6600bc10&hm=804ab41db2a44b15fdd46b98ab75da68f1edc152829bfeaa4a04e508da3e5d96&",
            description: `A physical personification of death itself, Radishrend is a primal force of evil. Like other great dangers to the kingdom, the Root Reaper's wicked powers are likely fueled by the Spud Entity. Yet his heinous tragedies precede even the void's emergence, and he needs no excuse to spread suffering with the swing of his radish-stemmed scythe.`,
            successDescription: 'As the Root Reaper\'s ghostly visage materializes before the potato adventurers, they steel their resolve for the ultimate showdown. Valiantly safeguarding their beloved kingdom, the party casts Radishrend away with their strongest weapons and most potent magic. Though momentarily vanquished, the reaper subsides into the beyond in preparation for yet another harvest of souls.',
            failureDescription: 'As the Root Reaper\'s ghostly visage materializes before the potato adventurers, they steel their resolve for the ultimate showdown. His hordes of undead vegetables overwhelm the heroes, and not even their finest fighters can find an opening in Radishrend\'s front. With his opposition occupied, the reaper continues unimpeded, harvesting soul after soul from the once peaceful kingdom.',
            credit: 'Made by Beggar'
        }
    ],
    // Tier 4 — the true capstone of the Legendary track, ties directly into the "Spud
    // Entity" lore Radishrend's own description already seeds ("likely fueled by the
    // Spud Entity"). Deliberately a herald/vessel rather than the Entity fully unveiled,
    // leaving room for a future standalone raid to be the actual reveal. Placeholder
    // thumbnail, same reasoning as the other two T4 entries above.
    [
        {
            name: "Umbrathorn, the Withered Vessel",
            thumbnailUrl: "https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png",
            description: `Where Gourdor was reanimated, Netherfig emerged from a fissure, and Radishrend called itself death's own hand, none of them were ever the true source — only fragments cast off by something far older. Umbrathorn, the Withered Vessel, is the closest anyone has come to standing before the Spud Entity itself: a hollowed potato husk, ancient beyond record, animated by a sliver of the Entity's own essence and wreathed in the same dark energy that spawned every horror the Kingdom's heroes have ever faced. It does not challenge adventurers so much as judge them, deciding in an instant whether they're worth destroying personally or leaving for lesser threats. Few parties who answer its summons return unchanged.`,
            successDescription: 'Against impossible odds, the party lands blow after blow against Umbrathorn\'s withered husk, each strike peeling back another layer of the Spud Entity\'s borrowed essence. With a final, kingdom-shaking shriek, the Vessel collapses into inert ash — but the sliver of dark energy it carried doesn\'t disperse so much as retreat, back toward whatever depths spawned it in the first place. The adventurers have won, but the unmistakable sense lingers that they\'ve only delayed the inevitable.',
            failureDescription: 'Umbrathorn\'s judgment is swift and merciless. The party\'s strongest blows pass through the Withered Vessel as though striking smoke, and the dark energy within answers with a wave of raw, ancient malice that leaves the heroes broken and scattered. The Vessel doesn\'t pursue — it doesn\'t need to. It simply returns to its slumber, patient in a way nothing mortal could ever be, certain the Kingdom\'s heroes will come again.'
        }
    ]
]

// Guild level at which T4 unlocks in every raid-select tier — derived from
// Raid.RAID_T4_MIN_LEVEL_TARGET_WINS (3,000) rather than hardcoded, so it tracks
// RaidLevel.THRESHOLDS if that curve ever changes. Resolves to level 8 today.
const T4_MIN_LEVEL = getGuildLevelClosestToWins(Raid.RAID_T4_MIN_LEVEL_TARGET_WINS);

function chooseMobFromList(mobList) {
    let random = Math.floor(Math.random() * mobList.length);
    const reward = mobList[random];
    return reward
}

function calculateRaidSuccessChance(totalMultiplier, raidDifficulty, maximumSuccessRate) {
    const totalRaidSuccessChance = totalMultiplier / raidDifficulty;
    const actualRaidSuccessChance = totalRaidSuccessChance > maximumSuccessRate ? maximumSuccessRate : totalRaidSuccessChance
    return actualRaidSuccessChance
}

// Drains as much of the penalty as the bank can actually cover instead of an
// all-or-nothing choice — previously a guild sitting just short of full coverage (e.g.
// 4,999,999 banked against a 5,000,000 penalty) got the exact same "members eat the
// entire penalty" outcome as a guild with an empty bank, instead of the bank absorbing
// almost all of it and members only covering the 1-potato shortfall.
async function removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost) {
    let raidSplit = null;
    if (guildBankStored + totalRaidCost >= 0) {
        guildBankStored += totalRaidCost;
        await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
    } else {
        const shortfall = totalRaidCost + guildBankStored; // still negative — what's left once the bank drains to 0
        if (guildBankStored > 0) {
            await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', 0);
        }
        raidSplit = await raidFactory.handlePotatoSplit(raidList, shortfall);
    }
    return raidSplit
}

// Same fix, mirrored for rewards: fills the bank up to capacity first, only spilling the
// excess that doesn't fit to members directly, instead of the whole reward bypassing the
// bank the moment it's even slightly larger than the remaining space.
async function addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit) {
    let raidSplit = null;
    if (remainingBankSpace >= totalRaidSplit) {
        guildBankStored += totalRaidSplit;
        await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
    } else {
        const excess = totalRaidSplit - remainingBankSpace; // what doesn't fit once the bank is topped off
        if (remainingBankSpace > 0) {
            guildBankStored += remainingBankSpace;
            await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
        }
        raidSplit = await raidFactory.handlePotatoSplit(raidList, excess);
    }
    return raidSplit
}

const regularRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.METAL_KING_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.METAL_KING_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.METAL_KING_MULTIPLIER_REWARD);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', Raid.METAL_KING_PASSIVE_REWARD);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', Raid.METAL_KING_CAPACITY_REWARD);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, Raid.METAL_KING_MULTIPLIER_REWARD, Raid.METAL_KING_PASSIVE_REWARD, Raid.METAL_KING_CAPACITY_REWARD);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        // Ultra-late-game bracket — see Raid.T4_RAID_DIFFICULTY's comment. Its own
        // dedicated boss lives at regularRaidMobs[3].
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const ultimateRaidMob = chooseMobFromList(regularRaidMobs[3]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T4_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T4_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = ultimateRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T4_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = ultimateRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, ultimateRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .03,
        minGuildLevel: T4_MIN_LEVEL
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(regularRaidMobs[2]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T3_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T3_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T3_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .08
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(regularRaidMobs[1]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T2_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T2_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T2_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .28
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(regularRaidMobs[0]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T1_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T1_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T1_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: 1
    }
]

// Softened 2026-08-23 (2 -> 1.5) alongside the T1-T3 DIFFICULTY_MULTIPLIER halving below,
// per balance-audit.md's guild-raid mode-breakeven pass — see that entry for the full
// derivation. Direct instruction: "soften penalties... it's ok if elite's starting
// difficulty is higher than regular's start" — the old 6x/4.5x/3x DIFFICULTY_MULTIPLIER
// combined with a 2x penalty premium meant a guild unlocking Elite right at Regular's own
// Lv3 breakeven point needed ~12.8x more roster power to break even on Elite, a cliff
// rather than a ramp. Halving DIFFICULTY_MULTIPLIER and softening this to 1.5 brings that
// down to ~4.6x — still clearly a harder mode, no longer a wall.
ELITE_PENALTY_INCREASE = 1.5;
const eliteRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            // Metal King previously paid the exact same reward at the exact same
            // difficulty regardless of tier, making Elite/Legendary strictly worse than
            // Regular for the identical 1% shot (lower success cap, nothing gained for
            // it). Scaled the same way T3 already is for this tier — bigger jackpot,
            // matching harder difficulty.
            const DIFFICULTY_MULTIPLIER = 3;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.METAL_KING_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            const workMultiReward = Raid.METAL_KING_MULTIPLIER_REWARD * DIFFICULTY_MULTIPLIER;
            const passiveReward = Raid.METAL_KING_PASSIVE_REWARD * DIFFICULTY_MULTIPLIER;
            const capacityReward = Raid.METAL_KING_CAPACITY_REWARD * DIFFICULTY_MULTIPLIER;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.METAL_KING_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', workMultiReward);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', passiveReward);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', capacityReward);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, workMultiReward, passiveReward, capacityReward);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 2;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const ultimateRaidMob = chooseMobFromList(eliteRaidMobs[3]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T4_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T4_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = ultimateRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T4_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER * ELITE_PENALTY_INCREASE);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = ultimateRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, ultimateRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .05,
        minGuildLevel: T4_MIN_LEVEL
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 1.5; // halved 2026-08-23, see ELITE_PENALTY_INCREASE's comment above
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(eliteRaidMobs[2]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T3_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T3_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T3_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER * ELITE_PENALTY_INCREASE);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .17
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 2.25; // halved 2026-08-23, see ELITE_PENALTY_INCREASE's comment above
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(eliteRaidMobs[1]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T2_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T2_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T2_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER * ELITE_PENALTY_INCREASE);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .55
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 3; // halved 2026-08-23, see ELITE_PENALTY_INCREASE's comment above
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(eliteRaidMobs[0]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T1_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T1_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T1_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER * ELITE_PENALTY_INCREASE);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: 1
    }
]

// Softened 2026-08-23 (3 -> 2) alongside the T1-T3 DIFFICULTY_MULTIPLIER halving below —
// same pass and reasoning as ELITE_PENALTY_INCREASE's comment above. Doesn't fully remove
// a structural property the old 3x tuning had, just eases it: breakeven success rate
// (penaltyMult / (1 + penaltyMult)) was 75% at 3x, above Legendary's own 60% success-rate
// cap — meaning raw roster power (totalMultiplier) alone could never make it profitable,
// only the guild-level-driven raidRewardMultiplier could, by boosting the reward side of
// the equation. At 2x the breakeven rate drops to ~66.7%, still above the 60% cap, so this
// is still true — Legendary still needs guild level to carry it into profitability, not
// roster power alone. That's fine: it's exactly what getMinGuildLevelForTier's existing
// gate already checks and enforces (unaffected by this change), and is arguably correct
// design for the top mode — the softening here is about how HARSH that requirement is
// (breakeven totalMultiplier at guild level 7-10, worked out in balance-audit.md), not
// about removing the "needs guild level, not just stats" property entirely.
LEGENDARY_PENALTY_INCREASE = 2;
const legendaryRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            // Same reasoning as the Elite Metal King branch — matches T3's multiplier
            // for this tier so Legendary is the best (and hardest) Metal King shot.
            const DIFFICULTY_MULTIPLIER = 6;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.METAL_KING_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            const workMultiReward = Raid.METAL_KING_MULTIPLIER_REWARD * DIFFICULTY_MULTIPLIER;
            const passiveReward = Raid.METAL_KING_PASSIVE_REWARD * DIFFICULTY_MULTIPLIER;
            const capacityReward = Raid.METAL_KING_CAPACITY_REWARD * DIFFICULTY_MULTIPLIER;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.METAL_KING_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', workMultiReward);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', passiveReward);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', capacityReward);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, workMultiReward, passiveReward, capacityReward);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 4;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const ultimateRaidMob = chooseMobFromList(legendaryRaidMobs[3]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T4_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T4_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = ultimateRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T4_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER * LEGENDARY_PENALTY_INCREASE);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = ultimateRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, ultimateRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .09,
        minGuildLevel: T4_MIN_LEVEL
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 3; // halved 2026-08-23, see LEGENDARY_PENALTY_INCREASE's comment above
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(legendaryRaidMobs[2]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T3_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T3_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T3_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER * LEGENDARY_PENALTY_INCREASE);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = hardRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .31
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 4; // halved 2026-08-23, see LEGENDARY_PENALTY_INCREASE's comment above
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(legendaryRaidMobs[1]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T2_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T2_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T2_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER * LEGENDARY_PENALTY_INCREASE);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = mediumRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .76
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const DIFFICULTY_MULTIPLIER = 5; // halved 2026-08-23, see LEGENDARY_PENALTY_INCREASE's comment above
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(legendaryRaidMobs[0]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T1_RAID_DIFFICULTY * DIFFICULTY_MULTIPLIER, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T1_RAID_REWARD * randomMultiplier * raidRewardMultiplier * DIFFICULTY_MULTIPLIER);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T1_RAID_PENALTY * randomMultiplier * DIFFICULTY_MULTIPLIER * LEGENDARY_PENALTY_INCREASE);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit);
                raidResultDescription = regularRaidMob.failureDescription;
            }
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription);
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: 1
    }
]

const statRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction) => {
            let raidSplit = 0, totalRaidSplit = 0, raidResultDescription;
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.METAL_KING_DIFFICULTY, Raid.MAXIMUM_STAT_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                let workMultiReward = Raid.METAL_KING_MULTIPLIER_REWARD * 2;
                let passiveReward = Raid.METAL_KING_PASSIVE_REWARD * 2;
                let bankReward = Raid.METAL_KING_CAPACITY_REWARD * 2;
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', workMultiReward);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', passiveReward);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', bankReward);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, workMultiReward, passiveReward, bankReward);
            } else {
                raidResultDescription = metalKingRaidBoss.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed], components: [] });
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction) => {
            let raidSplit, totalRaidCost, raidResultDescription;
            const regularStatRaidMob = chooseMobFromList(regularStatRaidMobs);
            totalRaidCost = Math.round(Raid.REGULAR_STAT_RAID_COST * raidList.length);
            raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost);

            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_STAT_RAID_DIFFICULTY, Raid.MAXIMUM_STAT_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.REGULAR_STAT_RAID_REWARD);
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                raidResultDescription = regularStatRaidMob.successDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidCost, raidSplit, regularStatRaidMob, successChance, raidResultDescription, Raid.REGULAR_STAT_RAID_REWARD);
            } else {
                raidResultDescription = regularStatRaidMob.failureDescription;
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidCost, raidSplit, regularStatRaidMob, successChance, raidResultDescription);
            }
            interaction.editReply({ embeds: [embed], components: [] });
        },
        chance: 1
    }
]

// Same shape a random ±20% roll would use, but for a preview we show the deterministic
// range instead of pre-rolling it.
function midRange(base) {
    return [Math.round(base * 0.8), Math.round(base * 1.2)];
}

// scenarios' .chance values are cumulative thresholds ([.01, .06, .26, 1] for regular,
// etc.) — converts them into the actual probability mass of each bracket ([.01, .05,
// .20, .74]) so the preview shows real odds instead of raw thresholds.
function bracketOdds(scenarios) {
    let previous = 0;
    return scenarios.map(scenario => {
        const odds = scenario.chance - previous;
        previous = scenario.chance;
        return odds;
    });
}

// Mirrors exactly what each raid-select's scenario table actually rolls against
// (calculateRaidSuccessChance, the same reward/penalty constants and multipliers), just
// without rolling — so the preview a player sees can't drift out of sync with the real
// outcome logic above.
function buildRaidPreview(raidSelection, totalMultiplier, raidRewardMultiplier, guildLevel) {
    if (raidSelection === 'stat') {
        const metalKingChance = calculateRaidSuccessChance(totalMultiplier, Raid.METAL_KING_DIFFICULTY, Raid.MAXIMUM_STAT_RAID_SUCCESS_RATE);
        const regularChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_STAT_RAID_DIFFICULTY, Raid.MAXIMUM_STAT_RAID_SUCCESS_RATE);
        const odds = bracketOdds(statRaidScenarios);
        return [
            {
                name: 'Metal King',
                odds: odds[0],
                successChance: metalKingChance,
                rewardText: `+${(Raid.METAL_KING_MULTIPLIER_REWARD * 2).toFixed(1)}x work multiplier, +${(Raid.METAL_KING_PASSIVE_REWARD * 2).toLocaleString()} passive, +${(Raid.METAL_KING_CAPACITY_REWARD * 2).toLocaleString()} bank capacity, all permanent`,
                penaltyText: `Nothing — this bracket costs nothing win or lose`,
            },
            {
                name: 'Standard Stat Raid',
                odds: odds[1],
                successChance: regularChance,
                rewardText: `+${Raid.REGULAR_STAT_RAID_REWARD.toFixed(1)}x work multiplier to every raider, permanent`,
                penaltyText: `Costs ${Math.abs(Raid.REGULAR_STAT_RAID_COST).toLocaleString()} potatoes per raider upfront — charged whether you win or lose`,
            }
        ];
    }

    const tierConfig = {
        regular: { scenarios: regularRaidScenarios, maxRate: Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE, mult: { t4: 1, t3: 1, t2: 1, t1: 1 }, penaltyMult: 1 },
        elite: { scenarios: eliteRaidScenarios, maxRate: Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE, mult: { t4: 2, t3: 3, t2: 4.5, t1: 6 }, penaltyMult: ELITE_PENALTY_INCREASE },
        legendary: { scenarios: legendaryRaidScenarios, maxRate: Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE, mult: { t4: 4, t3: 6, t2: 8, t1: 10 }, penaltyMult: LEGENDARY_PENALTY_INCREASE },
    }[raidSelection];

    // T4 isn't shown/rollable at all below its unlock level — see getEligibleScenarios.
    const eligibleScenarios = getEligibleScenarios(tierConfig.scenarios, guildLevel);
    const t4Unlocked = eligibleScenarios.length === tierConfig.scenarios.length;
    const odds = bracketOdds(eligibleScenarios);
    // Metal King scales with the same multiplier as this tier's T3 bracket — bigger
    // jackpot and permanent stats, matching harder difficulty, instead of the old flat
    // reward that made Elite/Legendary strictly worse than Regular for the same 1% shot.
    const metalKingMult = tierConfig.mult.t3;
    const brackets = [{
        name: 'Metal King',
        odds: odds[0],
        successChance: calculateRaidSuccessChance(totalMultiplier, Raid.METAL_KING_DIFFICULTY * metalKingMult, tierConfig.maxRate),
        rewardText: `+${Math.round(Raid.METAL_KING_REWARD * raidRewardMultiplier * metalKingMult).toLocaleString()} potatoes, plus permanent stats (${metalKingMult}x Work Multiplier/Passive/Bank Capacity rewards)`,
        penaltyText: `Nothing — this bracket costs nothing win or lose`,
    }];

    const tiers = [
        ...(t4Unlocked ? [{ key: 't4', label: 'Tier 4', reward: Raid.T4_RAID_REWARD, penalty: Raid.T4_RAID_PENALTY, difficulty: Raid.T4_RAID_DIFFICULTY }] : []),
        { key: 't3', label: 'Tier 3', reward: Raid.T3_RAID_REWARD, penalty: Raid.T3_RAID_PENALTY, difficulty: Raid.T3_RAID_DIFFICULTY },
        { key: 't2', label: 'Tier 2', reward: Raid.T2_RAID_REWARD, penalty: Raid.T2_RAID_PENALTY, difficulty: Raid.T2_RAID_DIFFICULTY },
        { key: 't1', label: 'Tier 1', reward: Raid.T1_RAID_REWARD, penalty: Raid.T1_RAID_PENALTY, difficulty: Raid.T1_RAID_DIFFICULTY },
    ];

    tiers.forEach((tier, index) => {
        const mult = tierConfig.mult[tier.key];
        const difficulty = tier.difficulty * mult;
        const successChance = calculateRaidSuccessChance(totalMultiplier, difficulty, tierConfig.maxRate);
        const [rewardMin, rewardMax] = midRange(tier.reward * mult * raidRewardMultiplier);
        const [penaltyMin, penaltyMax] = midRange(Math.abs(tier.penalty) * mult * tierConfig.penaltyMult);
        brackets.push({
            name: tier.label,
            odds: odds[index + 1],
            successChance,
            rewardText: `+${rewardMin.toLocaleString()} to ${rewardMax.toLocaleString()} potatoes`,
            penaltyText: `-${penaltyMin.toLocaleString()} to ${penaltyMax.toLocaleString()} potatoes`,
        });
    });

    return brackets;
}

module.exports = {
    name: "start-raid",
    description: "Starts a raid",
    deleted: false,
    options: [
        {
            name: 'raid-select',
            description: 'Which raid type to select',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'regular',
                    value: 'regular'
                },
                {
                    name: 'elite',
                    value: 'elite'
                },
                {
                    name: 'legendary',
                    value: 'legendary'
                },
                {
                    name: 'stat',
                    value: 'stat'
                }
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const raidSelection = interaction.options.get('raid-select')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to start the raid of!");
        if (!guild) return;
        const guildId = guild.guildId;
        const guildName = guild.guildName;
        const memberList = guild.memberList;
        const { level: guildLevel, multiplier: raidRewardMultiplier } = getRaidLevelInfo(guild.raidCount);

        // Elite/Legendary gated by guild level, not by how much totalMultiplier the
        // roster brings — below the derived level, the tier's success-rate cap sits
        // under its mathematical breakeven point (see getMinGuildLevelForTier), so no
        // amount of individual stat investment can make it profitable. Checked before
        // any raid-list/member work so a guild that can't unlock a tier finds out
        // immediately instead of after paying for member lookups.
        if (raidSelection === 'elite' || raidSelection === 'legendary') {
            const penaltyMult = raidSelection === 'elite' ? ELITE_PENALTY_INCREASE : LEGENDARY_PENALTY_INCREASE;
            const maxRate = raidSelection === 'elite' ? Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE : Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE;
            const requiredLevel = getMinGuildLevelForTier(penaltyMult, maxRate);
            if (guildLevel < requiredLevel) {
                interaction.editReply(`${userDisplayName}, ${raidSelection[0].toUpperCase()}${raidSelection.slice(1)} raids unlock at Guild Level ${requiredLevel} — below that, the difficulty cap means your guild would lose potatoes on average even with a perfect roster. Your guild is currently Level ${guildLevel}.`);
                return;
            }
        }

        let raidList = await getLiveRaidRoster(guild);
        let raidCount = guild.raidCount;
        const raidCountBeforeThisRaid = raidCount;
        let guildTotalEarnings = guild.totalEarnings;
        let guildBankStored = guild.bankStored;
        let guildBankCapacity = guild.bankCapacity;
        let remainingBankSpace = guildBankCapacity - guildBankStored;

        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before starting!`);
            return;
        }

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        let canStartRaids = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER || member.role == GuildRoles.ELDER;
        if (!canStartRaids) {
            interaction.editReply(`${userDisplayName} you must be an elder, co-leader, or the guild leader to start a raid!`);
            return;
        }

        const timeUntilRaidAvailableInMS = guild.raidTimer - Date.now()
        if (timeUntilRaidAvailableInMS > 0) {
            interaction.editReply(`${userDisplayName}, your guild has raided recently and must wait ${convertSecondstoMinutes(Math.floor(timeUntilRaidAvailableInMS / 1000))} before raiding again!`);
            return;
        }

        const raidMemberDetails = await Promise.all(raidList.map(element => dynamoHandler.findUser(element.id, element.username)));
        // Average per-member power (raw workMultiplierAmount + live rebirth bonus) plus
        // a headcount bonus for roster size — see raidFactory.js's getEffectiveRaidPower,
        // shared with currentRaid.js so the two commands never show conflicting numbers.
        let totalMultiplier = getEffectiveRaidPower(raidMemberDetails);

        // Firefly — whichever participant has the best guildRaidMultiplierPercent perk
        // active lifts the whole raid, same multiplicative shape as the guild raidMulti
        // buff. Takes the best rather than summing everyone's, so multiple members
        // equipping Firefly doesn't stack into an unintended snowball.
        const raidCompanionBoost = Math.max(0, ...raidMemberDetails.map(m => m ? companionFactory.getActivePerkValue(m, "guildRaidMultiplierPercent") : 0));
        if (raidCompanionBoost > 0) {
            totalMultiplier *= (1 + raidCompanionBoost);
        }

        // Which difficulty bracket (Metal King/T4/T3/T2/T1) gets rolled is random, so
        // show every bracket's odds and stakes up front — this commits the whole
        // roster's raid list on one roll, previously with zero preview of what that
        // meant. T4 is only shown once the guild's level has unlocked it.
        const brackets = buildRaidPreview(raidSelection, totalMultiplier, raidRewardMultiplier, guildLevel);
        const previewEmbed = embedFactory.createRaidPreviewEmbed(guildName, raidSelection, raidList.length, totalMultiplier, brackets, guildLevel, raidRewardMultiplier);
        const reply = await interaction.editReply({ embeds: [previewEmbed], components: [buildConfirmCancelRow('raid', 'Start the raid', 'Not yet')] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        if (!confirmation) {
            const cancelledEmbed = embedFactory.createRaidCancelledEmbed(guildName);
            await reply.edit({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
            return;
        }

        if (confirmation.customId === 'raid_cancel') {
            const cancelledEmbed = embedFactory.createRaidCancelledEmbed(guildName);
            await confirmation.update({ embeds: [cancelledEmbed], components: [] }).catch(() => {});
            return;
        }

        await confirmation.deferUpdate();

        const raidScenarioRoll = Math.random();
        let potatoesGained = 0;
        if (raidSelection == 'regular') {
            for (const scenario of getEligibleScenarios(regularRaidScenarios, guildLevel)) {
                if (raidScenarioRoll < scenario.chance) {
                    potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction);
                    break;
                }
            }
            guildTotalEarnings += potatoesGained;
            await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
        } else if (raidSelection == 'elite') {
            for (const scenario of getEligibleScenarios(eliteRaidScenarios, guildLevel)) {
                if (raidScenarioRoll < scenario.chance) {
                    potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction);
                    break;
                }
            }
            guildTotalEarnings += potatoesGained;
            await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
        } else if (raidSelection == 'legendary') {
            for (const scenario of getEligibleScenarios(legendaryRaidScenarios, guildLevel)) {
                if (raidScenarioRoll < scenario.chance) {
                    potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction);
                    break;
                }
            }
            guildTotalEarnings += potatoesGained;
            await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
        } else if (raidSelection == 'stat') {
            for (const scenario of statRaidScenarios) {
                if (raidScenarioRoll < scenario.chance) {
                    await scenario.action(guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction);
                    break;
                }
            }
        }

        // Win/loss is derived from a fresh re-fetch of raidCount rather than threading a
        // result object through all 14 scenario closures above — every winning closure
        // already increments and persists raidCount, so comparing against the value read
        // before this raid started is a reliable, much lower-risk signal than touching
        // each closure's return contract (which guildTotalEarnings math above depends on
        // staying a bare number).
        const freshGuild = await dynamoHandler.findGuildById(guildId);
        const wonThisRaid = Number.isFinite(freshGuild?.raidCount) && freshGuild.raidCount > raidCountBeforeThisRaid;
        const raidHistoryEntry = {
            timestamp: Date.now(),
            raidTier: raidSelection,
            won: wonThisRaid,
            potatoDelta: potatoesGained
        };
        const existingRaidHistory = Array.isArray(guild.raidHistory) ? guild.raidHistory : [];
        const newRaidHistory = [...existingRaidHistory, raidHistoryEntry].slice(-GuildHistory.MAX_ENTRIES);
        await dynamoHandler.updateGuildDatabase(guildId, 'raidHistory', newRaidHistory);

        guild.guildBuff == "raidTimer"
            ? await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now() + Raid.RAID_TIMER_SECONDS * 1000 - (Raid.RAID_TIMER_SECONDS * 1000 * guildBuffFactory.getGuildBuffValue("raidTimer", guildLevel)))
            : await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', Date.now() + Raid.RAID_TIMER_SECONDS * 1000);

        // No raidList to clear anymore — the roster is computed live from each member's
        // persistent autoJoinRaids toggle (getLiveRaidRoster), not a stored array, so
        // whoever's still opted in stays opted in for the next raid automatically.
    }
}