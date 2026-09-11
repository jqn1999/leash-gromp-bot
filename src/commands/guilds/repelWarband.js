const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { GuildRoles, GuildRival } = require("../../utils/constants");
const { RaidFactory, getLiveRaidRoster, getMemberRaidPower, getRaidLevelInfo } = require("../../utils/raidFactory");
const { addToBankOrPurse, removeFromBankOrPurse } = require("./startRaid");
const guildRivalFactory = require("../../utils/guildRivalFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const raidFactory = new RaidFactory();

// Guild Rival Warbands (systems/guilds.md#guild-rival-warbands) — mirrors /confront-rival's
// own immediacy: no confirm step, resolves on the spot once both gates below are met.
// Elder+ only (unlike /confront-rival's personal gate, this is a guild-wide, bank-risking
// action — same permission tier /start-raid already requires). Gate order (role, THEN
// Infamy) is load-bearing — a below-Elder member should never even learn the guild's exact
// Infamy/threshold gap from this command's own rejection message.
module.exports = {
    name: "repel-warband",
    description: "Elder+ repels an Ashclove Company warband once your guild's Infamy is high enough",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to repel a warband with!");
        if (!guild) return;
        const guildId = guild.guildId;
        const guildName = guild.guildName;

        const member = guild.memberList.find((currentMember) => currentMember.id == userId);
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        const canRepelWarband = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER || member.role == GuildRoles.ELDER;
        if (!canRepelWarband) {
            interaction.editReply(`${userDisplayName} you must be an elder, co-leader, or the guild leader to repel a warband!`);
            return;
        }

        const currentInfamy = Number.isFinite(guild.guildInfamy) ? guild.guildInfamy : 0;
        if (currentInfamy < GuildRival.INFAMY_THRESHOLD) {
            interaction.editReply(`${userDisplayName}, the Ashclove Company hasn't noticed your guild yet — you have ${currentInfamy}/${GuildRival.INFAMY_THRESHOLD} Infamy. Keep winning raids (check /guild-infamy).`);
            return;
        }

        // Same guard /start-raid's own resolveRaid applies before rolling anything — an
        // empty live roster has nobody to grant the stat bump/potato reward/achievement
        // counter to, and would divide-by-zero inside handlePotatoSplit if the reward
        // ever had to spill past a full bank.
        const raidList = await getLiveRaidRoster(guild);
        if (raidList.length == 0) {
            interaction.editReply(`${userDisplayName} there are no members currently opted into your guild's raid roster (/join-raid) to send against the warband!`);
            return;
        }

        // Guild level feeds success chance the same way Mercenary Rank feeds
        // /confront-rival's own odds (2026-09-11, direct instruction) — see
        // guildRivalFactory.js's own comment for the derivation.
        const { level: guildLevel } = getRaidLevelInfo(guild.raidCount);
        const result = await guildRivalFactory.resolveWarbandConfrontation(guildLevel);

        // Subtracts the flat INFAMY_THRESHOLD, win OR lose, rather than resetting to 0 —
        // mirrors mercenaryNotoriety's own subtract-the-threshold shape directly (shipped
        // that way from day one here, rather than repeating Notoriety's own two-step
        // full-reset-then-subtract history). Clamped at 0 so a rare edge case (this value
        // ever ending up below the threshold some other way) can't go negative.
        const newInfamy = Math.max(0, currentInfamy - GuildRival.INFAMY_THRESHOLD);
        await dynamoHandler.updateGuildDatabase(guildId, 'guildInfamy', newInfamy);

        // Built once, used by whichever branch below actually needs it — mirrors
        // startRaid.js's resolveRaid own "built unconditionally since it's cheap" reasoning
        // for raidListByMulti. Only consulted by addToBankOrPurse/removeFromBankOrPurse when
        // the guild has opted into raidSplitMode: 'share'; the confrontation's own
        // scenario/success-chance roll above never touches any of this.
        const raidMemberDetails = await Promise.all(raidList.map(element => dynamoHandler.findUser(element.id, element.username)));
        const totalMemberPower = raidMemberDetails.reduce((sum, m) => sum + getMemberRaidPower(m), 0);
        const raidListByMulti = raidList.map((rosterMember, index) => {
            const multiplier = getMemberRaidPower(raidMemberDetails[index]);
            return { id: rosterMember.id, username: rosterMember.username, multiplier, raidShare: totalMemberPower > 0 ? multiplier / totalMemberPower : 0 };
        });
        const raidSplitMode = guild.raidSplitMode === 'share' ? 'share' : 'even';

        if (result.won) {
            // Flat, non-divided grant to every live-roster member — mirrors Metal King's own
            // handleStatSplit calls in startRaid.js exactly (that function only ever takes
            // ONE flat rewardAmount applied identically to every entry in raidList). Magnitude
            // is scenario-keyed, sourced from the merc side's BountyStatReward tiers.
            for (const track of result.statTracks) {
                await raidFactory.handleStatSplit(raidList, track, GuildRival.STAT_GRANT[result.scenario][track]);
            }

            // Routed through the guild's own existing addToBankOrPurse (bank-first, then
            // whichever of raidSplitMode/raidPayoutMode the guild has already picked) — the
            // exact same infrastructure every ordinary raid reward already uses, with the
            // live raid roster as the split audience.
            const remainingBankSpace = guild.raidPayoutMode === 'direct' ? 0 : Math.max(0, guild.bankCapacity - guild.bankStored);
            await addToBankOrPurse(guildId, guild.bankStored, remainingBankSpace, raidList, result.rewardAmount, raidSplitMode, raidListByMulti, interaction.client.user.id);

            // LIFETIME, per-user counter — the achievement system has no guild-level concept
            // at all, so warband_breaker reads this instead of guildInfamy directly. Bumped
            // on every live-roster member, mirroring guildRaidWinCount's own per-participant
            // bump on an ordinary raid win, not just the Elder who ran the command.
            await raidFactory.incrementCounter(raidList, 'warbandRepelledCount');
        } else {
            // removeFromBankOrPurse takes a NEGATIVE cost (same convention every raid penalty
            // constant already uses, e.g. Raid.T2_RAID_PENALTY) — drains guild.bankStored
            // first, floored at 0 (never negative), spilling to raiders only if it doesn't
            // fully fit. No sacrificeOffer — Cinderroot's sacrifice mechanic is explicitly
            // deferred for Guild Rival Warbands (see roadmap.md section 7).
            await removeFromBankOrPurse(guildId, guild.bankStored, raidList, -result.penaltyAmount, raidSplitMode, raidListByMulti, null);
        }

        const embed = embedFactory.createWarbandConfrontationResultEmbed(guildName, result, newInfamy);
        await interaction.editReply({ embeds: [embed] });
    }
}
