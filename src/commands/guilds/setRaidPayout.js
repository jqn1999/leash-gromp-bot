const { ApplicationCommandOptionType } = require("discord.js");
const { GuildRoles } = require("../../utils/constants");
const { getUserInteractionDetails, requireUserDetails, requireUserGuild } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

// Per-guild opt-in toggle for whether a raid REWARD fills the guild bank up to capacity
// first ('bank', today's default behavior — startRaid.js's addToBankOrPurse) or is paid
// straight to raiders every time, skipping the bank entirely regardless of remaining
// space ('direct'). Rewards only — raid penalties still drain the bank first under both
// modes (removeFromBankOrPurse is untouched by this setting), so a full bank stays
// meaningfully protective either way. Added because raidSplitMode (see setRaidSplit.js)
// only ever mattered once the bank was already full — a guild without a full bank saw
// every reward silently absorbed regardless of its even/contribution split choice.
// Deliberately NOT a forced replacement of bank-first — see guild.raidPayoutMode's
// default in dynamoHandler.js's getDefaultGuildFields, self-healed onto every
// pre-existing guild the same way raidSplitMode already is.
const RAID_PAYOUT_MODE_LABELS = {
    bank: 'Bank-First — raid rewards fill the guild bank up to capacity before anything reaches raiders directly',
    direct: 'Direct-to-Raiders — raid rewards are paid straight to raiders every time, bypassing the guild bank entirely'
};

module.exports = {
    name: "set-raid-payout",
    description: "Set whether your guild's raid rewards fill the guild bank first or pay raiders directly",
    options: [
        {
            name: 'mode',
            description: 'How raid rewards are paid out',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'bank-first',
                    value: 'bank'
                },
                {
                    name: 'direct-to-raiders',
                    value: 'direct'
                }
            ]
        }
    ],

    callback: async (client, interaction) => {
        await interaction.deferReply()
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const guild = await requireUserGuild(interaction, userDetails, userDisplayName, "you have no guild to set the raid payout mode for!");
        if (!guild) return;
        const guildId = guild.guildId;
        const memberList = guild.memberList;

        const member = memberList.find((currentMember) => currentMember.id == userId)
        if (!member) {
            interaction.editReply(`${userDisplayName} there was an error retrieving your member data in your guild. Let an admin know!`);
            return;
        }

        let canSetRaidPayout = member.role == GuildRoles.LEADER || member.role == GuildRoles.COLEADER;
        if (!canSetRaidPayout) {
            interaction.editReply(`${userDisplayName} you must be a co-leader or the guild leader to set the raid payout mode!`);
            return;
        }
        let raidPayoutMode = interaction.options.get('mode')?.value;

        await dynamoHandler.updateGuildDatabase(guildId, 'raidPayoutMode', raidPayoutMode);
        interaction.editReply(`Raid reward payout for ${guild.guildName} has been set to **${raidPayoutMode}**: ${RAID_PAYOUT_MODE_LABELS[raidPayoutMode]}`)
    }
}
