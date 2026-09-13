const dynamoHandler = require("../../utils/dynamoHandler");
var {towerFactory} = require("../../utils/towerFactory");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands");
const { EmbedBuilder } = require("discord.js")
const tC = require("../../utils/towerConstants.js");
const raidFactory = require("../../utils/raidFactory");
const companionFactory = require("../../utils/companionFactory");

// Tower Pet (2026-09-13) — leveling grant + Bastion drop rolls both happen against the SAME
// freshly re-fetched userDetails processRewardPayouts already reads (not the stale
// pre-run snapshot), same "always credit against the latest state" precedent every other
// field in this function already follows. Returns the last-awarded companion info (if any)
// so the callback can show a separate drop-announcement followUp, mirroring takeBounty.js's
// own achievement/quest followUp precedent — companions is only written back once, at the
// end, so a run with neither a level-up nor a drop makes no extra write at all.
async function processTowerCompanionRewards(userId, userDetails, floor, elitesSurvivedCount, towerCompanionHits, wardUsed) {
    let companions = userDetails.companions;
    let bastionAward = null;

    const grant = companionFactory.getTowerWorkCountGrant(floor, elitesSurvivedCount);
    const leveled = companionFactory.levelActiveCompanion(companions, grant, null, "towerRewardBonus");
    if (leveled !== companions) {
        companions = leveled;
    }

    for (let i = 0; i < towerCompanionHits; i++) {
        bastionAward = companionFactory.resolveTowerCompanionAward({ ...userDetails, companions });
        companions = bastionAward.companions;
    }

    if (companions !== userDetails.companions) {
        await dynamoHandler.updateUserDatabase(userId, "companions", companions);
    }
    if (wardUsed) {
        await dynamoHandler.updateUserDatabase(userId, "towerWardUsedToday", true);
    }
    return bastionAward;
}

async function processRewardPayouts(interaction, userId, rewards, username, userDisplayName, floor, died, elitesSurvivedCount, towerCompanionHits, wardUsed) {
    const userDetails = await dynamoHandler.findUser(userId, username);
    if (!userDetails) {
        // The run's results embed has already been sent by this point (see the
        // followUp below in the callback) — this is a genuine DB error on crediting
        // the reward, not a "no reward earned" case, so the player needs to know their
        // run's reward didn't actually get saved rather than assuming it silently did.
        // Since nothing was written, an admin has nothing to look up either — hand the
        // player the exact numbers as a copy-pasteable block so they can be credited
        // manually instead of the run just being lost.
        const failureReport = {
            userId,
            username,
            floor,
            died,
            rewards: {
                potatoes: rewards[tC.PAYOUT.POTATOES] || 0,
                workMultiplier: rewards[tC.PAYOUT.WORK_MULTIPLIER] || 0,
                passiveIncome: rewards[tC.PAYOUT.PASSIVE_INCOME] || 0,
                bankCapacity: rewards[tC.PAYOUT.BANK_CAPACITY] || 0
            },
            timestamp: new Date().toISOString()
        };
        await interaction.followUp({
            content: `${userDisplayName}, your tower run's rewards could not be saved due to a database error. Send this to an admin so they can manually credit you:\n\`\`\`json\n${JSON.stringify(failureReport, null, 2)}\n\`\`\``,
            ephemeral: true
        });
        return;
    }
    let userMultiplier = userDetails.workMultiplierAmount;
    let userPassiveAmount = userDetails.passiveAmount;
    let userBankCapacity = userDetails.bankCapacity;
    let sweetPotatoBuffs = userDetails.sweetPotatoBuffs;

    if (rewards[tC.PAYOUT.POTATOES]) {
        await dynamoHandler.addUserDatabase(userId, "potatoes", rewards[tC.PAYOUT.POTATOES]);
        await dynamoHandler.addUserDatabase(userId, "totalEarnings", rewards[tC.PAYOUT.POTATOES])
    }
    if (rewards[tC.PAYOUT.WORK_MULTIPLIER]) {
        userMultiplier += rewards[tC.PAYOUT.WORK_MULTIPLIER]
        sweetPotatoBuffs.workMultiplierAmount += rewards[tC.PAYOUT.WORK_MULTIPLIER];
        await dynamoHandler.updateUserDatabase(userId, "workMultiplierAmount", userMultiplier);
    }
    if (rewards[tC.PAYOUT.PASSIVE_INCOME]) {
        userPassiveAmount += rewards[tC.PAYOUT.PASSIVE_INCOME]
        sweetPotatoBuffs.passiveAmount += rewards[tC.PAYOUT.PASSIVE_INCOME];
        await dynamoHandler.updateUserDatabase(userId, "passiveAmount", userPassiveAmount);
    }
    if (rewards[tC.PAYOUT.BANK_CAPACITY]) {
        userBankCapacity += rewards[tC.PAYOUT.BANK_CAPACITY]
        sweetPotatoBuffs.bankCapacity += rewards[tC.PAYOUT.BANK_CAPACITY];
        await dynamoHandler.updateUserDatabase(userId, "bankCapacity", userBankCapacity);
    }
    if (rewards[tC.PAYOUT.WORK_MULTIPLIER] || rewards[tC.PAYOUT.PASSIVE_INCOME] || rewards[tC.PAYOUT.BANK_CAPACITY]) {
        await dynamoHandler.updateUserDatabase(userId, "sweetPotatoBuffs", sweetPotatoBuffs);
    }
    return processTowerCompanionRewards(userId, userDetails, floor, elitesSurvivedCount, towerCompanionHits, wardUsed);
}

