const { ApplicationCommandOptionType, PermissionFlagsBits } = require("discord.js");
const festivalFactory = require("../../utils/festivalFactory");
const { Festival, FestivalTemplates } = require("../../utils/constants");

// Same channel/role backgroundEvents.js's own cron announcements post to.
const EVENT_CHANNEL_ID = '1188525931346792498';
const EVENT_ROLE_ID = '1207117686526582865';

const FESTIVAL_CHOICES = Object.keys(FestivalTemplates).map(festivalId => ({
    name: Festival.NAME[festivalId] || festivalId,
    value: festivalId,
}));

// Seasonal Festivals (systems/seasonal-festivals.md) — admin-triggered start, CONFIRMED
// by product owner over a real content calendar for v1 ("im fine with it being admin
// started"). Mirrors admin-trigger-event.js's own shape exactly (devOnly + Administrator,
// a manual write to a shared doc everyone picks up on next read) rather than inventing a
// new moderation pattern. NOTE per the build brief: if a separate consolidated /admin
// command with subcommands lands in this repo, this should be folded into it as a new
// subcommand rather than staying its own top-level command — it was built standalone here
// because src/commands/moderation/admin.js didn't exist yet at implementation time.
module.exports = {
    name: "admin-start-festival",
    description: "Start a Seasonal Festival for a fixed number of days (admin only)",
    devOnly: true,
    deleted: false,
    options: [
        {
            name: 'festival',
            description: 'Which festival to start',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: FESTIVAL_CHOICES,
        },
        {
            name: 'duration_days',
            description: `How many days it runs (${Festival.MIN_DURATION_DAYS}-${Festival.MAX_DURATION_DAYS})`,
            required: true,
            type: ApplicationCommandOptionType.Integer,
        },
        {
            name: 'announce',
            description: 'Post the public announcement to the events channel? (default: yes)',
            required: false,
            type: ApplicationCommandOptionType.Boolean,
        }
    ],
    permissionsRequired: [PermissionFlagsBits.Administrator],
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const festivalId = interaction.options.get('festival')?.value;
        const durationDays = interaction.options.get('duration_days')?.value;
        const announce = interaction.options.get('announce')?.value ?? true;

        const festival = await festivalFactory.startFestival(festivalId, durationDays);
        if (!festival) {
            interaction.editReply(`"${festivalId}" isn't a recognized festival.`);
            return;
        }

        const festivalName = Festival.NAME[festivalId] || festivalId;
        const tokenLabel = Festival.TOKEN_LABEL[festivalId] || 'Festival Tokens';
        const endsAtSeconds = Math.floor(festival.endsAt / 1000);

        if (announce) {
            const channel = await client.channels.fetch(EVENT_CHANNEL_ID);
            await channel.send(`<@&${EVENT_ROLE_ID}> The **${festivalName}** has begun! Check /festival for objectives and /festival-shop to spend ${tokenLabel} — ends <t:${endsAtSeconds}:R>.`);
            interaction.editReply(`Started ${festivalName} for ${Math.round((festival.endsAt - festival.startsAt) / (24 * 60 * 60 * 1000))} day(s) — announced in <#${EVENT_CHANNEL_ID}>.`);
        } else {
            interaction.editReply(`Started ${festivalName}, ending <t:${endsAtSeconds}:R> — no announcement sent.`);
        }
    }
}
