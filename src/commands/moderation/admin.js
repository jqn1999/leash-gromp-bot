const { ApplicationCommandOptionType, ChannelType, PermissionFlagsBits } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");
const { getUserInteractionDetails, getRandomFromInterval, requireUserDetails } = require("../../utils/helperCommands");
const { Work, Companions, Festival, FestivalTemplates, Titles } = require("../../utils/constants");
const { TitleFactory } = require("../../utils/titleFactory");
const titleFactory = new TitleFactory();
const { EventFactory, buildActiveEventPayload, WORK_SCENARIO_INDICES } = require("../../utils/eventFactory");
const { AchievementFactory } = require("../../utils/achievementFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const { worldFactory, worldBossMobs } = require("../../utils/worldFactory");
const { setWorkScenarios } = require("../user/work.js");
const work = require("./../user/work");
const { ensureGuildChatCategory, addChatChannelIndexEntry, removeChatChannelIndexEntry } = require("../guilds/guildChat");
const festivalFactory = require("../../utils/festivalFactory");
const bigEventsChannel = require("../../utils/bigEventsChannel.js");
const tC = require("../../utils/towerConstants.js");

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

    // full-wipe (2026-09-24, direct instruction) — beyond just unlocking re-entry, also
    // reverts the potatoes/stats their run actually credited today, sourced from their own
    // entry in today's tower_leaderboard batch (enter-tower.js's processRewardPayouts writes
    // the exact same amounts there as it credits to the player, so it's a reliable source for
    // "what did this run actually grant"). A died run never gets a leaderboard entry at all
    // (see enter-tower.js — only a survived run is recorded), so there's nothing here to find
    // or revert for that case; it still already banked whatever it earned along the way, same
    // as any survived run, but that's outside what a leaderboard-entry-based reversal can see.
    //
    // resume-from-leaderboard (2026-09-30, direct instruction: "update admin reset tower so
    // that there is also the option of getting a user's run from leaderboard if they run into
    // this stale click leave scenario so that I can reset them and have them continue from the
    // floor that was recorded in the leaderboard. Stats and rewards should be removed like
    // normal so that they get the right numbers at the end of the run") — targets exactly the
    // stale-click/timeout auto-leave bug from BEFORE the two same-day fixes above shipped: a
    // run that got prematurely concluded (credited AND leaderboarded) even though the player
    // never actually chose to leave. Shares full-wipe's own reversal (`resume-from-leaderboard`
    // triggers it too, without needing `full-wipe: true` passed separately) so the premature
    // credit doesn't get double-counted once the resumed run actually concludes for real — the
    // SAME numbers just move from "already on their account" to "carried inside the seeded
    // checkpoint," to be re-credited in full when the continued run finally leaves or dies.
    const fullWipe = interaction.options.getBoolean('full-wipe') === true;
    const resumeFromLeaderboard = interaction.options.getBoolean('resume-from-leaderboard') === true;

    let wipeMessage = '';
    let resumeCheckpoint = null;
    if (fullWipe || resumeFromLeaderboard) {
        const entry = await dynamoHandler.removeTowerLeaderboardEntry(targetUserId);
        if (!entry) {
            wipeMessage = ` No Tower leaderboard entry found for them today — either they haven't survived a run today, or their run ended in death (deaths never get a leaderboard entry), so there was nothing to revert${resumeFromLeaderboard ? ' or resume from' : ''}.`;
        } else {
            // Re-fetch immediately before writing — the targetUserDetails read above could
            // already be stale by the time this command actually commits, same "moved since
            // read" discipline /rebirth's own confirmation step follows.
            const freshUserDetails = await dynamoHandler.findUser(targetUserId, targetUsername);
            if (!freshUserDetails) {
                interaction.editReply(`${targetUserDisplayName} could not be re-checked to revert their Tower stats — the leaderboard entry was already removed, but nothing else was reverted. Please try again or credit them manually with this entry: \`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\``);
                return;
            }

            // Reverses exactly what processRewardPayouts credited: atomic ADD of the negative
            // delta for the four raw numeric stats (race-safe regardless of anything else that
            // touched them meanwhile), and a plain re-fetch-then-SET for sweetPotatoBuffs (a
            // nested object, not a flat numeric attribute DynamoDB can ADD into directly) —
            // batched into ONE updateUserFields call, same atomicity principle as the Tower
            // reward-credit fix this mirrors, just for the reversal direction instead.
            const sweetPotatoBuffs = freshUserDetails.sweetPotatoBuffs;
            sweetPotatoBuffs.workMultiplierAmount -= entry.workMultiplier || 0;
            sweetPotatoBuffs.passiveAmount -= entry.passiveIncome || 0;
            sweetPotatoBuffs.bankCapacity -= entry.bankCapacity || 0;

            await dynamoHandler.updateUserFields(targetUserId, { sweetPotatoBuffs }, {
                potatoes: -(entry.potatoes || 0),
                totalEarnings: -(entry.potatoes || 0),
                workMultiplierAmount: -(entry.workMultiplier || 0),
                passiveAmount: -(entry.passiveIncome || 0),
                bankCapacity: -(entry.bankCapacity || 0),
            });

            wipeMessage = ` Reverted their floor ${entry.floor} run: ${(entry.potatoes || 0).toLocaleString()} potatoes, `
                + `${(entry.workMultiplier || 0).toFixed(2)}x work multiplier, ${(entry.passiveIncome || 0).toLocaleString()} passive income, `
                + `and ${(entry.bankCapacity || 0).toLocaleString()} bank capacity all rolled back, and their leaderboard entry removed. `
                + `Companion leveling/Bastion drops and the highestTowerFloor record from that run are NOT reverted — those aren't potatoes/stat gains and need a separate manual correction if this run also needs undoing there.`;

            if (resumeFromLeaderboard) {
                resumeCheckpoint = buildResumeCheckpointFromLeaderboardEntry(entry);
            }
        }
    }

    const alreadyCouldEnter = targetUserDetails.canEnterTower === true;
    await dynamoHandler.updateUserDatabase(targetUserId, "canEnterTower", true);

    // True-resume checkpointing (2026-09-30) — a crash on its own now leaves canEnterTower
    // true AND the run resumable via its checkpoint (see enter-tower.js's own resumeFrom
    // comment), so this admin command is no longer needed for that specific case. It stays
    // useful as an explicit "discard whatever's pending and start clean" override — writing
    // `resumeCheckpoint` here too (null unless resume-from-leaderboard just built one) means
    // the player's NEXT /enter-tower is either a genuinely fresh run, or resumes from the
    // reconstructed checkpoint — never an accidental resume of some OTHER stale checkpoint this
    // command wasn't told about.
    const hadPendingCheckpoint = !!targetUserDetails.towerRunCheckpoint;
    await dynamoHandler.updateUserDatabase(targetUserId, "towerRunCheckpoint", resumeCheckpoint);

    let checkpointMessage = '';
    if (resumeCheckpoint) {
        checkpointMessage = ` Seeded a resumable checkpoint at floor ${resumeCheckpoint.floor} — their next /enter-tower will CONTINUE from floor ${resumeCheckpoint.floor + 1} instead of starting over, and the reverted reward above will be re-credited in full once they actually leave or die on the continued run. Could NOT be recovered from the leaderboard entry alone (defaulted conservatively): companion-hit count (0), Bastion ward usage (treated as already-used, so a genuinely unused ward is lost rather than risking a double-save), risk policy (SAFE), and REWARD-variety history (empty, so an already-seen REWARD type could repeat). Elite difficulty and their temporary (this-run-only) work modifier were both reconstructed correctly from the leaderboard entry.`;
    } else if (hadPendingCheckpoint) {
        checkpointMessage = ` They had an in-progress, resumable run through floor ${targetUserDetails.towerRunCheckpoint.floor} — this discards it, they'll start a brand new run from floor 1.`;
    }

    interaction.editReply((alreadyCouldEnter
        ? `${targetUserDisplayName} could already run /enter-tower — nothing was stuck, but their entry is confirmed available.`
        : `${targetUserDisplayName}'s Tower entry has been reset — they can run /enter-tower again right away.`)
        + checkpointMessage
        + wipeMessage);
}