module.exports = {
    name: "enter-tower",
    description: "Enter the tater tower once a day",
    callback: async (client, interaction) => {
        await interaction.deferReply();

        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;
        // Full effective power (raw stat + live rebirth/companion workMultiplierPercent
        // bonuses), same formula raidFactory.js already uses for a solo raider's own
        // contribution — see tower.md's "Entry Gate Uses Effective Power" section for why
        // guild/world buffs are deliberately excluded here.
        let userMultiplier = raidFactory.getMemberRaidPower(userDetails);

        if (userMultiplier < tC.ENTRY_GATE_MULTI) {
            interaction.editReply(`${userDisplayName} you are barred entry due to being too weak, reach ${tC.ENTRY_GATE_MULTI}x multiplier before you can enter!`)
            return;
        }

        const canEnterTower = userDetails.canEnterTower;
        if (!canEnterTower) {
            interaction.editReply(`${userDisplayName} you have already entered the tower today!`);
            return;
        }

        await dynamoHandler.updateUserDatabase(userId, "canEnterTower", false);
        // Bastion, the Tower Warden (2026-09-13) — both resolved from the player's CURRENT
        // equipped companion before the run starts (towerFactory itself has no companion/DB
        // knowledge of its own — see its constructor's own comment). towerWardUsedToday is
        // read from this same pre-run userDetails snapshot deliberately (a run started before
        // the daily reset stays ward-eligible for its own duration even if the reset fires
        // mid-run — the same "snapshot taken once, used for the whole run" precedent this.multi
        // already sets).
        const rewardBonus = companionFactory.getActivePerkValue(userDetails, 'towerRewardBonus');
        const hasWard = companionFactory.hasTowerDeathWard(userDetails) && !userDetails.towerWardUsedToday;
        let tF = new towerFactory(interaction, username, userMultiplier, userDetails.autoTowerContinue, rewardBonus, hasWard)
        let tower_out;
        try {
            tower_out = await tF.startRun()
        } catch (e) {
            // Auto-recovery (2026-09-11) — startRun() keeps the whole climb in memory and
            // only ever restores canEnterTower via a full, successful completion (see
            // tower.md's "/admin-reset-tower" section), so ANY uncaught exception mid-run
            // used to strand the player until the next day's 4am UTC reset with no way to
            // recover on their own. Restoring the flag here means a crash costs the player
            // this run's progress, not their whole day. Logging e (not just its message —
            // see the matching fix in handleCommands.js) finally captures a real stack trace
            // to root-cause the crash itself, which static reading alone couldn't pin down.
            console.error(`Tower run crashed for ${username} (${userId}) at floor ${tF.floor}:`, e);
            await dynamoHandler.updateUserDatabase(userId, "canEnterTower", true);
            const recoveryMessage = `${userDisplayName}, your tower run hit an unexpected error around floor ${tF.floor} and had to stop — sorry about that! Nothing from that attempt was banked, but your entry has been restored, so you can run /enter-tower again right away.`;
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: recoveryMessage, embeds: [], components: [] });
                } else {
                    await interaction.reply({ content: recoveryMessage });
                }
            } catch (replyError) {
                console.error(`Failed to notify ${username} of their tower run crash:`, replyError);
            }
            return;
        }
        let rewards = tower_out[0];
        let floor = tower_out[1];
        let died = tower_out[2];
        // Defaulted (|| 0 / || false) so an older or test-mocked startRun() return that only
        // has the original 3 elements can't turn into a NaN/undefined leveling grant or a
        // crash on the drop-award loop below.
        let elitesSurvivedCount = tower_out[3] || 0;
        let towerCompanionHits = tower_out[4] || 0;
        let wardUsed = tower_out[5] || false;

        // embed for final results
        let embed = createResult(rewards, floor, username)
        await interaction.followUp({
            embeds: [embed]
        })

        const bastionAward = await processRewardPayouts(interaction, userId, rewards, username, userDisplayName, floor, died, elitesSurvivedCount, towerCompanionHits, wardUsed);
        if (bastionAward) {
            // Mirrors takeBounty.js's own achievement/quest followUp precedent — a separate
            // embed after the main result, not folded into it.
            await interaction.followUp({
                embeds: [createBastionDropEmbed(bastionAward, userDisplayName)]
            });
        }

        // "Highest floor ever reached" is a broader personal-best than the daily
        // leaderboard's survival-only eligibility below — floor already reflects the
        // last floor actually reached either way (towerFactory decrements it back by
        // one on a lost Elite fight, since dying happens on the way to the next
        // floor), so a died run still legitimately counts toward this record.
        await dynamoHandler.updateIfNewRecord(userId, 'highestTowerFloor', floor);

        // Only a survived run (voluntarily left, not lost to an Elite) counts for the
        // daily leaderboard — see towerLeaderboardFactory.js for how it's ranked/paid out.
        if (!died) {
            await dynamoHandler.recordTowerLeaderboardEntry({
                userId,
                username,
                floor,
                potatoes: rewards[tC.PAYOUT.POTATOES] || 0,
                workMultiplier: rewards[tC.PAYOUT.WORK_MULTIPLIER] || 0,
                passiveIncome: rewards[tC.PAYOUT.PASSIVE_INCOME] || 0,
                bankCapacity: rewards[tC.PAYOUT.BANK_CAPACITY] || 0
            });
        }
    }
}

