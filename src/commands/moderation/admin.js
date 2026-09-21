const { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { getUserInteractionDetails, getRandomFromInterval, requireUserDetails } = require("../../utils/helperCommands");
const { Work, Companions, Festival, FestivalTemplates } = require("../../utils/constants");
const { EventFactory, buildActiveEventPayload, WORK_SCENARIO_INDICES } = require("../../utils/eventFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const { worldFactory, worldBossMobs } = require("../../utils/worldFactory");
const { setWorkScenarios } = require("../user/work.js");
const work = require("./../user/work");
const { ensureGuildChatCategory, addChatChannelIndexEntry, removeChatChannelIndexEntry } = require("../guilds/guildChat");
const festivalFactory = require("../../utils/festivalFactory");

const embedFactory = new EmbedFactory();
const achievementFactory = new AchievementFactory();

// /admin — a single devOnly Discord command grouping every admin/moderation subcommand
// (2026-09-20, incident fix — see roadmap.md's "Discord 100-command cap hit on startup"
// entry). Before this, each of the first 8 subcommands below was its own top-level command
// file, which pushed the guild's non-deleted command count to 101 and made
// applicationCommands.create for a brand-new command (set-merc-chat-channel) throw
// DiscordAPIError[30032] on every bot startup, permanently stuck since nothing ever
// retried it. Consolidating 8 commands into 1 (7 Subcommand entries + this file's own top
// level) frees 7 slots. Each subcommand's own logic is preserved verbatim from its original
// file — only the file's shape (module boundary, option name -> Subcommand name) changed,
// not any behavior, DB call, embed, or error message. `start-festival` was added as a 9th
// subcommand later, during the Seasonal Festivals merge — it never had its own top-level
// command file live in this repo (built standalone in an isolated worktree, then folded in
// here on merge since admin.js existed by then) — see seasonal-festivals.md.
//
// Every one of these was already devOnly + (mostly) Administrator-gated; see
// handleCommands.js's dispatch order — permissionsRequired is checked only for members who
// already passed the devOnly check, and that same check unconditionally lets any dev bypass
// permissionsRequired too, so folding all 9 under one devOnly + Administrator gate changes
// nothing observable for any of them.

async function runGive(client, interaction) {
    const userDisplayName = interaction.user.displayName;

    let amount = interaction.options.get('amount')?.value;
    amount = Math.floor(Number(amount));
    if (isNaN(amount)) {
        interaction.reply({
            content: `${userDisplayName}, something went wrong with your amount to give. Try again!`,
            ephemeral: true
        });
        return;
    }

    let targetUserDisplayName, targetUsername;
    let targetUserId = interaction.options.get('recipient')?.value;
    if (targetUserId) {
        const targetUser = await interaction.guild.members.fetch(targetUserId);
        if (!targetUser) {
            interaction.reply({
                content: 'That user doesn\'t exist in this server.',
                ephemeral: true
            });
            return;
        }
        targetUserId = targetUser.id
        targetUserDisplayName = targetUser.displayName;
        targetUsername = targetUser.user.username;
    }
    const targetUserDetails = await dynamoHandler.findUser(targetUserId, targetUsername);
    if (!targetUserDetails) {
        interaction.reply({
            content: `${targetUserDisplayName} could not be looked up due to a database error, please try again!`,
            ephemeral: true
        });
        return;
    };
    let targetUserPotatoes = targetUserDetails.potatoes;

    targetUserPotatoes += amount;
    await dynamoHandler.updateUserDatabase(targetUserId, "potatoes", targetUserPotatoes);
    interaction.reply({
        content: `${userDisplayName}, you spawn and give ${amount} potatoes to ${targetUserDisplayName}. They now have ${targetUserPotatoes} potatoes`,
        ephemeral: true
    });
}

// Support tool for the class of bug where a player gets stuck unable to run /enter-tower
// again until the next day's 8pm ET reset. enter-tower.js flips canEnterTower to false
// BEFORE the run itself starts (see enter-tower.js's own comment) and nothing ever flips
// it back except that daily cron or a fully-completed run — so any crash partway through a
// run (a thrown error, a stale/expired interaction token, Discord itself dropping a
// component interaction) permanently consumes that player's entry for the rest of the day
// with no way for them to recover on their own. The run's own floor/reward progress is
// never persisted mid-run (towerFactory.js keeps it entirely in memory until the very end),
// so there's nothing else to roll back — restoring canEnterTower is the complete fix.
async function runResetTower(client, interaction) {
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

async function runStats(client, interaction) {
    await interaction.deferReply({ ephemeral: true });

    const [economy, starch, world, activeQuests] = await Promise.all([
        dynamoHandler.getStatDatabase("economy"),
        dynamoHandler.getStatDatabase("starch"),
        dynamoHandler.getStatDatabase("world"),
        dynamoHandler.getActiveQuests(),
    ]);

    // Buy/sell window check, identical to starchPrice.js/buyStarch.js/sellStarch.js —
    // Monday 10:00-21:59, Thursday 22:00-23:59, Friday 00:00-09:59 is a buy window,
    // everything else is a sell window.
    const date = new Date();
    const isMondayAndBuyingTime = date.getDay() == 1 && (date.getHours() >= 10 && date.getHours() <= 21);
    const isThursdayAndBuyingTime = date.getDay() == 4 && date.getHours() >= 22;
    const isFridayAndBuyingTime = date.getDay() == 5 && date.getHours() <= 9;
    const isBuyWindow = isMondayAndBuyingTime || isThursdayAndBuyingTime || isFridayAndBuyingTime;
    const starchStatus = {
        phase: isBuyWindow ? 'buy' : 'sell',
        price: starch ? (isBuyWindow ? starch.starch_buy : starch.starch_sell) : null,
    };

    // world_index only means anything while world_active is true — an inactive doc's
    // stale index shouldn't be resolved against worldBossMobs.
    const worldActive = !!(world && world.world_active);
    const worldStatus = {
        active: worldActive,
        bossName: worldActive ? (worldBossMobs[world.world_index]?.name ?? "Unknown boss") : null,
        raidMemberCount: worldActive ? (world.world_list || []).length : 0,
    };

    const embed = embedFactory.createAdminStatsEmbed(economy, starchStatus, worldStatus, activeQuests);
    interaction.editReply({ embeds: [embed] });
}

// Same channel/role backgroundEvents.js's own hourly roll posts to — this subcommand is a
// manual trigger for the exact same event, not a separate/quieter path.
const EVENT_CHANNEL_ID = '1188525931346792498';
const EVENT_ROLE_ID = '1207117686526582865';

// eF is the SAME singleton backgroundEvents.js holds (EventFactory guards its own
// constructor against a second instance) — mutating it here is exactly as real as the
// scheduled hourly roll, not a preview/test copy.
const eF = new EventFactory();

const EVENT_CHOICES = [
    { name: 'Large Potato chance x2', value: 'LARGEX2' },
    { name: 'Sweet Potato chance x2', value: 'SWEETX2' },
    { name: 'Metal Potato chance x2', value: 'METALX2' },
    { name: 'Poison Potato chance x2', value: 'POISONX2' },
    { name: 'Taro Trader chance x2', value: 'TAROX2' },
    { name: 'Golden Potato chance x5', value: 'GOLDENX5' },
    { name: 'Metal Potato chance x5', value: 'METALX5' },
    { name: 'Poison Potato chance x5', value: 'POISONX5' },
    { name: 'Clear current event (back to normal odds)', value: 'CLEAR' },
];

async function runTriggerEvent(client, interaction) {
    await interaction.deferReply({ ephemeral: true });
    const event = interaction.options.get('event')?.value;
    const announce = interaction.options.get('announce')?.value ?? true;

    if (event === 'CLEAR') {
        eF.setEmptyCurrentEvent();
        setWorkScenarios(eF.getWorkChances());
        // Keeps financial-project's /gromp in sync with this manual clear too — otherwise
        // an admin-cleared event would keep boosting the website's own odds until the next
        // natural hourly roll overwrote it.
        dynamoHandler.updateStatFields('active_work_event', buildActiveEventPayload(null))
            .catch(err => console.log('admin trigger-event: active work event clear failed:', err));
        interaction.editReply(`Cleared the current event — /work odds are back to normal.`);
        return;
    }

    // Mirrors backgroundEvents.js's own hourly roll exactly, just skipping the random
    // pick: apply -> push the boosted odds live -> reset the singleton back to base so
    // it's ready for the next natural roll or trigger, same as the scheduled job does.
    eF.applyEvent(event);
    const eventName = eF.getCurrentEvent();
    setWorkScenarios(eF.getWorkChances());
    eF.setBaseWorkChances();
    eF.setBaseWorkProbability();
    // Same mirror as backgroundEvents.js's natural roll — a manually triggered event should
    // show up on the website too, not just Discord.
    await dynamoHandler.updateStatFields('active_work_event', buildActiveEventPayload(event, eventName))
        .catch(err => console.log('admin trigger-event: active work event persist failed:', err));

    if (announce) {
        const channel = await client.channels.fetch(EVENT_CHANNEL_ID);
        await channel.send(`<@&${EVENT_ROLE_ID}> Special event on the way this hour! ${eventName}`);
        interaction.editReply(`Triggered: ${eventName} — announced in <#${EVENT_CHANNEL_ID}>. Odds are live now and will hold until the next hourly event roll (not a fixed duration).`);
    } else {
        interaction.editReply(`Triggered: ${eventName} — no announcement sent, odds are live now and will hold until the next hourly event roll (not a fixed duration).`);
    }
}

const SCENARIO_TYPES = {
    regular: WORK_SCENARIO_INDICES.REGULAR,
    large: WORK_SCENARIO_INDICES.LARGE,
    sweet: WORK_SCENARIO_INDICES.SWEET,
    taro: WORK_SCENARIO_INDICES.TARO,
    poison: WORK_SCENARIO_INDICES.POISON,
    metal: WORK_SCENARIO_INDICES.METAL,
    golden: WORK_SCENARIO_INDICES.GOLDEN,
    companion: WORK_SCENARIO_INDICES.COMPANION,
    ancient: WORK_SCENARIO_INDICES.ANCIENT,
    mimic: WORK_SCENARIO_INDICES.MIMIC,
    goldenyam: WORK_SCENARIO_INDICES.GOLDEN_YAM,
};

async function runWork(client, interaction) {
    await interaction.deferReply({ ephemeral: true });
    const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
    const scenarioName = interaction.options.get('scenario')?.value;
    const forcedCompanionId = interaction.options.get('companion')?.value;

    const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
    if (!userDetails) return;

    const scenario = work.workScenarios.find(s => s.type === SCENARIO_TYPES[scenarioName]);
    if (!scenario) {
        interaction.editReply(`Unknown scenario "${scenarioName}".`);
        return;
    }

    // Reuses the exact same action/embed every real /work call uses (so what you see
    // here is exactly what a player would see), but skips the workTimer cooldown
    // check and does NOT touch the shared "work" stats doc (workCount/totalPayout) —
    // this is a test invocation, not a real one, and shouldn't inflate global economy
    // stats other systems (server-wealth work scaling, etc.) read from that doc.
    const workStat = await dynamoHandler.getStatDatabase('work');
    const newWorkCount = (workStat?.workCount || 0) + 1;
    const total = await dynamoHandler.getCachedServerTotal();
    const serverWealthBasedWorkAmount = Math.floor(total * Work.PERCENT_OF_TOTAL);
    const workGainAmount = serverWealthBasedWorkAmount < Work.MAX_BASE_WORK_GAIN ? Work.MAX_BASE_WORK_GAIN : serverWealthBasedWorkAmount;
    const multiplier = getRandomFromInterval(.8, 1.2);
    const catchUpBonus = await dynamoHandler.getCatchUpBonus(userDetails);

    await scenario.action(userDetails, workGainAmount, multiplier, userDisplayName, newWorkCount, interaction, catchUpBonus, forcedCompanionId);

    // Still worth checking — e.g. verifying a forced Mythic companion actually
    // unlocks mythic_bond, or a forced golden pull unlocks lucky_find.
    const updatedUserDetails = await dynamoHandler.findUser(userId, username);
    if (updatedUserDetails) {
        const newlyUnlocked = await achievementFactory.checkAndUnlock(updatedUserDetails);
        if (newlyUnlocked.length > 0) {
            const achievementEmbeds = embedFactory.createAchievementUnlockedEmbed(userDisplayName, newlyUnlocked);
            interaction.followUp({ embeds: achievementEmbeds, ephemeral: true });
        }
    }
}

const WORLD_BOSS_MAIN_CHANNEL_ID = '1188525931346792498';
const WORLD_EVENT_ROLE_ID = '1207117686526582865';

async function runTriggerWorldBoss(client, interaction) {
    const world = await dynamoHandler.getStatDatabase("world");
    if (world?.world_active) {
        interaction.reply({
            content: `There's already an active world boss (${worldBossMobs[world.world_index]?.name ?? 'unknown'}). Wait for it to be resolved before spawning another.`,
            ephemeral: true
        });
        return;
    }

    const selectedIndex = Number(interaction.options.get('boss')?.value);
    const factory = new worldFactory();
    await factory.setWorldBoss(selectedIndex);
    const embed = factory.getWorldEmbed();

    const channel = await client.channels.fetch(WORLD_BOSS_MAIN_CHANNEL_ID);
    await channel.send({ embeds: [embed] });
    await channel.send(`<@&${WORLD_EVENT_ROLE_ID}>`);

    interaction.reply({
        content: `Spawned ${worldBossMobs[selectedIndex].name} in <#${WORLD_BOSS_MAIN_CHANNEL_ID}>.`,
        ephemeral: true
    });
}

// Server Activity Channel (2026-09-16, direct instruction — "I want to be able to admin
// use a command to set a server activity channel and have it include things like website
// actions users are doing... but not ephemeral commands"). A single server-wide setting
// today (stored under one fixed trackingId in the stats table, same "one global doc" shape
// world_buff/spud_keep_buff already use) — the player has flagged wanting per-server/
// per-user variants later, which this trackingId-keyed shape extends into cleanly (e.g.
// `server_activity_channel_<guildId>`) without a migration, but that's explicitly deferred,
// not built now.
//
// Delivery is a Discord WEBHOOK, not a bot-side relay — the actual activity being tracked
// originates on the financial-project website (a separate AWS Lambda process, not this bot),
// so a webhook URL is the one thing that lets that Lambda post directly into this channel
// with a plain HTTP POST, no bot process/token involvement needed at request time. The
// webhook's URL is stored in the SAME stats table this bot already exposes cross-region to
// financial-project's Lambdas (see NOTES_GROMP_WEB_INTEGRATION.md) — see
// systems/server-activity-channel.md for the full read-side (web) half of this feature.
//
// Big Events Channel (same day, direct instruction — "I also want to add a more fun version
// of this which is another channel for bigger events... with a more colorful obvious embed
// color and message") — a SECOND, independently-configurable channel/webhook for standout
// moments (Golden Potato, Metal kill, Ancient Potato, and a successful Raid/Bounty/Heist
// that had under a 30% chance to win). Same subcommand, same flow, just a second `type` this
// subcommand can target — one shared TRACKING_IDS map rather than a second near-duplicate
// subcommand.
const ACTIVITY_TRACKING_IDS = {
    normal: "server_activity_channel",
    big: "server_big_events_channel",
};
const ACTIVITY_WEBHOOK_NAMES = {
    normal: "Gromp Server Activity",
    big: "Gromp Big Events",
};

async function runSetActivityChannel(client, interaction) {
    await interaction.deferReply({ ephemeral: true });

    const type = interaction.options.get('type')?.value ?? 'normal';
    // Defaults to wherever the command was actually run (2026-09-16, same follow-up as
    // /set-command-channels' own — "make same channel optional change for the activity
    // channel command"). Discord's own Channel option picker doesn't reliably surface
    // every channel client-side on a large/busy server — running this FROM the target
    // channel sidesteps that entirely rather than fighting the picker.
    const channelId = interaction.options.get('channel')?.value ?? interaction.channel.id;
    const disable = interaction.options.get('disable')?.value ?? false;
    const trackingId = ACTIVITY_TRACKING_IDS[type];
    const webhookName = ACTIVITY_WEBHOOK_NAMES[type];
    const label = type === 'big' ? 'Big events' : 'Server activity';

    // Clean up any previously-created webhook regardless of which branch runs below —
    // re-pointing to a new channel or disabling both mean the old one should stop
    // existing rather than being silently orphaned in its old channel forever.
    const existing = await dynamoHandler.getStatDatabase(trackingId);
    if (existing?.webhookId) {
        const oldWebhook = await client.fetchWebhook(existing.webhookId).catch(() => null);
        if (oldWebhook) {
            await oldWebhook.delete('Activity channel changed via /admin set-activity-channel').catch(() => {});
        }
    }

    if (disable) {
        await dynamoHandler.updateStatFields(trackingId, { channelId: null, webhookId: null, webhookUrl: null });
        interaction.editReply(`${label} channel disabled — nothing will post there anymore.`);
        return;
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
        interaction.editReply(`That doesn't look like a text channel I can post in — try again.`);
        return;
    }

    let webhook;
    try {
        webhook = await channel.createWebhook({
            name: webhookName,
            reason: `${label} channel set via /admin set-activity-channel by ${interaction.user.tag}`,
        });
    } catch (err) {
        console.error('Failed to create activity webhook:', err);
        interaction.editReply(`Couldn't create a webhook in <#${channelId}> — I likely need Manage Webhooks permission there.`);
        return;
    }

    await dynamoHandler.updateStatFields(trackingId, {
        channelId,
        webhookId: webhook.id,
        webhookUrl: webhook.url,
    });

    interaction.editReply(type === 'big'
        ? `Big events channel set to <#${channelId}> — Golden Potatoes, Metal kills, Ancient Potatoes, and long-shot Raid/Bounty/Heist wins will post there.`
        : `Server activity channel set to <#${channelId}> — website Work/Bounty/Heist/Raid/Rob/Bank/Safehouse activity will start posting there.`);
}

// The Merc Faction Hall (systems/guilds.md#the-merc-faction-hall) — the shared,
// mercenary-only counterpart to a Guild's own private /guild-chat channel. A server-wide
// singleton doc (same shape server_activity_channel/server_big_events_channel already use),
// not a guild field — there's no guild record to hang it off, mercenaries aren't guild
// members. Mirrors set-activity-channel's exact shape (Administrator, a single
// admin-provisioned channel, not a player-facing opt-in command) rather than folding into
// that unrelated activity-feed subcommand.
const MERC_CHAT_TRACKING_ID = 'merc_faction_chat_channel';
const MERC_CHAT_ROLE_NAME = 'Merc Faction Access';
const MERC_CHAT_CHANNEL_NAME = 'merc-faction-hall';

async function runSetMercChatChannel(client, interaction) {
    await interaction.deferReply({ ephemeral: true });
    const disable = interaction.options.get('disable')?.value ?? false;

    const existing = await dynamoHandler.getStatDatabase(MERC_CHAT_TRACKING_ID);

    if (disable) {
        if (existing?.channelId) {
            const channel = await client.channels.fetch(existing.channelId).catch(() => null);
            if (channel) {
                await channel.delete('Merc Faction Hall disabled via /admin set-merc-chat-channel').catch(() => {});
            }
        }
        if (existing?.webhookId) {
            const webhook = await client.fetchWebhook(existing.webhookId).catch(() => null);
            if (webhook) {
                await webhook.delete('Merc Faction Hall disabled via /admin set-merc-chat-channel').catch(() => {});
            }
        }
        if (existing?.roleId) {
            await interaction.guild.roles.delete(existing.roleId).catch(() => {});
        }
        if (existing?.channelId) {
            await removeChatChannelIndexEntry(existing.channelId);
        }

        await dynamoHandler.updateStatFields(MERC_CHAT_TRACKING_ID, { channelId: null, roleId: null, webhookId: null, webhookUrl: null });
        interaction.editReply(`The Merc Faction Hall has been disabled — its channel, role, and webhook are gone.`);
        return;
    }

    if (existing?.channelId) {
        interaction.editReply(`The Merc Faction Hall already exists — <#${existing.channelId}>. Run with disable:true first if you want to rebuild it.`);
        return;
    }

    const categoryId = await ensureGuildChatCategory(interaction.guild);

    let role;
    try {
        role = await interaction.guild.roles.create({
            name: MERC_CHAT_ROLE_NAME,
            mentionable: false,
            reason: 'Merc Faction Hall setup via /admin set-merc-chat-channel',
        });
    } catch (err) {
        console.error('Failed to create Merc Faction Hall role:', err);
        interaction.editReply(`Couldn't create the Merc Faction role — I likely need Manage Roles permission.`);
        return;
    }

    let channel;
    try {
        channel = await interaction.guild.channels.create({
            name: MERC_CHAT_CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            ],
        });
    } catch (err) {
        console.error('Failed to create Merc Faction Hall channel:', err);
        await role.delete('Rolling back failed Merc Faction Hall setup').catch(() => {});
        interaction.editReply(`Couldn't create the Merc Faction Hall channel — I likely need Manage Channels permission.`);
        return;
    }

    // Retroactively grant the role to every CURRENT mercenary — same "admin-provisioned
    // channel every qualifying member is added to" shape /guild-chat setup uses for a
    // Guild's own roster, best-effort per member.
    const allUsers = await dynamoHandler.getUsers();
    await Promise.all(allUsers.filter(u => u.isMercenary).map(async (mercenary) => {
        const guildMember = await interaction.guild.members.fetch(mercenary.userId).catch(() => null);
        if (!guildMember) {
            console.log(`admin set-merc-chat-channel: could not fetch mercenary ${mercenary.userId} to grant Hall role (left the server?)`);
            return;
        }
        await guildMember.roles.add(role.id).catch((err) => console.error(`admin set-merc-chat-channel: failed to grant Hall role to ${mercenary.userId}:`, err));
    }));

    let webhook;
    try {
        webhook = await channel.createWebhook({
            name: 'Merc Faction Hall',
            reason: 'Merc Faction Hall setup via /admin set-merc-chat-channel',
        });
    } catch (err) {
        console.error('Failed to create Merc Faction Hall webhook:', err);
        interaction.editReply(`The channel and role were created, but I couldn't create the webhook — I likely need Manage Webhooks permission there. Run with disable:true and try again.`);
        return;
    }

    await dynamoHandler.updateStatFields(MERC_CHAT_TRACKING_ID, {
        channelId: channel.id,
        roleId: role.id,
        webhookId: webhook.id,
        webhookUrl: webhook.url,
    });
    await addChatChannelIndexEntry(channel.id, { scopeType: 'merc' });

    interaction.editReply(`The Merc Faction Hall is ready — <#${channel.id}>. Every current mercenary has been given access.`);
}

// Seasonal Festivals (systems/seasonal-festivals.md) — admin-triggered start, CONFIRMED by
// product owner over a real content calendar for v1 ("im fine with it being admin started").
// Mirrors trigger-event's own shape (a manual write to a shared doc everyone picks up on next
// read). Folded in here as a subcommand rather than its own top-level command since admin.js
// already existed by the time Seasonal Festivals merged into the session branch.
const FESTIVAL_EVENT_CHANNEL_ID = '1188525931346792498';
const FESTIVAL_EVENT_ROLE_ID = '1207117686526582865';

const FESTIVAL_CHOICES = Object.keys(FestivalTemplates).map(festivalId => ({
    name: Festival.NAME[festivalId] || festivalId,
    value: festivalId,
}));

async function runStartFestival(client, interaction) {
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
        const channel = await client.channels.fetch(FESTIVAL_EVENT_CHANNEL_ID);
        await channel.send(`<@&${FESTIVAL_EVENT_ROLE_ID}> The **${festivalName}** has begun! Check /festival for objectives and /festival-shop to spend ${tokenLabel} — ends <t:${endsAtSeconds}:R>.`);
        interaction.editReply(`Started ${festivalName} for ${Math.round((festival.endsAt - festival.startsAt) / (24 * 60 * 60 * 1000))} day(s) — announced in <#${FESTIVAL_EVENT_CHANNEL_ID}>.`);
    } else {
        interaction.editReply(`Started ${festivalName}, ending <t:${endsAtSeconds}:R> — no announcement sent.`);
    }
}

module.exports = {
    name: "admin",
    description: "Admin/moderation tools (subcommands)",
    devOnly: true,
    deleted: false,
    permissionsRequired: [PermissionFlagsBits.Administrator],
    options: [
        {
            name: 'give',
            description: "Spawns potatoes into a target user's balance",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'recipient',
                    description: 'Person you give your potatoes to',
                    required: true,
                    type: ApplicationCommandOptionType.Mentionable,
                },
                {
                    name: 'amount',
                    description: 'Amount of potatoes you give',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                }
            ],
        },
        {
            name: 'reset-tower',
            description: "Resets a player's daily Tower entry so they can run /enter-tower again",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'player',
                    description: 'Which player to reset',
                    required: true,
                    type: ApplicationCommandOptionType.Mentionable,
                }
            ],
        },
        {
            name: 'stats',
            description: "Ephemeral dashboard of the game's cached economy/starch/world/quest state",
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: 'trigger-event',
            description: "Force a specific /work special event, or clear the current one",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'event',
                    description: 'Which event to trigger',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                    choices: EVENT_CHOICES,
                },
                {
                    name: 'announce',
                    description: 'Post the public announcement to the events channel? (default: yes)',
                    required: false,
                    type: ApplicationCommandOptionType.Boolean,
                }
            ],
        },
        {
            name: 'work',
            description: "devOnly — force a specific /work scenario (and optionally a specific companion) for testing",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'scenario',
                    description: 'Which /work scenario to force',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                    choices: Object.keys(SCENARIO_TYPES).map(name => ({ name, value: name }))
                },
                {
                    name: 'companion',
                    description: 'Force this exact companion (only used when scenario is "companion")',
                    required: false,
                    type: ApplicationCommandOptionType.String,
                    choices: Companions.map(c => ({ name: c.name, value: c.id }))
                }
            ],
        },
        {
            name: 'trigger-world-boss',
            description: "Spawn a specific world boss",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'boss',
                    description: 'Which world boss to spawn',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                    choices: worldBossMobs.map((mob, index) => ({
                        name: mob.name,
                        value: index.toString(),
                    })),
                }
            ],
        },
        {
            name: 'set-activity-channel',
            description: "Set (or clear) a channel website activity gets posted to (normal, or big/rare events)",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'type',
                    description: 'Which channel to configure — defaults to the normal activity channel',
                    required: false,
                    type: ApplicationCommandOptionType.String,
                    choices: [
                        { name: 'Normal activity (work/raids/bounties/bank/etc.)', value: 'normal' },
                        { name: 'Big/rare events (Golden Potato, Metal kills, Ancient Potatoes, long-shot wins)', value: 'big' },
                    ],
                },
                {
                    name: 'channel',
                    description: 'The channel to post into — defaults to the channel this command is run in; ignored with disable:true',
                    required: false,
                    type: ApplicationCommandOptionType.Channel,
                },
                {
                    name: 'disable',
                    description: 'Turn off this channel entirely (deletes its webhook)',
                    required: false,
                    type: ApplicationCommandOptionType.Boolean,
                }
            ],
        },
        {
            name: 'set-merc-chat-channel',
            description: "Provision (or tear down) the Merc Faction Hall — the mercenary-only chat channel",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'disable',
                    description: 'Turn off the Merc Faction Hall entirely (deletes its channel, role, and webhook)',
                    required: false,
                    type: ApplicationCommandOptionType.Boolean,
                }
            ],
        },
        {
            name: 'start-festival',
            description: 'Start a Seasonal Festival for a fixed number of days',
            type: ApplicationCommandOptionType.Subcommand,
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
        },
    ],
    callback: async (client, interaction) => {
        const subcommand = interaction.options.getSubcommand();
        switch (subcommand) {
            case 'give':
                await runGive(client, interaction);
                break;
            case 'reset-tower':
                await runResetTower(client, interaction);
                break;
            case 'stats':
                await runStats(client, interaction);
                break;
            case 'trigger-event':
                await runTriggerEvent(client, interaction);
                break;
            case 'work':
                await runWork(client, interaction);
                break;
            case 'trigger-world-boss':
                await runTriggerWorldBoss(client, interaction);
                break;
            case 'set-activity-channel':
                await runSetActivityChannel(client, interaction);
                break;
            case 'set-merc-chat-channel':
                await runSetMercChatChannel(client, interaction);
                break;
            case 'start-festival':
                await runStartFestival(client, interaction);
                break;
        }
    },
    // Exported individually for direct unit testing, same "export the inner logic, not just
    // the dispatcher" precedent guildChat.js already set for runSetup/runDisable.
    giveCallback: runGive,
    resetTowerCallback: runResetTower,
    statsCallback: runStats,
    triggerEventCallback: runTriggerEvent,
    workCallback: runWork,
    triggerWorldBossCallback: runTriggerWorldBoss,
    setActivityChannelCallback: runSetActivityChannel,
    setMercChatChannelCallback: runSetMercChatChannel,
    startFestivalCallback: runStartFestival,
}