// Reconstructs a towerRunCheckpoint from a tower_leaderboard entry — the best-effort recovery
// path for a run that was prematurely (and, for the stale-click/timeout bug specifically,
// incorrectly) concluded before a player actually chose to leave. Only what the leaderboard
// entry itself records survives: floor, elitesKilled, the four PAYOUT reward figures, and (as
// of 2026-09-30, direct instruction) the run's own TEMPORARY work modifier — distinct from
// workMultiplier above (the PERMANENT reward banked at run end), this one only ever affected
// floor success chance during the climb, and enter-tower.js now records it on every leaderboard
// entry specifically so this reconstruction doesn't have to default it to 0 anymore.
// Elite difficulty is the one field that CAN be derived exactly rather than defaulted — it
// escalates by TOWER_ELITE_DIFFICULTY_RATIO once per forced Elite floor reached (every 10
// floors, unconditionally, win/lose/decline all count — see towerFactory.js's own startRun()
// loop), so Math.floor(floor / 10) forced Elites have necessarily already been fought by the
// time this floor was recorded.
function buildResumeCheckpointFromLeaderboardEntry(entry) {
    return {
        floor: entry.floor,
        run: {
            [tC.PAYOUT.POTATOES]: entry.potatoes || 0,
            [tC.PAYOUT.WORK_MULTIPLIER]: entry.workMultiplier || 0,
            [tC.PAYOUT.PASSIVE_INCOME]: entry.passiveIncome || 0,
            [tC.PAYOUT.BANK_CAPACITY]: entry.bankCapacity || 0,
            [tC.MODIFIER.WORK_MULTIPLIER]: entry.tempWorkMultiplier || 0,
            [tC.PAYOUT.ELITE_KILL]: [],
        },
        elitesSurvivedCount: entry.elitesKilled || 0,
        // Not recoverable from the leaderboard entry at all — conservative defaults, called out
        // explicitly in the admin's own reply rather than silently guessed.
        towerCompanionHits: 0,
        wardUsed: true,
        policy: tC.POLICY.SAFE,
        usedRewards: [],
        difficulty: tC.TOWER_ELITE_DIFFICULTY_INITIAL * Math.pow(tC.TOWER_ELITE_DIFFICULTY_RATIO, Math.floor((entry.floor || 0) / 10)),
    };
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
    const announce = interaction.options.get('announce')?.value ?? true;

    const festival = await festivalFactory.startFestival(festivalId);
    if (!festival) {
        interaction.editReply(`"${festivalId}" isn't a recognized festival.`);
        return;
    }

    const festivalName = Festival.NAME[festivalId] || festivalId;
    const tokenLabel = Festival.TOKEN_LABEL[festivalId] || 'Festival Tokens';
    const endsAtSeconds = Math.floor(festival.endsAt / 1000);

    // Boosted-odds callout (2026-09-28, player-reported: "Nothing said poison had 50% more
    // chance to be found") — same fix as createFestivalStatusEmbed's own new field, applied
    // here too so the very first announcement already names the boosted encounter instead of
    // only /festival ever explaining it after the fact.
    const oddsOverride = Festival.ODDS_OVERRIDE[festivalId];
    const oddsCallout = oddsOverride
        ? ` This season's boosted odds: **+${Math.round((oddsOverride.multiplier - 1) * 100)}% chance to encounter a ${Festival.ODDS_OVERRIDE_SCENARIO_LABEL[oddsOverride.scenario] || oddsOverride.scenario}** while working.`
        : '';

    if (announce) {
        const channel = await client.channels.fetch(FESTIVAL_EVENT_CHANNEL_ID);
        await channel.send(`<@&${FESTIVAL_EVENT_ROLE_ID}> The **${festivalName}** has begun! Check /festival for objectives and /festival-shop to spend ${tokenLabel} — ends <t:${endsAtSeconds}:R>.${oddsCallout}`);
        // Big Events channel (2026-09-28, direct instruction — "wire festival start into big
        // events channel") — separate from the plain-text role-ping announcement above,
        // which stays in the dedicated festival/events channel. This mirrors every other
        // rare, server-wide moment already wired into bigEventsChannel.postBigEvent (World
        // Boss spawns, jackpot hits) — best-effort, non-fatal on failure (postBigEvent's own
        // try/catch), never blocks the real admin reply below.
        await bigEventsChannel.postBigEvent({
            title: `🎪 The ${festivalName} Has Begun!`,
            description: `A new season opens its stalls — check /festival for this week's objectives and /festival-shop to spend ${tokenLabel} before it closes.${oddsCallout}`,
            fields: [{ name: 'Ends', value: `<t:${endsAtSeconds}:R>`, inline: true }],
        });
        interaction.editReply(`Started ${festivalName} for ${Math.round((festival.endsAt - festival.startsAt) / (24 * 60 * 60 * 1000))} day(s) — announced in <#${FESTIVAL_EVENT_CHANNEL_ID}> and the Big Events channel.`);
    } else {
        interaction.editReply(`Started ${festivalName}, ending <t:${endsAtSeconds}:R> — no announcement sent.`);
    }
}

