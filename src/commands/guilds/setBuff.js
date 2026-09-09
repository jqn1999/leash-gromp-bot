const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles, BuffSwitchCooldown } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const guildBuffFactory = require("../../utils/guildBuffFactory");

module.exports = {
    name: "set-buff",
    description: "Set guild buff for all members",
    options: [
        {
            name: 'buff',
            description: 'buff choices',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'rob-chance',
                    value: 'robChance'
                },
                {
                    name: 'raid-timer',
                    value: 'raidTimer'
                },
                {
                    name: 'work-timer',
                    value: 'workTimer'
                },
                {
                    name: 'work-multi',
                    value: 'workMulti'
                }
            ]
        }
    ],

    callback: async (client, interaction) => {
        await interaction.deferReply()
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to select a buff for!");
        if (!guild) return;
        const guildId = guild.guildId;
        const memberList = guild.memberList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        let canBuff = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canBuff) {
            interaction.editReply(`${userDisplayName} you must be a co-leader or the guild leader to set the guild buff!`);
            return;
        }
        let buffSelect = interaction.options.get('buff')?.value;

        // Same-category re-pick rejected as a no-op (2026-09-09, direct instruction —
        // /set-buff gets the same switch-cooldown gate /set-mercenary-buff already has),
        // checked BEFORE the cooldown gate so this rejection never wrongly implies a
        // cooldown block that isn't the actual reason. No DB write, cooldown untouched.
        if (guild.guildBuff === buffSelect) {
            interaction.editReply(`${userDisplayName}, ${guild.guildName}'s guild buff is already set to **${buffSelect}** — pick a different category to switch.`);
            return;
        }

        // Cooldown check — skipped entirely on a first-ever switch, since
        // guildBuffSwitchTimer defaults to 0 (Date.now() - 0 is always far past the
        // cooldown, no special-casing needed — same "0 = never blocked" precedent
        // mercenaryBuffSwitchTimer/guildMercenarySwitchTimer already set).
        const timeSinceSwitchInSeconds = Math.floor((Date.now() - (guild.guildBuffSwitchTimer || 0)) / 1000);
        const timeUntilSwitchAvailableInSeconds = BuffSwitchCooldown.GUILD_SWITCH_COOLDOWN_SECONDS - timeSinceSwitchInSeconds;
        if (timeSinceSwitchInSeconds < BuffSwitchCooldown.GUILD_SWITCH_COOLDOWN_SECONDS) {
            interaction.editReply(`${userDisplayName}, ${guild.guildName}'s guild buff was switched recently — wait ${convertSecondstoMinutes(timeUntilSwitchAvailableInSeconds)} before switching again.`);
            return;
        }

        // store buff into guild db
        const switchTimer = Date.now();
        await dynamoHandler.updateGuildDatabase(guildId, 'guildBuff', buffSelect);
        await dynamoHandler.updateGuildDatabase(guildId, 'guildBuffSwitchTimer', switchTimer);
        const level = guildBuffFactory.getGuildLevel(guild.raidCount);
        const nextSwitchAvailable = Math.floor((switchTimer + BuffSwitchCooldown.GUILD_SWITCH_COOLDOWN_SECONDS * 1000) / 1000);
        interaction.editReply(`Guild buff for ${guild.guildName} has been set to **${buffSelect}**: ${guildBuffFactory.getGuildBuffLabel(buffSelect, level)}. Next switch available <t:${nextSwitchAvailable}:R>.`)
    }
}