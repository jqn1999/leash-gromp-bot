const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

// Support tool for the class of bug where a player gets stuck unable to run /enter-tower
// again until the next day's 4am UTC reset. enter-tower.js flips canEnterTower to false
// BEFORE the run itself starts (see enter-tower.js's own comment) and nothing ever flips
// it back except that daily cron or a fully-completed run — so any crash partway through a
// run (a thrown error, a stale/expired interaction token, Discord itself dropping a
// component interaction) permanently consumes that player's entry for the rest of the day
// with no way for them to recover on their own. The run's own floor/reward progress is
// never persisted mid-run (towerFactory.js keeps it entirely in memory until the very end),
// so there's nothing else to roll back — restoring canEnterTower is the complete fix.
module.exports = {
    name: "admin-reset-tower",
    description: "Admin — resets a player's daily Tower entry so they can run /enter-tower again",
    devOnly: true,
    deleted: false,
    options: [
        {
            name: 'player',
            description: 'Which player to reset',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        }
    ],
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });

        let targetUserId = interaction.options.get('player')?.value;
        const targetUser = await interaction.guild.members.fetch(targetUserId).catch(() => null);
        if (!targetUser) {
            interaction.editReply(`That user doesn't exist in this server.`);
            return;
        }
        targetUserId = targetUser.id;
        const targetUserDisplayName = targetUser.displayName;
        const targetUsername = targetUser.user.username;

        const targetUserDetails = await dynamoHandler.findUser(targetUserId, targetUsername);
        if (!targetUserDetails) {
            interaction.editReply(`${targetUserDisplayName} could not be looked up due to a database error, please try again!`);
            return;
        }

        const alreadyCouldEnter = targetUserDetails.canEnterTower === true;
        await dynamoHandler.updateUserDatabase(targetUserId, "canEnterTower", true);

        interaction.editReply(alreadyCouldEnter
            ? `${targetUserDisplayName} could already run /enter-tower — nothing was stuck, but their entry is confirmed available.`
            : `${targetUserDisplayName}'s Tower entry has been reset — they can run /enter-tower again right away.`);
    }
}