// Manual early-stop counterpart to start-festival (2026-09-28, direct instruction: "is
// there a way for me to stop the festival? if not add admin command for it") — no such
// command existed before this; festivalFactory.endFestival() itself already needed zero
// changes to support this, since it doesn't gate on Date.now() >= endsAt at all (only the
// daily cron's OWN caller in backgroundEvents.js checks that before calling it) — it just
// ends whatever's currently live, on demand, exactly what a manual stop needs. Posts the
// same createFestivalEndEmbed the daily cron posts on a natural end, to the same festival
// events channel, so players see an identical announcement either way — deliberately NOT
// also wired into the Big Events channel, matching how a NATURAL end isn't either (only
// festival START got that treatment this session).
// Global bot-wide kill switch (2026-09-30, direct instruction: "Give me an admin discord
// command to disable the bot for everyone besides admin as well") — mirrors the exact
// TOWER_DISABLED + admin-bypass pattern already shipped for `/enter-tower`, generalized to
// the WHOLE bot via handleCommands.js's own single dispatch chokepoint (every command
// funnels through it — see that file's own comment on the check this adds). Persisted in the
// same shared stats-table doc pattern every other admin-configured global toggle already
// uses (set-activity-channel's webhook URL, set-command-channels' allowlist), so it survives
// a bot restart and needs no code deploy to flip either way — this whole feature IS that
// "admin discord command," not a static code flag like TOWER_DISABLED was.
async function runMaintenanceMode(client, interaction) {
    await interaction.deferReply({ ephemeral: true });

    const enabled = interaction.options.get('enabled')?.value;
    await dynamoHandler.updateStatFields('bot_maintenance_mode', { enabled });

    interaction.editReply(enabled
        ? "Maintenance mode is now **ON** — every command is blocked for everyone except developers (`awsConfigurations.devs`) until this is turned back off."
        : 'Maintenance mode is now **OFF** — the bot is back to normal for everyone.');
}

