const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");

// Fire-and-forget signup mirroring /join-world-raid exactly — any mercenary can freely
// sign up, ADD-only, idempotent. Every mercenary who signs up this cycle is collapsed
// into exactly ONE combined entrant (the Merc Faction) at resolution — only the top-N by
// power actually count toward the Faction's lottery ticket, see
// spudKeepFactory.resolveCycle/systems/spud-keep.md for the exact mechanic. Signing up
// costs nothing and being uncounted this cycle costs nothing either (personal Bounty
// progression, achievements, etc. are all untouched).
module.exports = {
    name: "spud-keep-signup",
    description: "Sign up as a mercenary for today's Spud Keep contest (joins the Merc Faction)",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        if (!userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, you're not a mercenary — run /become-mercenary first (you can't be in a guild).`);
            return;
        }

        const spudKeep = await dynamoHandler.getStatDatabase("spud_keep") || {};
        const mercenaryEntrants = spudKeep.mercenaryEntrants || [];
        if (mercenaryEntrants.some(m => m.id === userId)) {
            interaction.editReply(`${userDisplayName}, you've already signed up for this cycle's Spud Keep contest — check /current-spud-keep for the live standings.`);
            return;
        }

        mercenaryEntrants.push({ id: userId, username: username });
        await dynamoHandler.updateStatFields("spud_keep", { mercenaryEntrants });

        interaction.editReply(`${userDisplayName}, you've joined the Merc Faction for today's Spud Keep contest! ${mercenaryEntrants.length.toLocaleString()} mercenar${mercenaryEntrants.length === 1 ? 'y' : 'ies'} signed up so far — only the top mercenaries by power count toward the Faction's odds at resolution. Check /current-spud-keep for a live preview.`);
    }
}
