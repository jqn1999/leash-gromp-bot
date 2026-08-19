const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails } = require("../../utils/helperCommands")
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Static, pre-authored onboarding content — not derived from user data. Kept here rather
// than in constants.js since it's prose for a command, not a game-balance number.
const ONBOARDING_PAGES = [
    {
        title: "Welcome to Leash Gromp! 🥔",
        description: "A potato economy game — work, grow your stats, and build up a fortune (or lose it all). This is a quick tour of everything there is to do. Use the buttons below to page through it, or jump straight in any time.",
        fields: [
            {
                name: "The core loop",
                value: "`/work` every few minutes for potatoes and a shot at rare encounters. `/bank` what you earn to protect it from `/rob`. Spend potatoes in `/shop` to permanently raise your stats. Repeat, and grow.",
                inline: false,
            },
            {
                name: "Check yourself anytime",
                value: "`/profile` shows your full stat sheet, guild, and active companion.",
                inline: false,
            },
        ]
    },
    {
        title: "/work — Your Main Loop",
        description: "Every `/work` call has a 5 minute cooldown (some companions shorten it) and pays out based on your Work Multiplier and the server's overall wealth.",
        fields: [
            {
                name: "Encounter table",
                value: "Regular (most common) • Large Potato • Sweet Potato (permanent stat buff) • Taro Trader (starches, see later page) • Poison Potato (a loss — careful!) • Metal Potato (rare, big reward) • Golden Potato (rarest, huge reward) • Wandering Companion (~1.5%, see the Companions page)",
                inline: false,
            },
            {
                name: "Tip",
                value: "A bigger Work Multiplier means bigger rewards on almost every encounter — it's the first stat worth investing in.",
                inline: false,
            },
        ]
    },
    {
        title: "Banking, Shops & Regrade",
        description: "Your core stat-growth loop, in order of when you'll use each one.",
        fields: [
            {
                name: "/bank",
                value: "Deposit is taxed a flat fee + a small percentage; deposited potatoes are protected from `/rob`. Withdrawing is free.",
                inline: false,
            },
            {
                name: "/shop and /buy",
                value: "Four permanent upgrade tracks: Work Multiplier, Passive Income, Bank Capacity, and Starch Capacity. Check prices with `/shop`, purchase the next tier with `/buy`.",
                inline: false,
            },
            {
                name: "/regrade",
                value: "Once a shop track is fully maxed, gamble potatoes for a permanent boost past the shop's cap. A losing streak builds a pity bonus, so the odds improve the more you fail in a row.",
                inline: false,
            },
        ]
    },
    {
        title: "Rebirth — Prestige Reset",
        description: "Once every shop tier AND every regrade track is fully maxed, `/rebirth` becomes available.",
        fields: [
            {
                name: "What resets",
                value: "Potatoes, banked potatoes, shop tiers, and regrade progress — back to the start.",
                inline: false,
            },
            {
                name: "What you keep",
                value: "Achievements, personal records, starches, and every permanent buff you've earned.",
                inline: false,
            },
            {
                name: "The reward",
                value: "A live percentage bonus that grows bigger with every rebirth you complete (up to +100%), applied automatically to your Work Multiplier, Passive Income, and Bank Capacity forever — it keeps scaling with whatever you rebuild afterward, not a one-time amount.",
                inline: false,
            },
        ]
    },
    {
        title: "Guilds & Raids",
        description: "Team up for shared goals and bigger rewards.",
        fields: [
            {
                name: "Getting started",
                value: "`/create-guild` to found one, or `/join-guild` after being invited. `/guild` shows your guild's info.",
                inline: false,
            },
            {
                name: "Guild bank",
                value: "Members deposit/withdraw via `/guild-bank`; upgrade its capacity or member cap with `/guild-upgrade`.",
                inline: false,
            },
            {
                name: "Raids",
                value: "`/join-raid` to sign up, then an Elder or above uses `/start-raid` (regular/elite/legendary/stat tiers). Rewards split by contribution, and your guild's level (earned from raid wins) multiplies rewards up to 10x.",
                inline: false,
            },
            {
                name: "Guild Contracts",
                value: "A shared weekly objective for the whole guild — check progress with `/guild-contract`.",
                inline: false,
            },
        ]
    },
    {
        title: "Starch Trading",
        description: "A buy-low-sell-high investment minigame, separate from the main potato economy.",
        fields: [
            {
                name: "Earning starches",
                value: "The Taro Trader `/work` encounter pays out in starches instead of potatoes.",
                inline: false,
            },
            {
                name: "Trading windows (EST)",
                value: "Buying: Monday 10am–10pm, and Thursday 10pm through Friday 10am. Selling: every other time.",
                inline: false,
            },
            {
                name: "Check the market",
                value: "`/starch` shows the current window, price, and how much you could buy or sell right now.",
                inline: false,
            },
        ]
    },
    {
        title: "Companions",
        description: "A second permanent-bonus track, earned through luck rather than pure grinding.",
        fields: [
            {
                name: "Getting one",
                value: "Keep working — a Wandering Companion encounter can happen on any `/work` call. 10 companions across 4 rarities, each with its own perk.",
                inline: false,
            },
            {
                name: "Equip one",
                value: "Only one is active at a time. `/companion` shows your collection and lets you switch.",
                inline: false,
            },
            {
                name: "Trade",
                value: "List a companion you don't need on `/companion-market`, or buy one another player's selling with `/companion-buy`.",
                inline: false,
            },
        ]
    },
    {
        title: "Daily & Ongoing Goals",
        description: "Recurring content beyond the core `/work` loop.",
        fields: [
            {
                name: "/enter-tower",
                value: "One roguelike climb per day, resetting at midnight EST. Survive and rank on `/tower-leaderboard` for bonus rewards — dying forfeits leaderboard eligibility, so know when to walk away.",
                inline: false,
            },
            {
                name: "/quests",
                value: "Daily and weekly objectives for extra potato rewards.",
                inline: false,
            },
            {
                name: "/achievements",
                value: "Dozens of milestones tracked automatically as you play — check your progress anytime.",
                inline: false,
            },
        ]
    },
    {
        title: "Other Games & Where to Start",
        description: "Lighter, faster ways to play — and a concrete first move.",
        fields: [
            {
                name: "/rob",
                value: "Attempt to steal potatoes from another player. Risky — there's a cooldown and a fine if you fail.",
                inline: false,
            },
            {
                name: "/coinflip, /rps, /bet",
                value: "Quick wagers for a fast round or two.",
                inline: false,
            },
            {
                name: "Start here",
                value: "Run `/work` now, `/bank` what you earn, and check `/shop` once you've saved up a few thousand potatoes. Everything else unlocks naturally from there.",
                inline: false,
            },
        ]
    },
];

