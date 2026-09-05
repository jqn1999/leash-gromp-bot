const dynamoHandler = require("../../utils/dynamoHandler");
const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles, Raid, metalKingRaidBoss, regularStatRaidMobs, GuildHistory, SpudKeep, GuildCompanions, Work } = require("../../utils/constants")
const { convertSecondstoMinutes, getUserInteractionDetails, getRandomFromInterval, requireUserDetails, requireUserGuild, buildConfirmCancelRow } = require("../../utils/helperCommands")
const { RaidFactory, getRaidLevelInfo, getMinGuildLevelForTier, getLiveRaidRoster, getGuildLevelClosestToWins, getWeightedScenarios, getEffectiveRaidPower, getMemberRaidPower } = require("../../utils/raidFactory");
const { getWorldBuffWorkMultiPercent } = require("../../utils/workFactory");
const companionFactory = require("../../utils/companionFactory");
const guildBuffFactory = require("../../utils/guildBuffFactory");
const guildCompanionFactory = require("../../utils/guildCompanionFactory");
const cooldownFactory = require("../../utils/cooldownFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();
const spudKeepFactory = require("../../utils/spudKeepFactory");

// isChainedReply distinguishes the original /start-raid (or /current-raid button) invocation
// (edits the deferred reply, clearing the confirm buttons) from an auto-chained extra
// attempt triggered by a cooldown skip (see resolveRaid below) — a chained result is always
// a brand new message via followUp, mirroring work.js's sendWorkResult/performWork and
// takeBounty.js's sendBountyResult/runBountyAttempt convention exactly.
async function sendRaidResult(interaction, embed, isChainedReply = false) {
    if (isChainedReply) {
        try {
            await interaction.followUp({ embeds: [embed] });
        } catch (err) {
            console.log(`startRaid.js chained reply failed: ${err}`);
        }
        return;
    }
    try {
        await interaction.editReply({ embeds: [embed], components: [] });
    } catch (err) {
        console.log(`startRaid.js editReply failed, falling back to followUp: ${err}`);
        await interaction.followUp({ embeds: [embed] }).catch(() => {});
    }
}

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
    // Tier 4 — the ultra-late-game bracket, index [3].
    [
        {
            name: "Marrowveil, the Sovereign Squash",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543699288058757120/UT0.png?ex=6a95d17e&is=6a947ffe&hm=0101484da18e8f07aae92e4062e2d1450e399e5ba57860d45dfaeeeedc4f521b&",
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
    // Tier 4.
    [
        {
            name: "Solara, the Sunpeach Sovereign",
            thumbnailUrl: "https://cdn.discordapp.com/attachments/533073599435636739/1543699381134430288/anBn.png?ex=6a95d195&is=6a948015&hm=b0ea7a5cea425ea0dffec264abcf0ef35447cd4bb3da2e0ee5a28c2095015105&",
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
    // leaving room for a future standalone raid to be the actual reveal. thumbnailUrl is
    // still a placeholder (the bot's own generic avatar) pending real commissioned art —
    // Marrowveil/Solara above got real art 2026-08-30, this one hasn't yet.
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
// raidSplitMode/raidListByMulti: the guild's opt-in reward-split toggle (see
// setRaidSplit.js/guild.raidSplitMode) and the pre-built per-member raw-power roster
// handlePotatoSplitByShare needs — only consulted at the "what doesn't fit in the bank,
// split it among members" branch below; the bank-first absorption logic above it is
// completely unchanged. Both default to the even-split path so statRaidScenarios (which
// deliberately always passes 'even', [] explicitly — see its own comment) and any other
// caller that hasn't been updated still gets today's behavior.
// sacrificeOffer (new, optional, default null — same "default to old behavior" precedent
// as raidSplitMode/raidListByMulti/houseUserId above): { interaction, starterUserId,
// guildCompanion } captured once near the top of runStartRaidFlow — see systems/guilds.md's
// "Guild Raid Companion" design, section 7. Only ever passed by the 4 win/loss call sites
// (baby/regular/elite/legendary) on an actual loss (totalRaidCost < 0) — statRaidScenarios'
// own call is an unconditional flat buy-in charged win-or-lose, never a loss penalty, and
// deliberately never passes this.
async function removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost, raidSplitMode = 'even', raidListByMulti = [], sacrificeOffer = null) {
    if (sacrificeOffer && sacrificeOffer.guildCompanion != null && totalRaidCost < 0) {
        const accepted = await promptCompanionSacrifice(sacrificeOffer);
        if (accepted) {
            await dynamoHandler.updateGuildDatabase(guildId, 'guildCompanion', null);
            return 'sacrificed';   // sentinel — never collides with a real raidSplit (always an array or null)
        }
    }
    let raidSplit = null;
    if (guildBankStored + totalRaidCost >= 0) {
        guildBankStored += totalRaidCost;
        await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', guildBankStored);
    } else {
        const shortfall = totalRaidCost + guildBankStored; // still negative — what's left once the bank drains to 0
        if (guildBankStored > 0) {
            await dynamoHandler.updateGuildDatabase(guildId, 'bankStored', 0);
        }
        raidSplit = raidSplitMode === 'share'
            ? await raidFactory.handlePotatoSplitByShare(raidListByMulti, shortfall)
            : await raidFactory.handlePotatoSplit(raidList, shortfall);
    }
    return raidSplit
}

// Prompts the raid-starting member (sacrificeOffer.starterUserId) to sacrifice Cinderroot,
// the Hoardwarden to void this loss's entire potato penalty — see systems/guilds.md's
// "Guild Raid Companion" design, section 7. Mirrors the exact pattern the raid-start
// confirm/cancel prompt above uses (buildConfirmCancelRow, awaitMessageComponent with a
// 30-second window, default-to-decline-on-timeout via .catch(() => null)). Lives here
// rather than guildCompanionFactory.js since it needs ButtonBuilder/awaitMessageComponent/
// embedFactory — no existing factory file touches Discord.js primitives.
async function promptCompanionSacrifice({ interaction, starterUserId }) {
    const promptEmbed = embedFactory.createGuildCompanionSacrificePromptEmbed();
    const promptRow = buildConfirmCancelRow('cinderroot_sacrifice', 'Sacrifice Cinderroot', 'Take the loss');
    const promptMessage = await interaction.followUp({ embeds: [promptEmbed], components: [promptRow], ephemeral: true }).catch(() => null);
    if (!promptMessage) return false;

    const filter = i => i.user.id === starterUserId;   // the raid-starting member — same identity
                                                         // already gated on at the raid-start collectorFilter
    const choice = await promptMessage.awaitMessageComponent({ filter, time: 30_000 }).catch(() => null);
    if (!choice || choice.customId === 'cinderroot_sacrifice_cancel') {
        if (choice) await choice.update({ content: 'Cinderroot stays coiled around the hoard — the loss is paid in full.', embeds: [], components: [] }).catch(() => {});
        return false;   // decline or timeout: identical outcome, normal penalty applies
    }
    await choice.update({ embeds: [embedFactory.createGuildCompanionSacrificeResultEmbed()], components: [] }).catch(() => {});
    return true;
}

// Same fix, mirrored for rewards: fills the bank up to capacity first, only spilling the
// excess that doesn't fit to members directly, instead of the whole reward bypassing the
// bank the moment it's even slightly larger than the remaining space.
// A guild on raidPayoutMode: 'direct' (see setRaidPayout.js) is handled entirely by its
// caller passing remainingBankSpace: 0 in — that alone forces every reward through the
// "excess" branch below with excess == the full reward, so this function itself needs no
// separate direct-mode branch or parameter.
// houseUserId (new 2026-08-30, direct instruction — "a new 5% tax on guild raids that
// goes to the bot"): optional so any caller that hasn't passed it degrades to untaxed
// rather than crashing, same "default to old behavior" precedent raidSplitMode/
// raidListByMulti already set right above. Every real call site passes
// interaction.client.user.id — see the win-branch scenarios below.
async function addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode = 'even', raidListByMulti = [], houseUserId = null) {
    // Raid.GUILD_RAID_TAX_PERCENT — taken off the top of the raid's total reward before
    // bank/split accounting, same "recipients net less, house gets the rest" shape every
    // other tax in this game already uses (see Bank.TAX_PERCENT/Give.POTATO_TAX_PERCENT/
    // Starch.SELL_TAX_PERCENT). Applied here rather than inside each of the ~15 individual
    // scenario closures above, since they all already funnel their reward through this one
    // shared function.
    if (houseUserId) {
        const raidTax = Math.floor(totalRaidSplit * Raid.GUILD_RAID_TAX_PERCENT);
        if (raidTax > 0) {
            // Spud Keep (systems/spud-keep.md) — while a holder is live, a share of this
            // tax is redirected to the accruing pot instead of the house account; a
            // no-op (100% to the house, byte-identical to before) whenever no holder is live.
            const { houseAmount, potAmount } = await spudKeepFactory.splitTaxForSpudKeepPot(raidTax);
            await dynamoHandler.addUserDatabase(houseUserId, 'potatoes', houseAmount);
            await spudKeepFactory.creditSpudKeepPot(potAmount);
            totalRaidSplit -= raidTax;
        }
    }
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
        raidSplit = raidSplitMode === 'share'
            ? await raidFactory.handlePotatoSplitByShare(raidListByMulti, excess)
            : await raidFactory.handlePotatoSplit(raidList, excess);
    }
    return raidSplit
}

const regularRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.METAL_KING_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.METAL_KING_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.METAL_KING_MULTIPLIER_REWARD);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', Raid.METAL_KING_PASSIVE_REWARD);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', Raid.METAL_KING_CAPACITY_REWARD);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, Raid.METAL_KING_MULTIPLIER_REWARD, Raid.METAL_KING_PASSIVE_REWARD, Raid.METAL_KING_CAPACITY_REWARD, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            }
            await sendResult(embed);
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        // Ultra-late-game bracket — see Raid.T4_RAID_DIFFICULTY's comment. Its own
        // dedicated boss lives at regularRaidMobs[3].
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const ultimateRaidMob = chooseMobFromList(regularRaidMobs[3]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T4_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T4_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = ultimateRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T4_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${ultimateRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = ultimateRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, ultimateRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial now — getWeightedScenarios (see runStartRaidFlow/
        // buildRaidPreview below) computes a fresh cumulative chance for every T1-T4
        // bracket from `difficulty` and the roster's own totalMultiplier at roll time.
        // Kept in place rather than deleted, same "superseded but correct" convention
        // DIFFICULTY_MULTIPLIER's removal already established.
        chance: .03,
        minGuildLevel: T4_MIN_LEVEL,
        difficulty: Raid.T4_RAID_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(regularRaidMobs[2]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T3_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T3_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T3_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${hardRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = hardRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see the T4 entry's comment above.
        chance: .08,
        difficulty: Raid.T3_RAID_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(regularRaidMobs[1]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T2_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T2_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T2_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${mediumRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = mediumRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see the T4 entry's comment above.
        chance: .28,
        difficulty: Raid.T2_RAID_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(regularRaidMobs[0]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T1_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.T1_RAID_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.T1_RAID_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${regularRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = regularRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see the T4 entry's comment above.
        chance: 1,
        difficulty: Raid.T1_RAID_DIFFICULTY
    }
]

// Baby tier: a fifth raid-select option that always resolves to the exact same Tier 1
// bracket regularRaidScenarios' own last entry does (same mob table, same
// Raid.T1_RAID_REWARD/PENALTY/DIFFICULTY) — reusing that entry directly rather than a
// second copy, so baby can never drift out of sync with Regular's own T1 tuning. The only
// difference from picking Regular and getting lucky is that here it's guaranteed: no
// chance of instead rolling into Regular's far rarer but much harder Metal King/T4/T3/T2
// brackets. Meant as a safe on-ramp for a guild too weak to gamble on Regular's full table
// — grind guaranteed T1 wins toward raid level first, then graduate to Regular once the
// roster can stomach an occasional T2/T3 roll.
const babyRaidScenarios = [regularRaidScenarios[regularRaidScenarios.length - 1]];

// Static per-bracket difficulty/reward/penalty redesign (2026-08-26) — replaces the old
// DIFFICULTY_MULTIPLIER indirection (a single per-tier number scaling Regular's own
// T1-T4/Metal King constants at runtime) entirely. Every bracket below now reads its own
// independently-chosen Raid.ELITE_* constant directly; see constants.js's own comment on
// the ELITE_T1_DIFFICULTY block for the full geometric-ladder derivation (ratio r =
// 2^(1/4), spanning Regular's own T4 through Legendary's own T4) and the balance-audit.md
// entry for the worked cliff-vs-ramp comparison this was built to fix. The old 2026-08-23
// halving pass (DIFFICULTY_MULTIPLIER 6x/4.5x/3x -> 3x/2.25x/1.5x) is now moot — there's no
// runtime multiplier left to halve, the static constants already have that history baked
// in via the ladder anchoring.
// ELITE_PENALTY_INCREASE still lives in constants.js's Raid object, but is no longer read
// anywhere in this file — every bracket's penalty is a static constant with the ratio
// already applied. It remains load-bearing for getMinGuildLevelForTier's gate math only
// (see runStartRaidFlow below and raidFactory.js's getUnlockedRaidModes).
const eliteRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.ELITE_METAL_KING_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            const workMultiReward = Raid.ELITE_METAL_KING_MULTIPLIER_REWARD;
            const passiveReward = Raid.ELITE_METAL_KING_PASSIVE_REWARD;
            const capacityReward = Raid.ELITE_METAL_KING_CAPACITY_REWARD;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.ELITE_METAL_KING_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', workMultiReward);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', passiveReward);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', capacityReward);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, workMultiReward, passiveReward, capacityReward, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            }
            await sendResult(embed);
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const ultimateRaidMob = chooseMobFromList(eliteRaidMobs[3]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.ELITE_T4_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.ELITE_T4_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = ultimateRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.ELITE_T4_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${ultimateRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = ultimateRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, ultimateRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see regularRaidScenarios' T4 entry's comment above.
        chance: .05,
        minGuildLevel: T4_MIN_LEVEL,
        difficulty: Raid.ELITE_T4_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(eliteRaidMobs[2]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.ELITE_T3_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.ELITE_T3_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.ELITE_T3_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${hardRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = hardRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see regularRaidScenarios' T4 entry's comment above.
        chance: .17,
        difficulty: Raid.ELITE_T3_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(eliteRaidMobs[1]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.ELITE_T2_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.ELITE_T2_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.ELITE_T2_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${mediumRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = mediumRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see regularRaidScenarios' T4 entry's comment above.
        chance: .55,
        difficulty: Raid.ELITE_T2_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(eliteRaidMobs[0]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.ELITE_T1_DIFFICULTY, Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.ELITE_T1_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.ELITE_T1_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${regularRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = regularRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see regularRaidScenarios' T4 entry's comment above.
        chance: 1,
        difficulty: Raid.ELITE_T1_DIFFICULTY
    }
]

// Static per-bracket difficulty/reward/penalty redesign (2026-08-26) — same rework as
// eliteRaidScenarios above; see that block's comment and constants.js's own comment on the
// ELITE_T1_DIFFICULTY block for the full derivation. LEGENDARY_PENALTY_INCREASE still lives
// in constants.js's Raid object but, like ELITE_PENALTY_INCREASE, is no longer read
// anywhere in this file — only getMinGuildLevelForTier's gate math (below, and
// raidFactory.js's getUnlockedRaidModes) still depends on it.
const legendaryRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_METAL_KING_DIFFICULTY, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            const workMultiReward = Raid.LEGENDARY_METAL_KING_MULTIPLIER_REWARD;
            const passiveReward = Raid.LEGENDARY_METAL_KING_PASSIVE_REWARD;
            const capacityReward = Raid.LEGENDARY_METAL_KING_CAPACITY_REWARD;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_METAL_KING_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', workMultiReward);
                await raidFactory.handleStatSplit(raidList, 'passiveAmount', passiveReward);
                await raidFactory.handleStatSplit(raidList, 'bankCapacity', capacityReward);
                raidResultDescription = metalKingRaidBoss.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, workMultiReward, passiveReward, capacityReward, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            } else {
                totalRaidSplit = 0;
                raidSplit = 0;
                raidResultDescription = metalKingRaidBoss.failureDescription;
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            }
            await sendResult(embed);
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const ultimateRaidMob = chooseMobFromList(legendaryRaidMobs[3]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_T4_DIFFICULTY, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_T4_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = ultimateRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.LEGENDARY_T4_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${ultimateRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = ultimateRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, ultimateRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see regularRaidScenarios' T4 entry's comment above.
        chance: .09,
        minGuildLevel: T4_MIN_LEVEL,
        difficulty: Raid.LEGENDARY_T4_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const hardRaidMob = chooseMobFromList(legendaryRaidMobs[2]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_T3_DIFFICULTY, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_T3_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = hardRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.LEGENDARY_T3_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${hardRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = hardRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, hardRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see regularRaidScenarios' T4 entry's comment above.
        chance: .31,
        difficulty: Raid.LEGENDARY_T3_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const mediumRaidMob = chooseMobFromList(legendaryRaidMobs[1]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_T2_DIFFICULTY, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_T2_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = mediumRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.LEGENDARY_T2_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${mediumRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = mediumRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, mediumRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see regularRaidScenarios' T4 entry's comment above.
        chance: .76,
        difficulty: Raid.LEGENDARY_T2_DIFFICULTY
    },
    {
        action: async (guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidSplit, raidResultDescription;
            const randomMultiplier = getRandomFromInterval(.8, 1.2);
            const regularRaidMob = chooseMobFromList(legendaryRaidMobs[0]);
            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.LEGENDARY_T1_DIFFICULTY, Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                totalRaidSplit = Math.round(Raid.LEGENDARY_T1_REWARD * randomMultiplier * raidRewardMultiplier);
                raidSplit = await addToBankOrPurse(guildId, guildBankStored, remainingBankSpace, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, interaction.client.user.id);
                raidResultDescription = regularRaidMob.successDescription;
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
            } else {
                totalRaidSplit = Math.round(Raid.LEGENDARY_T1_PENALTY * randomMultiplier);
                raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidSplit, raidSplitMode, raidListByMulti, sacrificeOffer);
                if (raidSplit === 'sacrificed') {
                    totalRaidSplit = 0;
                    raidSplit = null;
                    raidResultDescription = `${regularRaidMob.failureDescription}\n\n${GuildCompanions[0].sacrificeFlavor}`;
                } else {
                    raidResultDescription = regularRaidMob.failureDescription;
                }
            }
            const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
            embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, regularRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            await sendResult(embed);
            return totalRaidSplit;
        },
        // chance is vestigial — see regularRaidScenarios' T4 entry's comment above.
        chance: 1,
        difficulty: Raid.LEGENDARY_T1_DIFFICULTY
    }
]

const statRaidScenarios = [
    {
        action: async (guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction, resolveRaidCooldown, sendResult) => {
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
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance,
                    raidResultDescription, workMultiReward, passiveReward, bankReward, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            } else {
                raidResultDescription = metalKingRaidBoss.failureDescription;
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidSplit, raidSplit, metalKingRaidBoss, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            }
            await sendResult(embed);
            return totalRaidSplit;
        },
        chance: .01
    },
    {
        action: async (guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction, resolveRaidCooldown, sendResult) => {
            let raidSplit, totalRaidCost, raidResultDescription;
            const regularStatRaidMob = chooseMobFromList(regularStatRaidMobs);
            totalRaidCost = Math.round(Raid.REGULAR_STAT_RAID_COST * raidList.length);
            // Deliberately always 'even'/[] regardless of the guild's own raidSplitMode —
            // this is a flat per-head buy-in charged unconditionally win-or-lose, not a
            // contribution-weighted reward/penalty, so it stays even-split no matter what.
            raidSplit = await removeFromBankOrPurse(guildId, guildBankStored, raidList, totalRaidCost, 'even', []);

            const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.REGULAR_STAT_RAID_DIFFICULTY, Raid.MAXIMUM_STAT_RAID_SUCCESS_RATE);
            const successfulRaid = Math.random() < successChance;
            if (successfulRaid) {
                await raidFactory.handleStatSplit(raidList, 'workMultiplierAmount', Raid.REGULAR_STAT_RAID_REWARD);
                raidCount += 1;
                await dynamoHandler.updateGuildDatabase(guildId, 'raidCount', raidCount);
                await raidFactory.incrementCounter(raidList, 'guildRaidWinCount');
                raidResultDescription = regularStatRaidMob.successDescription;
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidCost, raidSplit, regularStatRaidMob, successChance, raidResultDescription, Raid.REGULAR_STAT_RAID_REWARD, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            } else {
                raidResultDescription = regularStatRaidMob.failureDescription;
                const { nextRaidAvailableAt, cooldownSkipSource, missedSkipChance } = resolveRaidCooldown(successfulRaid);
                embed = embedFactory.createRaidEmbed(guildName, raidList, raidCount, totalRaidCost, raidSplit, regularStatRaidMob, successChance, raidResultDescription, null, null, null, nextRaidAvailableAt, cooldownSkipSource, missedSkipChance);
            }
            await sendResult(embed);
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
    if (raidSelection === 'baby') {
        // Mirrors exactly what Regular's own T1 bracket (mult 1, penaltyMult 1) would show
        // — babyRaidScenarios rolls that identical bracket, just guaranteed instead of a
        // rare-ish chance among Regular's other four.
        const successChance = calculateRaidSuccessChance(totalMultiplier, Raid.T1_RAID_DIFFICULTY, Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE);
        const [rewardMin, rewardMax] = midRange(Raid.T1_RAID_REWARD * raidRewardMultiplier);
        const [penaltyMin, penaltyMax] = midRange(Math.abs(Raid.T1_RAID_PENALTY));
        return [{
            name: 'Tier 1 (guaranteed)',
            odds: 1,
            successChance,
            rewardText: `+${rewardMin.toLocaleString()} to ${rewardMax.toLocaleString()} potatoes`,
            penaltyText: `-${penaltyMin.toLocaleString()} to ${penaltyMax.toLocaleString()} potatoes`,
        }];
    }

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

    // Every mode's numbers now come straight off its own static Raid.* constants — no
    // separate mult/penaltyMult scaling table. Previously this preview built its own
    // parallel per-tier multiplier table (mult: {t4, t3, t2, t1}, penaltyMult) that had to
    // be hand-kept in sync with eliteRaidScenarios/legendaryRaidScenarios' own DIFFICULTY_
    // MULTIPLIER values above — it drifted stale after the 2026-08-23 T1-T3 halving pass
    // (elite 6/4.5/3 -> 3/2.25/1.5 in the live scenarios, never updated here), so the
    // preview embed was showing wrong odds/reward/penalty for Elite/Legendary T1-T3 right
    // up until this rework. Reading the same static constants the live roll uses removes
    // the second table entirely, so there's exactly one source of truth for both.
    const tierConfig = {
        regular: {
            scenarios: regularRaidScenarios, maxRate: Raid.REGULAR_MAXIMUM_RAID_SUCCESS_RATE,
            metalKing: { difficulty: Raid.METAL_KING_DIFFICULTY, reward: Raid.METAL_KING_REWARD, multiplierReward: Raid.METAL_KING_MULTIPLIER_REWARD, passiveReward: Raid.METAL_KING_PASSIVE_REWARD, capacityReward: Raid.METAL_KING_CAPACITY_REWARD },
            tiers: [
                { key: 't4', label: 'Tier 4', reward: Raid.T4_RAID_REWARD, penalty: Raid.T4_RAID_PENALTY, difficulty: Raid.T4_RAID_DIFFICULTY },
                { key: 't3', label: 'Tier 3', reward: Raid.T3_RAID_REWARD, penalty: Raid.T3_RAID_PENALTY, difficulty: Raid.T3_RAID_DIFFICULTY },
                { key: 't2', label: 'Tier 2', reward: Raid.T2_RAID_REWARD, penalty: Raid.T2_RAID_PENALTY, difficulty: Raid.T2_RAID_DIFFICULTY },
                { key: 't1', label: 'Tier 1', reward: Raid.T1_RAID_REWARD, penalty: Raid.T1_RAID_PENALTY, difficulty: Raid.T1_RAID_DIFFICULTY },
            ],
        },
        elite: {
            scenarios: eliteRaidScenarios, maxRate: Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE,
            metalKing: { difficulty: Raid.ELITE_METAL_KING_DIFFICULTY, reward: Raid.ELITE_METAL_KING_REWARD, multiplierReward: Raid.ELITE_METAL_KING_MULTIPLIER_REWARD, passiveReward: Raid.ELITE_METAL_KING_PASSIVE_REWARD, capacityReward: Raid.ELITE_METAL_KING_CAPACITY_REWARD },
            tiers: [
                { key: 't4', label: 'Tier 4', reward: Raid.ELITE_T4_REWARD, penalty: Raid.ELITE_T4_PENALTY, difficulty: Raid.ELITE_T4_DIFFICULTY },
                { key: 't3', label: 'Tier 3', reward: Raid.ELITE_T3_REWARD, penalty: Raid.ELITE_T3_PENALTY, difficulty: Raid.ELITE_T3_DIFFICULTY },
                { key: 't2', label: 'Tier 2', reward: Raid.ELITE_T2_REWARD, penalty: Raid.ELITE_T2_PENALTY, difficulty: Raid.ELITE_T2_DIFFICULTY },
                { key: 't1', label: 'Tier 1', reward: Raid.ELITE_T1_REWARD, penalty: Raid.ELITE_T1_PENALTY, difficulty: Raid.ELITE_T1_DIFFICULTY },
            ],
        },
        legendary: {
            scenarios: legendaryRaidScenarios, maxRate: Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE,
            metalKing: { difficulty: Raid.LEGENDARY_METAL_KING_DIFFICULTY, reward: Raid.LEGENDARY_METAL_KING_REWARD, multiplierReward: Raid.LEGENDARY_METAL_KING_MULTIPLIER_REWARD, passiveReward: Raid.LEGENDARY_METAL_KING_PASSIVE_REWARD, capacityReward: Raid.LEGENDARY_METAL_KING_CAPACITY_REWARD },
            tiers: [
                { key: 't4', label: 'Tier 4', reward: Raid.LEGENDARY_T4_REWARD, penalty: Raid.LEGENDARY_T4_PENALTY, difficulty: Raid.LEGENDARY_T4_DIFFICULTY },
                { key: 't3', label: 'Tier 3', reward: Raid.LEGENDARY_T3_REWARD, penalty: Raid.LEGENDARY_T3_PENALTY, difficulty: Raid.LEGENDARY_T3_DIFFICULTY },
                { key: 't2', label: 'Tier 2', reward: Raid.LEGENDARY_T2_REWARD, penalty: Raid.LEGENDARY_T2_PENALTY, difficulty: Raid.LEGENDARY_T2_DIFFICULTY },
                { key: 't1', label: 'Tier 1', reward: Raid.LEGENDARY_T1_REWARD, penalty: Raid.LEGENDARY_T1_PENALTY, difficulty: Raid.LEGENDARY_T1_DIFFICULTY },
            ],
        },
    }[raidSelection];

    // T4 isn't shown/rollable at all below its unlock level. Which of the remaining
    // T1-T3 (or T1-T4 once unlocked) actually gets weighted toward is now a function of
    // the roster's own totalMultiplier too — see raidFactory.js's getWeightedScenarios,
    // the SAME function runStartRaidFlow's own roll loop below calls, off the SAME
    // tierConfig.scenarios array reference, so preview and live roll can never drift
    // out of sync (see systems/raids-and-world-events.md's "Dynamic tier weighting").
    const eligibleScenarios = getWeightedScenarios(tierConfig.scenarios, guildLevel, totalMultiplier);
    const t4Unlocked = eligibleScenarios.length === tierConfig.scenarios.length;
    const odds = bracketOdds(eligibleScenarios);
    const mk = tierConfig.metalKing;
    const brackets = [{
        name: 'Metal King',
        odds: odds[0],
        successChance: calculateRaidSuccessChance(totalMultiplier, mk.difficulty, tierConfig.maxRate),
        rewardText: `+${Math.round(mk.reward * raidRewardMultiplier).toLocaleString()} potatoes, plus permanent stats (+${mk.multiplierReward.toFixed(1)} work multiplier, +${mk.passiveReward.toLocaleString()} passive, +${mk.capacityReward.toLocaleString()} bank capacity)`,
        penaltyText: `Nothing — this bracket costs nothing win or lose`,
    }];

    const tiers = tierConfig.tiers.filter(tier => tier.key !== 't4' || t4Unlocked);

    tiers.forEach((tier, index) => {
        const successChance = calculateRaidSuccessChance(totalMultiplier, tier.difficulty, tierConfig.maxRate);
        const [rewardMin, rewardMax] = midRange(tier.reward * raidRewardMultiplier);
        const [penaltyMin, penaltyMax] = midRange(Math.abs(tier.penalty));
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

// Everything a raid attempt needs once a mode has already been chosen — shared by
// /start-raid's own callback and /current-raid's "Start Raid" button flow (see
// currentRaid.js), so both entry points run through exactly one implementation instead of
// risking drift between a slash-command copy and a button-driven copy of this much raid
// resolution logic. Assumes the interaction has ALREADY been acknowledged (deferReply for
// a slash command, deferUpdate for a button click) — everything from here on only ever
// calls interaction.editReply, which works identically on either interaction type once
// acknowledged, so this function itself doesn't need to know or care which kind it got.
async function runStartRaidFlow(interaction, raidSelection) {
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to start the raid of!");
    if (!guild) return;
    const guildId = guild.guildId;
    const guildName = guild.guildName;
    const memberList = guild.memberList;
    const { level: guildLevel, multiplier: rawRaidRewardMultiplier } = getRaidLevelInfo(guild.raidCount);
    // Cinderroot, the Hoardwarden's perk 3b (see systems/guilds.md's "Guild Raid Companion"
    // design) — pre-adjusted here, once, before raidRewardMultiplier is threaded as a plain
    // value into every scenario closure and the raid preview embed below, so neither needs
    // any changes of its own to pick up the boosted number.
    const companionRewardBonus = guildCompanionFactory.getRaidRewardBonus(guild, guildLevel);
    const raidRewardMultiplier = rawRaidRewardMultiplier * (1 + companionRewardBonus);

    // Elite/Legendary gated by guild level, not by how much totalMultiplier the
    // roster brings — below the derived level, the tier's success-rate cap sits
    // under its mathematical breakeven point (see getMinGuildLevelForTier), so no
    // amount of individual stat investment can make it profitable. Checked before
    // any raid-list/member work so a guild that can't unlock a tier finds out
    // immediately instead of after paying for member lookups.
    if (raidSelection === 'elite' || raidSelection === 'legendary') {
        const penaltyMult = raidSelection === 'elite' ? Raid.ELITE_PENALTY_INCREASE : Raid.LEGENDARY_PENALTY_INCREASE;
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
    // Cinderroot's sacrifice mechanic (3d, see systems/guilds.md's "Guild Raid Companion"
    // design, section 7) — removeFromBankOrPurse is a plain top-level function with no
    // lexical access to this function's own guild/userId/interaction, so this context is
    // passed in explicitly per call rather than via shared mutable module state (which
    // would race across concurrent guild raids).
    const sacrificeOffer = { interaction, starterUserId: userId, guildCompanion: guild.guildCompanion };
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
    // Rank-weighted teamPower (top raider full weight, each next-strongest at
    // RAID_TEAM_DECAY of the rank above them) plus a headcount bonus for roster size —
    // see raidFactory.js's getEffectiveRaidPower, shared with currentRaid.js so the two
    // commands never show conflicting numbers.
    let totalMultiplier = getEffectiveRaidPower(raidMemberDetails);

    // Firefly — whichever participant has the best guildRaidMultiplierPercent perk
    // active lifts the whole raid, same multiplicative shape as the guild raidMulti
    // buff. Takes the best rather than summing everyone's, so multiple members
    // equipping Firefly doesn't stack into an unintended snowball.
    const raidCompanionBoost = Math.max(0, ...raidMemberDetails.map(m => m ? companionFactory.getActivePerkValue(m, "guildRaidMultiplierPercent") : 0));
    if (raidCompanionBoost > 0) {
        totalMultiplier *= (1 + raidCompanionBoost);
    }

    // World Boss's workMulti buff (2026-09-04, direct instruction) — same "fetched once,
    // multiplied in separately" shape as Firefly's boost just above, rather than folded
    // into raidFactory.getEffectiveRaidPower itself (that function is reused as-is by
    // Tower's entry gate, which deliberately excludes guild/world buffs — see tower.md's
    // "Entry Gate Uses Effective Power" section).
    const worldBuffPercent = await getWorldBuffWorkMultiPercent();
    if (worldBuffPercent > 0) {
        totalMultiplier *= (1 + worldBuffPercent);
    }

    // Per-member RAW power (deliberately NOT the rank-decayed teamPower above —
    // contribution share is meant to reflect each person's own raw strength, undiluted by
    // the team-combination weighting) — only consulted when the guild has opted into
    // raidSplitMode: 'share' (see setRaidSplit.js), but built unconditionally since it's
    // cheap and keeps this one spot as the single source of truth for both split modes.
    // Division-by-zero guarded the same way worldFactory.js's own raidShare calc is.
    const totalMemberPower = raidMemberDetails.reduce((sum, m) => sum + getMemberRaidPower(m), 0);
    const raidListByMulti = raidList.map((member, index) => {
        const multiplier = getMemberRaidPower(raidMemberDetails[index]);
        return { id: member.id, username: member.username, multiplier, raidShare: totalMemberPower > 0 ? multiplier / totalMemberPower : 0 };
    });
    const raidSplitMode = guild.raidSplitMode === 'share' ? 'share' : 'even';

    // raidPayoutMode: guild's opt-in toggle (see setRaidPayout.js/guild.raidPayoutMode) for
    // whether a raid REWARD fills the bank first ('bank', default) or is paid straight to
    // raiders every time, bypassing the bank regardless of remaining space ('direct').
    // Rewards only — implemented entirely by zeroing out remainingBankSpace before it's
    // threaded into every scenario below; addToBankOrPurse's "excess" branch then handles
    // the full reward exactly like today's "reward bigger than remaining space" case.
    // removeFromBankOrPurse (penalties) is untouched — a full bank still absorbs raid
    // losses first under both payout modes.
    const raidPayoutMode = guild.raidPayoutMode === 'direct' ? 'direct' : 'bank';
    if (raidPayoutMode === 'direct') {
        remainingBankSpace = 0;
    }

    // Which difficulty bracket (Metal King/T4/T3/T2/T1) gets rolled is random, so
    // show every bracket's odds and stakes up front — this commits the whole
    // roster's raid list on one roll, previously with zero preview of what that
    // meant. T4 is only shown once the guild's level has unlocked it.
    const brackets = buildRaidPreview(raidSelection, totalMultiplier, raidRewardMultiplier, guildLevel);
    const previewEmbed = embedFactory.createRaidPreviewEmbed(guildName, raidSelection, raidList.length, totalMultiplier, brackets, guildLevel, raidRewardMultiplier, raidSplitMode, raidPayoutMode);
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

    // resolveRaid takes it from here — the actual scenario roll, cooldown resolution, and
    // DB writes. Split out into its own function (2026-09-05 cooldown-skip overhaul) since
    // a chained cooldown-skip attempt (see resolveRaid's own bottom-of-function recursion)
    // has no confirm button to click and needs to jump straight to resolution using the
    // same raidSelection — mirrors work.js's callback/performWork split and takeBounty.js's
    // callback/runBountyAttempt split exactly.
    await resolveRaid(interaction, raidSelection, false, 0);
}

// Resolution-only half of the raid flow — everything that used to live after
// `await confirmation.deferUpdate();` in runStartRaidFlow above, PLUS everything a chained
// cooldown-skip attempt needs with no confirm step at all. Re-derives every piece of guild/
// roster/buff state from scratch on every call, including chain links, exactly like /work's
// performWork and takeBounty.js's runBountyAttempt already do — guild state (bank, roster,
// buffs, companion) can change between chain links, so nothing from the original
// invocation's preview (or an earlier chain link) is trusted here.
//
// isChainedReply/chainDepth: same shape as every other converted cooldown-skip command —
// isChainedReply distinguishes the original resolution (shows a user-facing error on an
// unexpected failure) from an auto-chained one (silently aborts with a console.log, mirroring
// performWork/runBountyAttempt/runNpcRobAttempt exactly, since there's no fresh interaction
// context to usefully show a chained failure on).
async function resolveRaid(interaction, raidSelection, isChainedReply, chainDepth) {
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to start the raid of!");
    if (!guild) return;
    const guildId = guild.guildId;
    const guildName = guild.guildName;
    const memberList = guild.memberList;
    const { level: guildLevel, multiplier: rawRaidRewardMultiplier, raidCooldownReductionPercent: guildLevelRaidTimerReduction } = getRaidLevelInfo(guild.raidCount);
    const companionRewardBonus = guildCompanionFactory.getRaidRewardBonus(guild, guildLevel);
    const raidRewardMultiplier = rawRaidRewardMultiplier * (1 + companionRewardBonus);

    // Cooldown-skip overhaul (2026-09-05, direct instruction: "on a loss there is no
    // cooldown skip and no auto trigger") — the same 4 terms that used to shave raidTimer
    // deterministically are now skip-chance SOURCES, summed and rolled only once a scenario
    // below already knows it won (see resolveRaidCooldown just below). Recomputed fresh on
    // every call (including chain links) since guild buffs/Spud Keep/companion state can
    // change between them. See cooldownFactory.js and systems/guilds.md's "Guild raid
    // cooldown skip" section for the full writeup.
    const spudKeepCooldownBuff = await dynamoHandler.getActiveSpudKeepCooldownBuff();
    const spudKeepRaidTimerReduction = spudKeepFactory.isSpudKeepBuffLiveForUser(spudKeepCooldownBuff, { guildId }, SpudKeep.COOLDOWN_BUFF_TYPE)
        ? spudKeepCooldownBuff.value
        : 0;
    const guildBuffRaidTimerReduction = guild.guildBuff == "raidTimer" ? guildBuffFactory.getGuildBuffValue("raidTimer", guildLevel) : 0;
    // Cinderroot's perk 3a (see systems/guilds.md's "Guild Raid Companion" design).
    const companionCooldownReduction = guildCompanionFactory.getRaidCooldownReduction(guild, guildLevel);
    const sources = [
        { key: 'guildBuff', chance: guildBuffRaidTimerReduction },
        { key: 'spudKeep', chance: spudKeepRaidTimerReduction },
        { key: 'guildLevel', chance: guildLevelRaidTimerReduction },
        { key: 'guildCompanion', chance: companionCooldownReduction }
    ];

    let shouldChain = false;
    let finalNextRaidAvailableAt = null;
    // Resolves the cooldown situation at the exact moment a scenario closure below already
    // knows its own win/loss — a loss NEVER rolls a skip at all (direct instruction, so
    // combineSkipChance/rollCooldownSkip aren't even called in that branch), a win rolls the
    // combined chance and, on a hit, backdates the cooldown to ready-now, attributes the
    // skip to whichever source won the weighted pick (cosmetic only — see
    // cooldownFactory.pickSkipSource), and flags this call to chain another attempt once
    // resolution finishes below.
    function resolveRaidCooldown(won) {
        if (!won) {
            finalNextRaidAvailableAt = Date.now() + Raid.RAID_TIMER_SECONDS * 1000;
            return { nextRaidAvailableAt: finalNextRaidAvailableAt, cooldownSkipSource: null, missedSkipChance: 0 };
        }
        const totalSkipChance = cooldownFactory.combineSkipChance(sources);
        if (cooldownFactory.rollCooldownSkip(totalSkipChance)) {
            const winningSource = cooldownFactory.pickSkipSource(sources);
            let cooldownSkipSource;
            if (winningSource === 'guildBuff') {
                cooldownSkipSource = { source: 'guildBuff', label: guildName };
            } else if (winningSource === 'spudKeep') {
                cooldownSkipSource = { source: 'spudKeep' };
            } else if (winningSource === 'guildLevel') {
                cooldownSkipSource = { source: 'guildLevel', label: `Guild Level ${guildLevel}` };
            } else {
                cooldownSkipSource = { source: 'guildCompanion', label: 'Cinderroot, the Hoardwarden' };
            }
            finalNextRaidAvailableAt = Date.now();
            shouldChain = true;
            return { nextRaidAvailableAt: finalNextRaidAvailableAt, cooldownSkipSource, missedSkipChance: 0 };
        }
        // Shown on the result embed only on a genuine miss (2026-09-05, player-reported:
        // "the embeds no longer have a % cooldown reduction... if it doesn't skip they
        // should at least know what the chance was so its not hidden") — a hit gets its
        // own flavor field instead, and a loss never rolls at all (see the `!won` branch
        // above), so there's nothing to report there.
        finalNextRaidAvailableAt = Date.now() + Raid.RAID_TIMER_SECONDS * 1000;
        return { nextRaidAvailableAt: finalNextRaidAvailableAt, cooldownSkipSource: null, missedSkipChance: totalSkipChance };
    }

    // Pre-bound to this call's own interaction/isChainedReply so every scenario closure
    // below (baby/regular/elite/legendary/stat) can send its result without needing its own
    // copy of the editReply-vs-followUp switch.
    function sendResult(embed) {
        return sendRaidResult(interaction, embed, isChainedReply);
    }

    // Elite/Legendary gated by guild level, not by how much totalMultiplier the roster
    // brings — re-checked here (not just at the preview stage) since guild level can change
    // between chain links.
    if (raidSelection === 'elite' || raidSelection === 'legendary') {
        const penaltyMult = raidSelection === 'elite' ? Raid.ELITE_PENALTY_INCREASE : Raid.LEGENDARY_PENALTY_INCREASE;
        const maxRate = raidSelection === 'elite' ? Raid.ELITE_MAXIMUM_RAID_SUCCESS_RATE : Raid.LEGENDARY_MAXIMUM_RAID_SUCCESS_RATE;
        const requiredLevel = getMinGuildLevelForTier(penaltyMult, maxRate);
        if (guildLevel < requiredLevel) {
            if (!isChainedReply) {
                interaction.editReply(`${userDisplayName}, ${raidSelection[0].toUpperCase()}${raidSelection.slice(1)} raids unlock at Guild Level ${requiredLevel} — below that, the difficulty cap means your guild would lose potatoes on average even with a perfect roster. Your guild is currently Level ${guildLevel}.`);
            } else {
                console.log(`startRaid.js chain link ${chainDepth} aborted: guild level dropped below the ${raidSelection} gate for guild ${guildId}`);
            }
            return;
        }
    }

    let raidList = await getLiveRaidRoster(guild);
    let raidCount = guild.raidCount;
    const raidCountBeforeThisRaid = raidCount;
    const sacrificeOffer = { interaction, starterUserId: userId, guildCompanion: guild.guildCompanion };
    let guildTotalEarnings = guild.totalEarnings;
    let guildBankStored = guild.bankStored;
    let guildBankCapacity = guild.bankCapacity;
    let remainingBankSpace = guildBankCapacity - guildBankStored;

    if (raidList.length == 0) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName} there are no members in the raid list. Get people to join before starting!`);
        } else {
            console.log(`startRaid.js chain link ${chainDepth} aborted: no members left in the raid list for guild ${guildId}`);
        }
        return;
    }

    const member = memberList.find((currentMember) => currentMember.id == userId)
    if (!member) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
        } else {
            console.log(`startRaid.js chain link ${chainDepth} aborted: starting member no longer found in guild ${guildId}`);
        }
        return;
    }

    let canStartRaids = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER || member.role == GuildRoles.ELDER;
    if (!canStartRaids) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName} you must be an elder, co-leader, or the guild leader to start a raid!`);
        } else {
            console.log(`startRaid.js chain link ${chainDepth} aborted: starting member lost raid-start permissions in guild ${guildId}`);
        }
        return;
    }

    const timeUntilRaidAvailableInMS = guild.raidTimer - Date.now()
    if (timeUntilRaidAvailableInMS > 0) {
        if (!isChainedReply) {
            interaction.editReply(`${userDisplayName}, your guild has raided recently and must wait ${convertSecondstoMinutes(Math.floor(timeUntilRaidAvailableInMS / 1000))} before raiding again!`);
        } else {
            console.log(`startRaid.js chain link ${chainDepth} aborted: cooldown unexpectedly not ready for guild ${guildId}`);
        }
        return;
    }

    const raidMemberDetails = await Promise.all(raidList.map(element => dynamoHandler.findUser(element.id, element.username)));
    // Rank-weighted teamPower (top raider full weight, each next-strongest at
    // RAID_TEAM_DECAY of the rank above them) plus a headcount bonus for roster size —
    // see raidFactory.js's getEffectiveRaidPower, shared with currentRaid.js so the two
    // commands never show conflicting numbers.
    let totalMultiplier = getEffectiveRaidPower(raidMemberDetails);

    // Firefly — whichever participant has the best guildRaidMultiplierPercent perk
    // active lifts the whole raid, same multiplicative shape as the guild raidMulti
    // buff. Takes the best rather than summing everyone's, so multiple members
    // equipping Firefly doesn't stack into an unintended snowball.
    const raidCompanionBoost = Math.max(0, ...raidMemberDetails.map(m => m ? companionFactory.getActivePerkValue(m, "guildRaidMultiplierPercent") : 0));
    if (raidCompanionBoost > 0) {
        totalMultiplier *= (1 + raidCompanionBoost);
    }

    // World Boss's workMulti buff (2026-09-04, direct instruction) — same "fetched once,
    // multiplied in separately" shape as Firefly's boost just above, rather than folded
    // into raidFactory.getEffectiveRaidPower itself (that function is reused as-is by
    // Tower's entry gate, which deliberately excludes guild/world buffs — see tower.md's
    // "Entry Gate Uses Effective Power" section).
    const worldBuffPercent = await getWorldBuffWorkMultiPercent();
    if (worldBuffPercent > 0) {
        totalMultiplier *= (1 + worldBuffPercent);
    }

    // Per-member RAW power (deliberately NOT the rank-decayed teamPower above —
    // contribution share is meant to reflect each person's own raw strength, undiluted by
    // the team-combination weighting) — only consulted when the guild has opted into
    // raidSplitMode: 'share' (see setRaidSplit.js), but built unconditionally since it's
    // cheap and keeps this one spot as the single source of truth for both split modes.
    // Division-by-zero guarded the same way worldFactory.js's own raidShare calc is.
    const totalMemberPower = raidMemberDetails.reduce((sum, m) => sum + getMemberRaidPower(m), 0);
    const raidListByMulti = raidList.map((member, index) => {
        const multiplier = getMemberRaidPower(raidMemberDetails[index]);
        return { id: member.id, username: member.username, multiplier, raidShare: totalMemberPower > 0 ? multiplier / totalMemberPower : 0 };
    });
    const raidSplitMode = guild.raidSplitMode === 'share' ? 'share' : 'even';

    // raidPayoutMode: guild's opt-in toggle (see setRaidPayout.js/guild.raidPayoutMode) for
    // whether a raid REWARD fills the bank first ('bank', default) or is paid straight to
    // raiders every time, bypassing the bank regardless of remaining space ('direct').
    // Rewards only — implemented entirely by zeroing out remainingBankSpace before it's
    // threaded into every scenario below; addToBankOrPurse's "excess" branch then handles
    // the full reward exactly like today's "reward bigger than remaining space" case.
    // removeFromBankOrPurse (penalties) is untouched — a full bank still absorbs raid
    // losses first under both payout modes.
    const raidPayoutMode = guild.raidPayoutMode === 'direct' ? 'direct' : 'bank';
    if (raidPayoutMode === 'direct') {
        remainingBankSpace = 0;
    }

    const raidScenarioRoll = Math.random();
    let potatoesGained = 0;
    if (raidSelection == 'baby') {
        // No getEligibleScenarios needed — babyRaidScenarios is always the single,
        // never-gated T1 entry, so there's nothing to filter by guild level.
        for (const scenario of babyRaidScenarios) {
            if (raidScenarioRoll < scenario.chance) {
                potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult);
                break;
            }
        }
        guildTotalEarnings += potatoesGained;
        await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
    } else if (raidSelection == 'regular') {
        for (const scenario of getWeightedScenarios(regularRaidScenarios, guildLevel, totalMultiplier)) {
            if (raidScenarioRoll < scenario.chance) {
                potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult);
                break;
            }
        }
        guildTotalEarnings += potatoesGained;
        await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
    } else if (raidSelection == 'elite') {
        for (const scenario of getWeightedScenarios(eliteRaidScenarios, guildLevel, totalMultiplier)) {
            if (raidScenarioRoll < scenario.chance) {
                potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult);
                break;
            }
        }
        guildTotalEarnings += potatoesGained;
        await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
    } else if (raidSelection == 'legendary') {
        for (const scenario of getWeightedScenarios(legendaryRaidScenarios, guildLevel, totalMultiplier)) {
            if (raidScenarioRoll < scenario.chance) {
                potatoesGained = await scenario.action(guildId, guildName, guildBankStored, remainingBankSpace, raidList, raidCount, totalMultiplier, raidRewardMultiplier, interaction, raidSplitMode, raidListByMulti, sacrificeOffer, resolveRaidCooldown, sendResult);
                break;
            }
        }
        guildTotalEarnings += potatoesGained;
        await dynamoHandler.updateGuildDatabase(guildId, 'totalEarnings', guildTotalEarnings);
    } else if (raidSelection == 'stat') {
        for (const scenario of statRaidScenarios) {
            if (raidScenarioRoll < scenario.chance) {
                await scenario.action(guildId, guildName, guildBankStored, raidList, raidCount, totalMultiplier, interaction, resolveRaidCooldown, sendResult);
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
    // Whether THIS resolution's Cinderroot sacrifice fired — free reuse of the same
    // freshGuild fetch already happening for the win/loss diff, rather than a second DB
    // round-trip, and without threading a new field through any scenario closure's return
    // value (which stays a bare number, per the comment above). See systems/guilds.md's
    // "Guild Raid Companion" design, section 4.
    const companionSacrificedThisRaid = !wonThisRaid && guild.guildCompanion != null && freshGuild?.guildCompanion == null;
    const raidHistoryEntry = {
        timestamp: Date.now(),
        raidTier: raidSelection,
        won: wonThisRaid,
        potatoDelta: potatoesGained,
        companionSacrificed: companionSacrificedThisRaid   // always boolean, only ever true on the resolution the sacrifice happened
    };
    const existingRaidHistory = Array.isArray(guild.raidHistory) ? guild.raidHistory : [];
    const newRaidHistory = [...existingRaidHistory, raidHistoryEntry].slice(-GuildHistory.MAX_ENTRIES);
    await dynamoHandler.updateGuildDatabase(guildId, 'raidHistory', newRaidHistory);

    // Cinderroot's acquisition roll (see systems/guilds.md's "Guild Raid Companion"
    // design, section 4) — one call, no closures touched. interaction.followUp (not a
    // second editReply) posts a distinct, additional message announcing the drop, since
    // every scenario closure above has already sent its own result via sendResult by the
    // time control returns here.
    const companionDrop = await guildCompanionFactory.rollGuildCompanionDrop(guild, raidSelection, wonThisRaid);
    if (companionDrop.awarded) {
        const def = guildCompanionFactory.getGuildCompanionById(companionDrop.companion.id);
        await interaction.followUp({ embeds: [embedFactory.createGuildCompanionDropEmbed(guildName, def)] }).catch(() => {});
    }

    // finalNextRaidAvailableAt is set by whichever resolveRaidCooldown call the winning
    // scenario branch actually made above — reused here rather than recomputed, so the
    // write can never drift from what the result embed already displayed.
    await dynamoHandler.updateGuildDatabase(guildId, 'raidTimer', finalNextRaidAvailableAt);

    // No raidList to clear anymore — the roster is computed live from each member's
    // persistent autoJoinRaids toggle (getLiveRaidRoster), not a stored array, so
    // whoever's still opted in stays opted in for the next raid automatically.

    // Cooldown-skip overhaul (2026-09-05, direct instruction: "on a loss there is no
    // cooldown skip and no auto trigger") — shouldChain is only ever set true inside
    // resolveRaidCooldown's own WIN branch on a roll hit, so a loss (or a win that missed
    // the roll) never reaches here. Mirrors takeBounty.js's runBountyAttempt/robNpc.js's
    // runNpcRobAttempt chain check exactly.
    if (shouldChain && chainDepth < Work.MAX_COOLDOWN_SKIP_CHAIN_LENGTH) {
        await resolveRaid(interaction, raidSelection, true, chainDepth + 1);
    }
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
                    name: 'baby',
                    value: 'baby'
                },
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
        const raidSelection = interaction.options.get('raid-select')?.value;
        await runStartRaidFlow(interaction, raidSelection);
    },
    runStartRaidFlow,
    // Exported for direct unit testing of the preview embed's numbers (see
    // buildRaidPreview.test.js) — same convention runStartRaidFlow above already
    // established for exporting an otherwise-internal function for test coverage.
    buildRaidPreview
}