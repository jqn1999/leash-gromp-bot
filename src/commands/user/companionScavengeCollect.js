const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const rebirthFactory = require("../../utils/rebirthFactory");
const { getGuildWorkMulti, getCompanionWorkMulti, getWorldBuffWorkMulti, applyCatchUp } = require("../../utils/workFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

const SCAVENGE_AGAIN_ID = 'scavenge_again';

// Same instance, straight back out — spares a player who just wants to keep the same
// companion cycling the extra /companion-scavenge round trip. Reuses
// companionFactory.validateScavengeDispatch (companionScavenge.js's own command runs the
// exact same check) rather than assuming it's still valid: the instance could have been
// sold/fused, re-equipped as active, or already re-dispatched elsewhere in the time this
// button sat on screen, so this re-validates against a FRESH read rather than the
// userDetails this reply was originally rendered with.
function buildScavengeAgainRow(disabled = false) {
    const button = new ButtonBuilder()
        .setCustomId(SCAVENGE_AGAIN_ID)
        .setLabel('Scavenge Again')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled);
    return new ActionRowBuilder().addComponents(button);
}

module.exports = {
    name: "companion-scavenge-collect",
    description: "Collect the reward from a companion that's back from scavenging",
    devOnly: false,
    deleted: false,
    options: [],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const scavenging = userDetails.companions?.scavenging;
        if (!scavenging) {
            interaction.editReply(`${userDisplayName}, nothing is out scavenging right now.`);
            return;
        }
        if (scavenging.returnsAt > Date.now()) {
            const remainingSeconds = Math.max(0, Math.ceil((scavenging.returnsAt - Date.now()) / 1000));
            interaction.editReply(`${userDisplayName}, that companion isn't back yet — it returns in ${convertSecondstoMinutes(remainingSeconds)}.`);
            return;
        }

        const ownedEntryBefore = companionFactory.getOwnedEntry(userDetails, scavenging.instanceId);
        const companion = companionFactory.getCompanionById(ownedEntryBefore?.id);
        const workCountBefore = ownedEntryBefore?.workCount || 0;

        // Multi-scaled starch bonus (2026-09-07, direct instruction — see
        // companionFactory.getScavengeMultiplierBonus's own comment) — computed the exact
        // same way workFactory.js's handleGoldenYam computes its own effective multiplier,
        // so "up to 100% of what a Golden Yam would give this player" is literal. Only
        // Legendary/Mythic/Heirloom scavenges actually use this (Common/Rare have no
        // GOLDEN_YAM_VALUE_PERCENT entry, so the bonus resolves to a flat 0 for them
        // regardless), but it's cheap to always compute rather than branch on rarity here.
        const userMultiplier = userDetails.workMultiplierAmount;
        const guildMultiplier = await getGuildWorkMulti(userDetails, userMultiplier);
        const companionMultiplier = getCompanionWorkMulti(userDetails, userMultiplier);
        const rebirthMultiplier = userMultiplier * rebirthFactory.getLiveRebirthPercent(userDetails);
        const worldBuffMultiplier = await getWorldBuffWorkMulti(userMultiplier);
        const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);
        const effectiveMultiplier = applyCatchUp(userMultiplier + guildMultiplier + companionMultiplier + rebirthMultiplier + worldBuffMultiplier, catchUpBonus);

        const { owned, starchesGained, workCountGained, multiplierTier, scavengeReturnsByRarity, maxLevelCount, mythicMaxLevelCount } = companionFactory.resolveScavengeReward(userDetails, effectiveMultiplier);

        const written = await dynamoHandler.resolveScavenge(userId, scavenging.instanceId, {
            companions: { ...userDetails.companions, owned, scavenging: null, scavengeReturnsByRarity, maxLevelCount, mythicMaxLevelCount },
            starches: (userDetails.starches || 0) + starchesGained
        });
        if (!written) {
            interaction.editReply(`${userDisplayName}, that scavenge was already collected (or cancelled) elsewhere. Please try again!`);
            return;
        }

        const embed = embedFactory.createScavengeReturnEmbed(userDisplayName, companion, workCountBefore, workCountBefore + workCountGained, starchesGained, multiplierTier);
        const reply = await interaction.editReply({ embeds: [embed], components: [buildScavengeAgainRow()] });

        // Legendary Legwork / Mythic Milestones / Max-Level capstone — checked against the
        // just-written counts rather than re-fetching, same "build the post-write shape
        // locally" shortcut work.js's own achievement check takes.
        const newlyUnlocked = await achievementFactory.checkAndUnlock({
            userId,
            achievements: userDetails.achievements,
            companions: { ...userDetails.companions, scavengeReturnsByRarity, maxLevelCount, mythicMaxLevelCount }
        });
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            interaction.followUp({ embeds: achievementEmbeds });
        }

        // Same instanceId that just came home — re-sends THAT companion, not whichever
        // instance happens to be active. One click only; the button is always cleared
        // afterward (success or not) rather than left clickable for a second, now-stale
        // dispatch. A bystander's click is ignored, same collectorFilter convention as
        // shop.js's own buy button.
        const collectorFilter = i => i.user.id === interaction.user.id;
        const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
        if (!clicked || clicked.customId !== SCAVENGE_AGAIN_ID) {
            await reply.edit({ components: [] }).catch(() => {});
            return;
        }
        await clicked.deferUpdate();

        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        if (!freshUserDetails) {
            await reply.edit({ components: [] }).catch(() => {});
            return;
        }
        const validation = companionFactory.validateScavengeDispatch(freshUserDetails, scavenging.instanceId);
        if (!validation.ok) {
            let errorText;
            switch (validation.reason) {
                case 'not-owned':
                    errorText = `${userDisplayName}, you don't own that companion anymore.`;
                    break;
                case 'is-active':
                    errorText = `${userDisplayName}, ${validation.companion.name} is now your active companion — equip a different one first before sending it scavenging.`;
                    break;
                case 'ready-to-collect':
                    errorText = `${userDisplayName}, ${validation.scavengingName} is already out scavenging and ready to come home — run /companion-scavenge-collect first!`;
                    break;
                case 'already-scavenging': {
                    const remainingSeconds = Math.max(0, Math.ceil((validation.returnsAt - Date.now()) / 1000));
                    errorText = `${userDisplayName}, ${validation.scavengingName} is already out scavenging — it returns in ${convertSecondstoMinutes(remainingSeconds)}.`;
                    break;
                }
                default:
                    errorText = `${userDisplayName}, that companion can't be sent scavenging right now.`;
            }
            await interaction.followUp({ content: errorText });
            await reply.edit({ components: [] }).catch(() => {});
            return;
        }

        const { companion: againCompanion, ownedEntry: againOwnedEntry } = validation;
        const newScavenging = companionFactory.buildScavengeDispatch(againCompanion, scavenging.instanceId, againOwnedEntry.workCount);
        const updatedOwned = freshUserDetails.companions.owned.map(o =>
            o.instanceId === scavenging.instanceId ? { ...o, lastUsedAt: Date.now() } : o
        );
        await dynamoHandler.updateUserFields(userId, {
            companions: { ...freshUserDetails.companions, owned: updatedOwned, scavenging: newScavenging }
        });

        await interaction.followUp({
            content: `${userDisplayName}, ${againCompanion.name} heads back out scavenging! It'll be back in ${convertSecondstoMinutes(Math.ceil((newScavenging.returnsAt - Date.now()) / 1000))} — run /companion-scavenge-collect once it's returned.`
        });
        await reply.edit({ components: [] }).catch(() => {});
    }
}