// Tower entry live toggle (2026-09-30, direct instruction: "make an admin toggle for me to
// allow enter tower or not") — replaces enter-tower.js's own hardcoded `TOWER_DISABLED = true`
// constant (shipped 2026-09-29 as an emergency kill switch during the crash investigation, only
// ever flippable by editing code and redeploying) with the same DB-backed, no-deploy-needed
// toggle pattern `bot_maintenance_mode` already established. `enabled` here means "tower entry
// is ALLOWED" (positive framing, matching the instruction's own "allow enter tower" wording) —
// the OPPOSITE polarity from maintenance-mode's "enabled = blocked", chosen deliberately so this
// reads naturally on its own rather than needing a double-negative to reason about. A missing
// doc (nobody has ever run this command) resolves to `enabled: false` (blocked) in
// enter-tower.js's own read — the exact same default TOWER_DISABLED's hardcoded `true` value
// already had, so removing that constant doesn't silently re-open Tower to everyone the moment
// this ships. awsConfigurations.devs still always bypasses this, same as TOWER_DISABLED did.
async function runTowerAccess(client, interaction) {
    await interaction.deferReply({ ephemeral: true });

    const enabled = interaction.options.get('enabled')?.value;
    await dynamoHandler.updateStatFields('tower_access', { enabled });

    interaction.editReply(enabled
        ? 'Tower entry is now **ALLOWED** — `/enter-tower` is open to everyone.'
        : 'Tower entry is now **BLOCKED** — `/enter-tower` is closed to everyone except developers (`awsConfigurations.devs`) until this is turned back on.');
}

// Tower leaderboard daily payout/announcement live toggle (2026-09-30, direct instruction:
// "add admin toggle for turning the tower leaderboard daily placement daily credit on or
// off") — same pattern again, replacing backgroundEvents.js's own hardcoded "call
// clearTowerLeaderboard() instead of payoutWinners()" mitigation (shipped 2026-09-29 alongside
// TOWER_DISABLED, same crash investigation) with a no-deploy toggle. `enabled: true` means the
// nightly 8pm ET cron calls `towerLeaderboardFactory.payoutWinners()` (grants the stat/potato
// bonus to today's top finishers AND posts the results announcement) before clearing the
// leaderboard; `enabled: false` (or the doc missing — same "preserve today's hardcoded-off
// default" reasoning as tower_access above) just clears it with no payout/announcement, the
// exact current behavior. The in-progress `/leaderboard tower-leaderboard` standings view is
// unaffected either way — it reads live entries directly, never through payoutWinners.
async function runTowerLeaderboardPayout(client, interaction) {
    await interaction.deferReply({ ephemeral: true });

    const enabled = interaction.options.get('enabled')?.value;
    await dynamoHandler.updateStatFields('tower_leaderboard_payout', { enabled });

    interaction.editReply(enabled
        ? "Tower leaderboard daily payout is now **ON** — tonight's 8pm ET reset will pay out and announce today's top finishers before clearing the board."
        : 'Tower leaderboard daily payout is now **OFF** — the board still resets nightly, but nobody is paid or announced until this is turned back on.');
}