function buildPaginationRow(pageIndex, totalPages) {
    const prevButton = new ButtonBuilder()
        .setCustomId('start_prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === 0);
    const nextButton = new ButtonBuilder()
        .setCustomId('start_next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(pageIndex === totalPages - 1);
    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

module.exports = {
    name: "start",
    description: "A guided tour of everything Leash Gromp has to offer",
    devOnly: false,
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply({ ephemeral: true });
        const [, , userDisplayName] = getUserInteractionDetails(interaction);

        let pageIndex = 0;
        const totalPages = ONBOARDING_PAGES.length;

        const embed = embedFactory.createOnboardingPageEmbed(userDisplayName, ONBOARDING_PAGES[pageIndex], pageIndex, totalPages);
        const reply = await interaction.editReply({ embeds: [embed], components: [buildPaginationRow(pageIndex, totalPages)] });

        const collectorFilter = i => i.user.id === interaction.user.id;
        while (true) {
            const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 120_000 }).catch(() => null);
            if (!confirmation) {
                await reply.edit({ components: [] }).catch(() => {});
                break;
            }

            pageIndex = confirmation.customId === 'start_next' ? pageIndex + 1 : pageIndex - 1;
            const pageEmbed = embedFactory.createOnboardingPageEmbed(userDisplayName, ONBOARDING_PAGES[pageIndex], pageIndex, totalPages);
            await confirmation.update({ embeds: [pageEmbed], components: [buildPaginationRow(pageIndex, totalPages)] });
        }
    }
}
