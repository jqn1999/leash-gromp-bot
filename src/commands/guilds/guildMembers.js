const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { EmbedFactory } = require("../../utils/embedFactory");
const { getMemberRaidPower } = require("../../utils/raidFactory");
const embedFactory = new EmbedFactory();

module.exports = {
    name: "guild-members",
    description: "Displays the members of a guild",
    devOnly: false,
    options: [
        {
            name: 'guild-name',
            description: 'Name of guild you want to display',
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    // Same shape as guild.js's own autocomplete — matches case-insensitively but returns
    // each guild's real stored casing, never a forced upper/lowercase transform.
    autocomplete: async (client, interaction) => {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const allGuilds = await dynamoHandler.getSortedGuildsById();
        const choices = allGuilds
            .filter(g => g.guildName.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(g => ({ name: g.guildName, value: g.guildName }));
        await interaction.respond(choices);
    },
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        let guild;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        let guildName = interaction.options.get('guild-name')?.value;
        if (!guildName) {
            const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
            if (!userDetails) return;

            const userGuildId = userDetails.guildId;
            if (!userGuildId) {
                interaction.editReply(`${userDisplayName} you have no guild to display members of!`);
                return;
            }
            guild = await dynamoHandler.findGuildById(userDetails.guildId);
        } else {
            guild = await dynamoHandler.findGuildByName(guildName);
        }

        if (!guild) {
            interaction.editReply(`${userDisplayName} there was an error looking for the given guild! Check your input and try again!`);
            return;
        }

        // Titles (systems/titles.md, "more places titles show up" pass, 2026-09-27) —
        // guild.memberList is only {id, username, role}, so unlike the raid/World Boss
        // embeds this genuinely costs one findUser per member (typical guild sizes are
        // small, so this stays cheap in practice). Enriched in place, same pattern
        // startRaid.js's resolveRaid uses for its own raidList.
        const memberDetails = await Promise.all(guild.memberList.map(m => dynamoHandler.findUser(m.id, m.username)));
        guild.memberList.forEach((member, i) => { member.equippedTitle = memberDetails[i]?.equippedTitle || null; });

        // Ordered by role first, then by power within each role (direct instruction,
        // 2026-09-27: "guild list by role first then sorted within each role so leader then
        // coleaders etc"). createGuildMemberListEmbed already buckets memberList by role via
        // separate .find()/.filter() calls per role — sorting memberList by power BEFORE that
        // runs means each role bucket comes out power-sorted for free, since .filter()
        // preserves relative order; no changes needed inside the embed function itself.
        const powerByUserId = new Map(guild.memberList.map((m, i) => [m.id, getMemberRaidPower(memberDetails[i])]));
        guild.memberList.sort((a, b) => powerByUserId.get(b.id) - powerByUserId.get(a.id));

        const embed = embedFactory.createGuildMemberListEmbed(guild, interaction);
        interaction.editReply({ embeds: [embed] });
    }
}