function createResult(rewards, floor, username){
    const embed = new EmbedBuilder()
        .setTitle(`Tower Run: ${username.toLocaleString()}\nAchieved Floor ${floor.toLocaleString()}!`)
        .setColor('Yellow')
        .setTimestamp(Date.now())
        .setFooter({text: `Tater Tower: ${username}`})
        .setThumbnail("https://cdn.discordapp.com/attachments/1146091052781011026/1207562794057203752/cute-brown-cartoon-potato-character-laughing-and-waving-hands-on-a-white-background-food-and.png?ex=65e0197d&is=65cda47d&hm=57e5b7985e414688367a7318cb3a5b3128cc8affa1d16a25b21c739549269e85&")
        .addFields(
            {
                name: "Potatoes:",
                value: `${rewards[0].toLocaleString()} potatoes`,
                inline: false,
            },
            {
                name: "Work Multiplier:",
                value: `${rewards[1].toFixed(2)} work multiplier`,
                inline: false,
            },
            {
                name: "Passive Income:",
                value: `${rewards[2].toLocaleString()} passive`,
                inline: false,
            },
            {
                name: "Bank Capacity:",
                value: `${rewards[3].toLocaleString()} capacity`,
                inline: false,
            }
        );
        return embed
}

// Bastion, the Tower Warden's drop announcement (2026-09-13) — mirrors createBountyResultEmbed's
// own isNew-branched wording for Yukon exactly (see embedFactory.js), just as a standalone
// followUp embed instead of a field on the main result, matching how this file has no
// EmbedFactory-class embeds of its own to fold it into.
function createBastionDropEmbed(bastionAward, userDisplayName){
    const { isNew, companion } = bastionAward;
    return new EmbedBuilder()
        .setTitle(isNew ? '🗿 A new companion joins you!' : '🗿 Bastion, the Tower Warden (already owned)')
        .setDescription(isNew
            ? `${companion.dropFlavor}`
            : `${userDisplayName} already has Bastion's loyalty — instead, this climb turns up a separate Bastion starting fresh at level 1. Check /companion to see and equip it individually, or sell it with /companion-sell or /companion-sell-npc.`)
        .setColor('Gold')
        .setTimestamp(Date.now())
        .setFooter({text: `Tater Tower: ${userDisplayName}`});
}