async function runEndFestival(client, interaction) {
    await interaction.deferReply({ ephemeral: true });

    const ended = await festivalFactory.endFestival();
    if (!ended) {
        interaction.editReply(`There's no festival currently running.`);
        return;
    }

    const festivalName = Festival.NAME[ended.festivalId] || ended.festivalId;
    const channel = await client.channels.fetch(FESTIVAL_EVENT_CHANNEL_ID);
    const festivalEndEmbed = embedFactory.createFestivalEndEmbed(ended.festivalId);
    await channel.send({ embeds: [festivalEndEmbed] });

    interaction.editReply(`Stopped ${festivalName} early — announced in <#${FESTIVAL_EVENT_CHANNEL_ID}>.`);
}

// Titles with a manualGrant condition (systems/titles.md) — the only kind an admin can ever
// hand out this way. Scoped deliberately: every other Title is earned by crossing a real
// in-game milestone (checked live off userDetails or persisted the moment it's true), and
// this command has no business overriding that — it exists ONLY for the one condition type
// that has nothing to check against in the first place (a one-off historical honor, e.g. the
// top 3 finishers of a player's previous server). Built as a static, name-only list rather
// than autocomplete since it's expected to stay tiny (one-off grants are rare by design).
const MANUAL_GRANT_TITLE_CHOICES = Titles
    .filter(title => title.condition.type === 'manualGrant')
    .map(title => ({ name: title.label, value: title.id }));

async function runGrantTitle(client, interaction) {
    await interaction.deferReply({ ephemeral: true });

    const titleId = interaction.options.get('title')?.value;
    const targetUserId = interaction.options.get('player')?.value;
    const targetUser = await interaction.guild.members.fetch(targetUserId).catch(() => null);
    if (!targetUser) {
        interaction.editReply(`That user doesn't exist in this server.`);
        return;
    }
    const targetUsername = targetUser.user.username;
    const targetDisplayName = targetUser.displayName;

    const title = Titles.find(t => t.id === titleId && t.condition.type === 'manualGrant');
    if (!title) {
        interaction.editReply(`"${titleId}" isn't a recognized manually-grantable title.`);
        return;
    }

    const targetUserDetails = await dynamoHandler.findUser(targetUserId, targetUsername);
    if (!targetUserDetails) {
        interaction.editReply(`${targetDisplayName} could not be looked up due to a database error, please try again!`);
        return;
    }

    const alreadyGranted = await titleFactory.isTitleUnlocked(targetUserDetails, title.id);
    if (alreadyGranted) {
        interaction.editReply(`${targetDisplayName} already holds **${title.label}** — nothing to grant.`);
        return;
    }

    const permanentTitles = targetUserDetails.permanentTitles || [];
    await dynamoHandler.updateUserFields(targetUserId, { permanentTitles: [...permanentTitles, title.id] });
    interaction.editReply(`Granted **${title.label}** to ${targetDisplayName} — they can equip it now with /set-title.`);
}

