const { getSortedBirthdays, buildPaginationRow, runPaginatedBroadcast } = require("../../utils/helperCommands");
const schedule = require('node-schedule');
const dynamoHandler = require("../../utils/dynamoHandler");
const { EventFactory } = require("../../utils/eventFactory");
const { setWorkScenarios } = require("../../commands/user/work.js");
var { worldFactory } = require("../../utils/worldFactory.js");
const { TowerLeaderboardFactory } = require("../../utils/towerLeaderboardFactory.js");
const { QuestFactory } = require("../../utils/questFactory.js");
const { GuildContracts } = require("../../utils/constants.js");
const { GuildContractFactory } = require("../../utils/guildContractFactory.js");
const { EmbedFactory } = require("../../utils/embedFactory.js");
const spudKeepFactory = require("../../utils/spudKeepFactory.js");

const formatDate = md => md.split('-').map(p => `0${p}`.slice(-2)).join('-');
let eF = new EventFactory()
let towerLeaderboardFactory = new TowerLeaderboardFactory()
let questFactory = new QuestFactory()
let guildContractFactory = new GuildContractFactory()
let embedFactory = new EmbedFactory()

let statuses = [
    {
        name: "Cultivating new ways of playing with potatoes"
    }
];

module.exports = async (client) => {
    console.log(`${client.user.username} is online! ✅`);

    // Sets activity of the bot
    // setInterval(() => {
    //     let random = Math.floor(Math.random() * statuses.length);
    //     client.user.setActivity(statuses[random]);
    // }, 30000);
    client.user.setActivity(statuses[0]);

    // Manages the passive potato gain of the server per 5 minutes
    setInterval(async () => {
        await dynamoHandler.passivePotatoHandler(288);
    }, 300000);

    // Guild treasury interest, same 5-minute cadence — see Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER
    setInterval(async () => {
        await dynamoHandler.applyGuildTreasuryInterest(288);
    }, 300000);

    schedule.scheduleJob('0 4 * * *', async function () {
        // Pay out today's Tater Tower leaderboard winners (survived runs only) before
        // resetting for the new day — see towerLeaderboardFactory.js.
        const towerWinners = await towerLeaderboardFactory.payoutWinners()
        if (towerWinners.length > 0) {
            client.channels.fetch('1188525931346792498')
                .then(async channel => {
                    const resultsEmbed = embedFactory.createTowerLeaderboardResultsEmbed(towerWinners)
                    channel.send({ embeds: [resultsEmbed] })
                })
                .catch(err => {
                    console.log(err)
                });
        }

        // Reset all user tower entries at midnight 12 AM EST
        await dynamoHandler.resetAllTowerEntries()

        // Rotate the daily quest set (always) and the weekly set (Mondays only) — see
        // questFactory.js.
        const { activeQuests, weeklyRotated } = await questFactory.rotateQuests()
        client.channels.fetch('1188525931346792498')
            .then(async channel => {
                const questEmbed = embedFactory.createQuestRotationEmbed(activeQuests, weeklyRotated)
                channel.send({ embeds: [questEmbed] })
            })
            .catch(err => {
                console.log(err)
            });

        // Rotate the active Guild Contract — Mondays only, same weekly-only cadence as
        // the quest system's weekly set, reusing this same daily cron — see
        // guildContractFactory.js. Per-guild progress snapshots aren't touched here;
        // each guild lazily establishes its own baseline the first time a member's
        // /work triggers a check against the new rotation.
        const { activeContract, rotated: contractRotated } = await guildContractFactory.rotateContract()
        if (contractRotated) {
            const contractTemplate = GuildContracts.find(contract => contract.id === activeContract.templateId)
            client.channels.fetch('1188525931346792498')
                .then(async channel => {
                    const contractEmbed = embedFactory.createGuildContractRotationEmbed(activeContract, contractTemplate)
                    channel.send({ embeds: [contractEmbed] })
                })
                .catch(err => {
                    console.log(err)
                });
        }

        // Spud Keep's own daily resolution (systems/spud-keep.md) — reuses this same 4am
        // UTC cron bundle rather than a separately-timed announcement, same cadence
        // reasoning Tower/Quest/Guild Contract rotation above already established.
        // Posted only on an actual resolution (winner drawn); a skipped cycle (nobody
        // signed up at all) still gets its own announcement so a quiet cycle doesn't
        // look like a missed cron run.
        const spudKeepResult = await spudKeepFactory.resolveCycle();
        client.channels.fetch('1188525931346792498')
            .then(async channel => {
                // Payout breakdown pagination (2026-08-30, direct instruction: "show 5
                // players and paginate if more than 5 players") — this is a public,
                // fire-and-forget cron post with no owning interaction, so it drives
                // runPaginatedBroadcast (open to any channel viewer) instead of the
                // interaction-scoped runPaginatedReply every command uses.
                const totalPayoutPages = spudKeepResult.skipped ? 1 : embedFactory.getSpudKeepPayoutPageCount(spudKeepResult);
                const spudKeepEmbed = embedFactory.createSpudKeepResultEmbed(spudKeepResult, 0);
                const components = totalPayoutPages > 1 ? [buildPaginationRow('spud_keep_payout', 0, totalPayoutPages)] : [];
                const message = await channel.send({ embeds: [spudKeepEmbed], components });
                if (totalPayoutPages > 1) {
                    await runPaginatedBroadcast(message, 'spud_keep_payout', totalPayoutPages,
                        (pageIndex) => embedFactory.createSpudKeepResultEmbed(spudKeepResult, pageIndex));
                }
            })
            .catch(err => {
                console.log(err)
            });

        // Birthday shit
        client.channels.fetch('1188539987118010408')
            .then(async channel => {
                const jsonChannel = JSON.parse(JSON.stringify(channel));
                const birthdaysInOrder = await getSortedBirthdays();
                const nextBirthdayPerson = birthdaysInOrder[0];

                const now = new Date();
                const currentDateFormatted = formatDate(`${now.getMonth() + 1}-${now.getDate()}`);
                if (currentDateFormatted == nextBirthdayPerson.birthday) {
                    channel.setName(`happy bday ${nextBirthdayPerson.username}`);
                    channel.send(`🎂 It is <@${nextBirthdayPerson.userId}>\'s birthday! 🥳 Congrats on surviving another year and everyone wish <@${nextBirthdayPerson.userId}> a happy birthday! 🎉`);
                } else if (currentDateFormatted != nextBirthdayPerson.birthday && !jsonChannel.name.includes(nextBirthdayPerson.birthday)) {
                    channel.setName(`next bday ${nextBirthdayPerson.birthday}`);
                }
            })
            .catch(err => {
                console.log(err)
            });
    });

    // check for random background events
    schedule.scheduleJob('0 * * * *', function () {
        const chance = Math.random()
        if(chance >= .8){
            // In the future we should store channels in a database for certain events like birthday, or bot channels
            // and add commands that add/remove servers from that list so we dont have to code channel ids
            client.channels.fetch('1188525931346792498')
            .then(async channel => {
                // SEND TO THE EVENTS!
                eF.setSpecialEvent()
                var eventName = eF.getCurrentEvent();
                channel.send(`<@&1207117686526582865> Special event on the way this hour! ${eventName}`);
                let wC = eF.getWorkChances()
                // set work chances in work.js
                setWorkScenarios(wC)
                eF.setBaseWorkChances();
                eF.setBaseWorkProbability();
            })
        } else {
            eF.setEmptyCurrentEvent();
            setWorkScenarios(eF.getWorkChances())
        }
    });

    schedule.scheduleJob('30 * * * *', async function () {
        const mainChannelId = '1188525931346792498'
        let wB = new worldFactory()
        let result = await wB.popWorldBoss()
        const bossFought = result[0]
        let embed = result[1]
        if (bossFought) {
            client.channels.fetch(mainChannelId)
            .then(async channel => {
                channel.send({embeds: [ embed ]});
                channel.send(`<@&1207117686526582865>`);
            })
        } else {
            const chance = Math.random()
            if(chance > .95){
                client.channels.fetch(mainChannelId)
                .then(async channel => {
                    wB.setWorldBoss()
                    embed = wB.getWorldEmbed()
                    channel.send({embeds: [ embed ]});
                    channel.send(`<@&1207117686526582865>`);
                })
            }
        }
    });
};