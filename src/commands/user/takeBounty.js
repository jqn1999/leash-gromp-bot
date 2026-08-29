const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bounty, Rival, CompanionLeveling } = require("../../utils/constants");
const { RaidFactory } = require("../../utils/raidFactory");
const raidFactory = new RaidFactory();
const mercenaryFactory = require("../../utils/mercenaryFactory");
const companionFactory = require("../../utils/companionFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { QuestFactory } = require("../../utils/questFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();
const questFactory = new QuestFactory();

// Resolves immediately, no confirm step — same precedent /start-raid already sets. See
// systems/mercenary-bounties.md for the full reward/penalty formula.
//
// `mode` replaces the old `tier` (I/II/III) option — the 12-Tier Bounty Ladder rework
// (2026-08-28) dropped manual tier selection entirely in favor of dynamic tier weighting
// off the mercenary's own current power, the same way Guild Raid's own T1-T4 within
// Regular mode are auto-rolled rather than player-picked. 'baby' always resolves the
// easiest tier guaranteed (mirrors Baby Raid's role for new guilds); 'regular' rolls
// across all 12 tiers, weighted toward whichever the player's own power is closest to.
module.exports = {
    name: "take-bounty",
    description: "Attempt a mercenary bounty",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'mode',
            description: 'Baby Bounty (guaranteed easiest tier) or Regular Bounty (all 12 tiers, auto-selected by your power)',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                { name: 'Baby Bounty', value: 'baby' },
                { name: 'Regular Bounty', value: 'regular' },
            ]
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const mode = interaction.options.get('mode')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const timeSinceLastBountyInSeconds = Math.floor((Date.now() - userDetails.bountyTimer) / 1000);
        const timeUntilBountyAvailableInSeconds = Bounty.BOUNTY_TIMER_SECONDS - timeSinceLastBountyInSeconds;
        if (timeSinceLastBountyInSeconds < Bounty.BOUNTY_TIMER_SECONDS) {
            interaction.editReply(`${userDisplayName}, you've taken a bounty recently and must wait ${convertSecondstoMinutes(timeUntilBountyAvailableInSeconds)} before taking another.`);
            return;
        }

        const result = await mercenaryFactory.resolveBountyAttempt(userDetails, mode);

        let userPotatoes = userDetails.potatoes;
        let userTotalEarnings = userDetails.totalEarnings;
        let userTotalLosses = userDetails.totalLosses;
        let userStarches = userDetails.starches;
        const setAttributes = { bountyTimer: Date.now() };
        const addAttributes = {};

        if (result.won) {
            addAttributes.mercenaryBountyWinCount = 1;
            // Rival Bounty Hunters — Notoriety accrual is a one-line constant lookup, not a
            // mercenaryFactory.js function, matching mercenaryBountyWinCount's own "simple
            // counter bumps live at the command call site" division of labor. Keyed by the
            // 3-band letter (see mercenaryFactory.getBandLetter), not the numeric 1-12
            // tier the 12-Tier Bounty Ladder rework introduced. See
            // systems/mercenary-bounties.md#rival-bounty-hunters.
            addAttributes.mercenaryNotoriety = Rival.NOTORIETY_PER_BOUNTY_TIER[mercenaryFactory.getBandLetter(result.tier)];
            if (result.currency === 'potato') {
                userPotatoes += result.rewardAmount;
                userTotalEarnings += result.rewardAmount;
                setAttributes.potatoes = userPotatoes;
                setAttributes.totalEarnings = userTotalEarnings;
            } else {
                userStarches += result.rewardAmount;
                setAttributes.starches = userStarches;
            }
        } else {
            userPotatoes -= result.penaltyAmount;
            userTotalLosses -= result.penaltyAmount;
            setAttributes.potatoes = userPotatoes;
            setAttributes.totalLosses = userTotalLosses;
        }

        // Companion leveling (roadmap #59, direct instruction — "have it level during
        // heists and bounties... account for the longer cooldown"). Unconditional on
        // win/loss, same as /work's own per-call bump — a Bounty attempt is a real time
        // investment either way. Cooldown-scaled against /work's own 300s baseline (see
        // companionFactory.getCooldownScaledWorkCountGrant), then pulled back by
        // CompanionLeveling.REALISTIC_PLAY_DISCOUNT since the pure ratio (12x) assumes a
        // player hits /work back-to-back the instant its cooldown clears — 8x, direct
        // instruction. Restricted to Yukon specifically (direct follow-up instruction) —
        // any other equipped companion is a no-op here, since Yukon is the one companion
        // actually tied to the Mercenary track.
        let leveledCompanions = companionFactory.levelActiveCompanion(
            userDetails.companions,
            companionFactory.getCooldownScaledWorkCountGrant(Bounty.BOUNTY_TIMER_SECONDS, CompanionLeveling.REALISTIC_PLAY_DISCOUNT),
            'yukon'
        );

        // Yukon, the Highwayman — obtained via a dedicated roll on a winning Bounty
        // resolution only (dropSource "bounty", never the normal /work roll — see
        // companionFactory.getCompanionsByRarity). Always resolved unconditionally on a
        // hit; resolveYukonAward already handles the "already own it" duplicate case
        // correctly (grants a sellable spare instead of a potato payout). Built off
        // leveledCompanions (not the original userDetails.companions) so the leveling bump
        // above and a same-turn Yukon pull compose into ONE final companions object rather
        // than the second write clobbering the first — `companions` is always a full SET,
        // never a deep merge, so these can't be two separate writes.
        let yukonAward = null;
        if (result.won && result.yukonHit) {
            yukonAward = mercenaryFactory.resolveYukonAward({ ...userDetails, companions: leveledCompanions });
            leveledCompanions = yukonAward.companions;
        }
        setAttributes.companions = leveledCompanions;

        await dynamoHandler.updateUserFields(userId, setAttributes, addAttributes);

        if (result.won && result.currency === 'potato' && result.rewardAmount > 0) {
            await dynamoHandler.updateIfNewRecord(userId, 'largestBountyReward', result.rewardAmount);
        }

        // The rare permanent stat-increase branch — reuses raidFactory.handleStatSplit
        // (a 1-person "raidList") for the actual write, same as any other stat-granting
        // reward in this codebase; the amount handed in is already the fully-resolved
        // final delta (percentage-of-current-stat, capped, min-increment rounded — see
        // mercenaryFactory.rollBountyStatReward), not a raw multiplier.
        if (result.won && result.statReward) {
            for (const grant of result.statReward) {
                await raidFactory.handleStatSplit([{ id: userId, username }], grant.type, grant.amount);
            }
        }

        const embed = embedFactory.createBountyResultEmbed(userDisplayName, result, yukonAward);
        await interaction.editReply({ embeds: [embed] });

        const updatedUserDetails = await dynamoHandler.findUser(userId, username);
        if (updatedUserDetails) {
            const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
            if (newlyUnlocked.length > 0) {
                const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
                interaction.followUp({ embeds: achievementEmbeds });
            }

            // Mercenary Quest (systems/quests.md#mercenary-quest) is keyed off
            // mercenaryBountyWinCount, which only ever changes here — /work never touches
            // it — so this is the only call site that can ever advance or complete it.
            const questResult = await questFactory.checkAndClaimQuests(updatedUserDetails, userDetails);
            if (questResult.completedQuests.length > 0) {
                const questEmbed = embedFactory.createQuestCompleteEmbed(userDisplayName, questResult.completedQuests, updatedUserDetails.workMultiplierAmount);
                interaction.followUp({ embeds: [questEmbed] });
            }
        }
    }
}