// One-time correction (2026-09-27, direct instruction — "make sure any users that had it
// before wouldnt have it complete now") for raising immune_to_venom's threshold from 20 to
// 40 Poison hits in a week (see constants.js's own comment on that change). Achievements are
// purely additive/permanent once unlocked (achievementFactory.checkAndUnlock only ever
// APPENDS to the achievements array, never re-validates or removes an existing entry), so
// every player who legitimately earned this under the OLD 20-hit standard would otherwise
// keep it forever even though they may never have reached the new, harder 40-hit bar — and
// would keep getting immune_to_venom's new 5-minute-lockout benefit despite that. There's no
// stored per-week history to check "did they ALSO happen to hit 40 that same week" against,
// so this revokes it unconditionally for every current holder — anyone who was truly capable
// of a 40-hit week can just earn it again, going forward, honestly. Scans the whole user
// table (same precedent as set-merc-chat-channel's own allUsers retroactive-grant scan
// above), so this only needs to be run once, manually, after this fix deploys — not wired
// into any hot path, since the underlying threshold-change event is itself one-time.
async function runRevokeImmuneToVenom(client, interaction) {
    await interaction.deferReply({ ephemeral: true });

    const allUsers = await dynamoHandler.getUsers();
    const holders = allUsers.filter(u => Array.isArray(u.achievements) && u.achievements.includes('immune_to_venom'));

    let fixedCount = 0;
    for (const holder of holders) {
        const updatedAchievements = holder.achievements.filter(id => id !== 'immune_to_venom');
        await dynamoHandler.updateUserFields(holder.userId, {
            achievements: updatedAchievements,
            totalPoisonMilestones20Reached: 0,
        });
        fixedCount++;
    }

    interaction.editReply(fixedCount > 0
        ? `Revoked Immune to Venom from ${fixedCount} player${fixedCount === 1 ? '' : 's'} who'd earned it under the old 20-hit standard, and reset their weekly-milestone counter to 0 — they'll need a genuine 40-hit week to re-earn it (and its 5-minute-lockout benefit) under the new bar.`
        : `No players currently hold Immune to Venom — nothing to revoke.`);
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
                },
                {
                    name: 'full-wipe',
                    description: "Also revert the potatoes/stats their Tower run earned today, not just unlock re-entry",
                    required: false,
                    type: ApplicationCommandOptionType.Boolean,
                },
                {
                    name: 'resume-from-leaderboard',
                    description: "Stale-click/timeout-leave bug: revert credit (like full-wipe), resume from their leaderboard floor",
                    required: false,
                    type: ApplicationCommandOptionType.Boolean,
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
                    description: 'Which festival to start (always runs 1 week)',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                    choices: FESTIVAL_CHOICES,
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
            name: 'end-festival',
            description: 'Stop the currently running Seasonal Festival early',
            type: ApplicationCommandOptionType.Subcommand,
            options: [],
        },
        {
            name: 'revoke-immune-to-venom',
            description: 'One-time fix: revoke Immune to Venom earned under the old 20-hit threshold (now 40)',
            type: ApplicationCommandOptionType.Subcommand,
        },
        {
            name: 'grant-title',
            description: 'Grant a one-off, manually-earned Title to a player (e.g. a past-server honor)',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'player',
                    description: 'Which player to grant the title to',
                    required: true,
                    type: ApplicationCommandOptionType.Mentionable,
                },
                {
                    name: 'title',
                    description: 'Which title to grant',
                    required: true,
                    type: ApplicationCommandOptionType.String,
                    choices: MANUAL_GRANT_TITLE_CHOICES,
                }
            ],
        },
        {
            name: 'maintenance-mode',
            description: 'Block every command for everyone except developers — an emergency-wide kill switch',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'enabled',
                    description: 'true to block the whole bot for non-developers, false to turn it back off',
                    required: true,
                    type: ApplicationCommandOptionType.Boolean,
                }
            ],
        },
        {
            name: 'tower-access',
            description: 'Allow or block /enter-tower for everyone except developers',
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'enabled',
                    description: 'true to allow everyone to use /enter-tower, false to block it (developers always bypass)',
                    required: true,
                    type: ApplicationCommandOptionType.Boolean,
                }
            ],
        },
        {
            name: 'tower-leaderboard-payout',
            description: "Turn the Tater Tower daily leaderboard's stat/potato payout and results announcement on or off",
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    name: 'enabled',
                    description: "true to pay out and announce tonight's top finishers, false to just clear the board with no payout",
                    required: true,
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
            case 'end-festival':
                await runEndFestival(client, interaction);
                break;
            case 'revoke-immune-to-venom':
                await runRevokeImmuneToVenom(client, interaction);
                break;
            case 'grant-title':
                await runGrantTitle(client, interaction);
                break;
            case 'maintenance-mode':
                await runMaintenanceMode(client, interaction);
                break;
            case 'tower-access':
                await runTowerAccess(client, interaction);
                break;
            case 'tower-leaderboard-payout':
                await runTowerLeaderboardPayout(client, interaction);
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
    endFestivalCallback: runEndFestival,
    revokeImmuneToVenomCallback: runRevokeImmuneToVenom,
    grantTitleCallback: runGrantTitle,
    maintenanceModeCallback: runMaintenanceMode,
    towerAccessCallback: runTowerAccess,
    towerLeaderboardPayoutCallback: runTowerLeaderboardPayout,
}
