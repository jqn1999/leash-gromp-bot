const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Rival } = require("../../utils/constants");
const { RaidFactory } = require("../../utils/raidFactory");
const raidFactory = new RaidFactory();
const mercenaryFactory = require("../../utils/mercenaryFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

// Gated by a resettable resource-threshold (mercenaryNotoriety >= CONFRONTATION_THRESHOLD),
// not a cooldown timer — the first accumulated-counter-as-gate pattern in this codebase.
// Resolves immediately, no confirm step — same immediacy precedent /take-bounty already
// sets. No tier option — 2026-08-23, direct instruction, removed player tier choice
// entirely: which scenario (easy/medium/hard) this confrontation is gets rolled internally
// by mercenaryFactory.resolveRivalConfrontation (Rival.SCENARIO_CHANCE), not picked by the
// player. See systems/mercenary-bounties.md#rival-bounty-hunters.
module.exports = {
    name: "confront-rival",
    description: "Confront a Rival Bounty Hunter drawn by your accumulated Notoriety",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
        if (rankInfo.rank < 2) {
            interaction.editReply(`${userDisplayName}, you need to be Mercenary Rank 2+ to confront a Rival Bounty Hunter — win more Bounties first.`);
            return;
        }

        if (userDetails.mercenaryNotoriety < Rival.CONFRONTATION_THRESHOLD) {
            interaction.editReply(`${userDisplayName}, no Rival Bounty Hunter has noticed you yet — you have ${userDetails.mercenaryNotoriety}/${Rival.CONFRONTATION_THRESHOLD} Notoriety. Keep winning Bounties/rob-npc attempts (check /notoriety).`);
            return;
        }

        const result = await mercenaryFactory.resolveRivalConfrontation(userDetails);

        // Subtracts the flat CONFRONTATION_THRESHOLD, win OR lose, rather than resetting to
        // 0 (direct instruction — "instead of notoriety going down to 0 on rival, just
        // subtract 20 ... so that notoriety can also just be stored up"). Notoriety keeps
        // accruing from /take-bounty/rob-npc wins even after a player is already eligible
        // to fight (fighting is a deliberate player choice, not auto-triggered), so any
        // overflow past the threshold at confrontation time now carries straight into the
        // next cycle's progress instead of being thrown away — clamped at 0 so a rare
        // edge case (this value ever ending up below the threshold some other way) can't
        // go negative. Re-gating for the next cycle still works exactly the same:
        // /confront-rival's own guard above only cares whether the value is still
        // >= CONFRONTATION_THRESHOLD.
        const setAttributes = { mercenaryNotoriety: Math.max(0, userDetails.mercenaryNotoriety - Rival.CONFRONTATION_THRESHOLD) };
        const addAttributes = {};

        if (result.won) {
            addAttributes.rivalConfrontationWinCount = 1; // lifetime — NOT mercenaryBountyWinCount;
                                                            // a Rival win never advances Mercenary Rank
            setAttributes.potatoes = userDetails.potatoes + result.rewardAmount;
            setAttributes.totalEarnings = userDetails.totalEarnings + result.rewardAmount;
        } else {
            setAttributes.potatoes = Math.max(0, userDetails.potatoes - result.penaltyAmount);
            setAttributes.totalLosses = userDetails.totalLosses - result.penaltyAmount;
        }

        await dynamoHandler.updateUserFields(userId, setAttributes, addAttributes);

        if (result.won) {
            for (const grant of result.statBump) {
                await raidFactory.handleStatSplit([{ id: userId, username }], grant.type, grant.amount);
            }
        }

        const embed = embedFactory.createRivalConfrontationResultEmbed(userDisplayName, result);
        await interaction.editReply({ embeds: [embed] });

        const updatedUserDetails = await dynamoHandler.findUser(userId, username);
        if (updatedUserDetails) {
            const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
            if (newlyUnlocked.length > 0) {
                const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
                interaction.followUp({ embeds: achievementEmbeds });
            }
        }
    }
}
