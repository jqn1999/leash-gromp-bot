const { awsConfigurations, Work, CatchUp, Bank } = require("../utils/constants.js");
const companionFactory = require("../utils/companionFactory");
const rebirthFactory = require("../utils/rebirthFactory");
const guildBuffFactory = require("../utils/guildBuffFactory");
const AWS = require('aws-sdk');
// const config = require('../config.js');

AWS.config.update(awsConfigurations.aws_remote_config);
const docClient = new AWS.DynamoDB.DocumentClient();

// Excludes arrays and null — both are `typeof === 'object'` in JS but neither has
// meaningful "sub-keys" to shallow-heal the way a plain nested schema object does.
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Builds a DynamoDB UpdateExpression covering multiple SET/ADD attributes in one call,
// so callers can persist a whole scenario's worth of field changes in a single round trip
// instead of one UpdateItem call per attribute.
function buildUpdateExpression(setAttributes = {}, addAttributes = {}) {
    const names = {};
    const values = {};
    const setClauses = [];
    const addClauses = [];

    Object.keys(setAttributes).forEach((key, i) => {
        const nameKey = `#s${i}`;
        const valueKey = `:s${i}`;
        names[nameKey] = key;
        values[valueKey] = setAttributes[key];
        setClauses.push(`${nameKey} = ${valueKey}`);
    });

    Object.keys(addAttributes).forEach((key, i) => {
        const nameKey = `#a${i}`;
        const valueKey = `:a${i}`;
        names[nameKey] = key;
        values[valueKey] = addAttributes[key];
        addClauses.push(`${nameKey} ${valueKey}`);
    });

    let expression = '';
    if (setClauses.length) expression += `set ${setClauses.join(', ')} `;
    if (addClauses.length) expression += `add ${addClauses.join(', ')}`;

    return { expression: expression.trim(), names, values };
}

// Scans a table to completion, following LastEvaluatedKey so results aren't silently
// truncated once the table's data exceeds a single scan page (~1MB).
async function scanAll(baseParams) {
    let items = [];
    let lastEvaluatedKey;
    do {
        const params = lastEvaluatedKey ? { ...baseParams, ExclusiveStartKey: lastEvaluatedKey } : baseParams;
        const data = await docClient.scan(params).promise();
        items = items.concat(data.Items);
        lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);
    return items;
}

// User Handling
const addUserDatabase = async function (userId, attributeName, attributeValue) {
    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: `add #attrName :attrValue`,
        ExpressionAttributeNames: {
            "#attrName": attributeName,
        },
        ExpressionAttributeValues: {
            ":attrValue": attributeValue,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .catch(function (err) {
            console.debug(`addUserDatabase error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateUserDatabase = async function (userId, attributeName, attributeValue) {
    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: `set #attrName = :attrValue`,
        ExpressionAttributeNames: {
            "#attrName": attributeName,
        },
        ExpressionAttributeValues: {
            ":attrValue": attributeValue,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserDatabase: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserDatabase error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Combines any number of SET/ADD attribute writes on one user into a single UpdateItem
// call. Use this instead of chaining several updateUserDatabase/addUserDatabase calls
// when a single game action (e.g. one /work resolution) needs to persist several fields.
const updateUserFields = async function (userId, setAttributes = {}, addAttributes = {}) {
    const { expression, names, values } = buildUpdateExpression(setAttributes, addAttributes);
    if (!expression) return;

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .catch(function (err) {
            console.debug(`updateUserFields error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Claims a user's daily login streak reward, conditioned on lastLoginDate not already
// being `today` — closes the race where two near-simultaneous interactions both read
// "not claimed yet" and would otherwise both grant the reward. Returns true if this call
// won the claim, false if it lost the race (or hit any other error).
const claimDailyStreak = async function (userId, newStreak, today, newPotatoes, newTotalEarnings) {
    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set potatoes = :potatoes, totalEarnings = :totalEarnings, loginStreak = :loginStreak, lastLoginDate = :today",
        ConditionExpression: "attribute_not_exists(lastLoginDate) OR lastLoginDate <> :today",
        ExpressionAttributeValues: {
            ":potatoes": newPotatoes,
            ":totalEarnings": newTotalEarnings,
            ":loginStreak": newStreak,
            ":today": today,
        },
        ReturnValues: "ALL_NEW",
    };

    return docClient.update(params).promise()
        .then(() => true)
        .catch(function (err) {
            if (err.code !== "ConditionalCheckFailedException") {
                console.debug(`claimDailyStreak error: ${JSON.stringify(err)}`)
            }
            return false;
        });
}

// Persists a new personal-best on a user's `records.<fieldName>` (see
// getDefaultUserFields) only if newValue actually beats the value currently stored —
// used at every "personal record" write site (Tower floor reached, biggest single
// /work payout, largest raid contribution) instead of duplicating a
// read-compare-write dance three times inline. The comparison itself is enforced by a
// DynamoDB ConditionExpression on the write, the same race-safety pattern
// claimDailyStreak uses, rather than an app-level max() over a possibly-stale
// in-memory value — two near-simultaneous record-breaking writes for the same user
// can't clobber each other into leaving the smaller value stored. Assumes
// `records` already exists as a map on the item, which every call site can rely on
// since it's only ever reached after that request's own findUser call has already
// healed the field (findUser is the single point that backfills new top-level fields
// onto existing records, same as every other field here). Returns true if newValue
// became the new record, false if it lost the comparison (or hit any other error).
const updateIfNewRecord = async function (userId, fieldName, newValue) {
    if (!Number.isFinite(newValue) || newValue <= 0) return false;

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set records.#field = :newValue",
        ConditionExpression: "attribute_not_exists(records.#field) OR records.#field < :newValue",
        ExpressionAttributeNames: {
            "#field": fieldName,
        },
        ExpressionAttributeValues: {
            ":newValue": newValue,
        },
        ReturnValues: "ALL_NEW",
    };

    return docClient.update(params).promise()
        .then(() => true)
        .catch(function (err) {
            if (err.code !== "ConditionalCheckFailedException") {
                console.debug(`updateIfNewRecord error: ${JSON.stringify(err)}`)
            }
            return false;
        });
}

// Race guard for /companion-scavenge-collect and /companion-scavenge-cancel — same
// ConditionExpression-on-the-write shape as claimDailyStreak/updateIfNewRecord, so two
// near-simultaneous collect/cancel calls for the same scavenge can't both fire (the loser's
// write is rejected, not silently reapplied). Deliberately generic on setAttributes (unlike
// claimDailyStreak's fixed field list) since collect and cancel each need to write a
// different shape (collect also credits starches, cancel doesn't) — both just need "only
// let this land if that specific companion is still the one out scavenging" as the guard.
// Dispatch itself is NOT run through this — see companion-scavenge.js's own comment for why
// that race is low/no-stakes and left unconditional, same as /companion equip.
const resolveScavenge = async function (userId, companionId, setAttributes = {}) {
    const { expression, names, values } = buildUpdateExpression(setAttributes);
    if (!expression) return false;

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: expression,
        ConditionExpression: "companions.scavenging.companionId = :companionId",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ...values, ":companionId": companionId },
        ReturnValues: "ALL_NEW",
    };

    return docClient.update(params).promise()
        .then(() => true)
        .catch(function (err) {
            if (err.code !== "ConditionalCheckFailedException") {
                console.debug(`resolveScavenge error: ${JSON.stringify(err)}`)
            }
            return false;
        });
}

// Computes the work-timer expiry (including the guild workTimer-buff discount) without
// writing it, so callers can fold the result into a combined updateUserFields call.
// Every companion that touches the work cooldown now does it through
// workCooldownSkipChance (Fieldmouse/Spudsprite/Mochi) rather than a percentage
// reduction — checked first and, on a hit, short-circuits straight to "ready now".
// Mutates a transient, never-persisted `_cooldownSkippedByCompanion` id onto the same
// userDetails object reference the caller already holds, so work.js can show which
// companion actually did it without every /work scenario's handler needing its return
// shape changed to carry an extra flag through.
const calculateWorkTimerValue = async function (userDetails, cooldownTime) {
    const skipChance = companionFactory.getActivePerkValue(userDetails, "workCooldownSkipChance");
    if (skipChance > 0 && Math.random() < skipChance) {
        userDetails._cooldownSkippedByCompanion = companionFactory.getActiveCompanion(userDetails).id;
        return Date.now();
    }

    // Was previously gated on cooldownTime === Work.POISON_POTATO_TIMER_INCREASE_SECONDS
    // (falling back to the default WORK_TIMER_SECONDS for anything else) — harmless while
    // every caller only ever passed one of those two exact constants, but it silently
    // discarded any other value passed in. Poison's per-week-hit-count reduction (see
    // workFactory.js's computePoisonMitigation) now passes a variable lockout, so this
    // just uses whatever cooldownTime the caller actually asked for.
    let time = Date.now() + cooldownTime * 1000

    const userGuildId = userDetails.guildId;
    if (userGuildId) {
        let guild = await findGuildById(userDetails.guildId);
        if (guild) {
            if (guild.guildBuff == "workTimer") {
                const level = guildBuffFactory.getGuildLevel(guild.raidCount);
                const reduction = guildBuffFactory.getGuildBuffValue("workTimer", level);
                time -= cooldownTime * 1000 * reduction;
            }
        }
    }

    return time;
}

// The full default user shape. Extracted so both addUser (brand-new records) and
// findUser (healing partial records — see below) stay in sync with exactly one schema
// definition instead of two copies drifting apart over time.
function getDefaultUserFields(userId, username) {
    return {
        userId: userId,
        username: username,
        potatoes: 0,
        totalEarnings: 0,
        totalLosses: 0,
        workTimer: 0,
        robTimer: 0,
        bankStored: 0,
        bankCapacity: Bank.STARTING_CAPACITY, // see Bank.STARTING_CAPACITY's comment — closes the early-game "zero rob protection" gap
        workMultiplierAmount: 1,
        passiveAmount: 0,
        guildId: 0,
        sweetPotatoBuffs: {
            workMultiplierAmount: 0,
            passiveAmount: 0,
            bankCapacity: 0
        },
        starches: 0,
        canEnterTower: true,
        workCount: 0,
        workScenarioCounts: {
            regular: 0,
            large: 0,
            sweet: 0,
            taro: 0,
            poison: 0,
            metalSuccess: 0,
            metalFailure: 0,
            golden: 0,
            companion: 0,
            ancient: 0,
            mimic: 0,
            goldenYam: 0
        },
        regrades: {
            workMulti: {
                regradeAmount: 0,
                failStack: 0
            },
            passiveAmount: {
                regradeAmount: 0,
                failStack: 0
            },
            bankCapacity: {
                regradeAmount: 0,
                failStack: 0
            }
        },
        maxStarches: 25000,
        achievements: [],
        loginStreak: 0,
        lastLoginDate: null,
        towerChampionCount: 0,
        webLinkToken: null,
        quests: {},
        guildRaidWinCount: 0,
        worldBossWinCount: 0,
        // Persistent opt-in toggled by /join-raid — replaces the old per-raid
        // guild.raidList (push on /join-raid, splice on /leave-raid, and never cleaned
        // up when a member left/was kicked). The live raid roster is now just
        // guild.memberList filtered to whoever currently has this on — see
        // raidFactory.js's getLiveRaidRoster.
        autoJoinRaids: false,
        rebirthCount: 0,
        records: {                  // all-time personal bests, see architecture/data-model.md
            highestTowerFloor: 0,
            biggestWorkPayout: 0,
            largestRaidContribution: 0
        },
        companions: {                // see systems/companions.md
            owned: [],               // array of { id, level } — level static at 1 for now
            active: null,            // companion id currently equipped, or null
            ownedCount: 0,
            mythicOwnedCount: 0,
            scavenging: null,        // { companionId, rarity, returnsAt } | null — see Scavenging in systems/companions.md
            scavengeReturnsByRarity: { legendary: 0, mythic: 0 } // backs the Legendary Legwork/Mythic Milestones achievements — see companionScavengeCollect.js
        },
        // Bad-luck protection for repeated Poison Potato hits in the same week — see
        // workFactory.js's computePoisonMitigation. weekTag resets lazily (computed fresh
        // on each poison hit, not cron-driven) so this is self-contained from Quests'/Guild
        // Contracts' own weekly rotation.
        poisonMitigation: {
            weekTag: null,
            weeklyHitCount: 0
        },
        // Lifetime, never resets — increments the one time per qualifying week a player's
        // weeklyHitCount first reaches PoisonMitigation.MILESTONE_HIT_THRESHOLD, powering
        // the toxic_tolerance achievement. Distinct from poisonMitigation.weeklyHitCount,
        // which resets every Monday and can't be used for a lifetime achievement threshold.
        totalPoisonMilestonesReached: 0
    };
}

const findUser = async function (userId, username) {
    const params = {
        TableName: awsConfigurations.aws_table_name,
        KeyConditionExpression: 'userId = :userId',
        // FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId }
    };

    const response = docClient.query(params).promise()
        .then(async function (data) {
            if (data.Count == 0) {
                console.log(`findUser not found, creating`);
                // Return the freshly-created record instead of null so the caller can
                // proceed immediately (e.g. run /work) rather than telling a brand-new
                // user to retry their command.
                return await addUser(userId, username);
            }
            let user = data.Items[0]

            // Heal a record that exists but is missing top-level fields — e.g. one
            // auto-vivified by an ADD-only write (addUserDatabase) that never went
            // through addUser's full schema, like the house account's tax-skim writes.
            // A record like that can silently poison shared aggregates (the passive
            // income tick, world/guild raid totals) with NaN every time it's touched,
            // so backfill and persist any missing fields the first time it's looked up.
            const defaults = getDefaultUserFields(userId, username);
            const missingFields = {};
            for (const key of Object.keys(defaults)) {
                if (user[key] === undefined) {
                    missingFields[key] = defaults[key];
                } else if (isPlainObject(defaults[key]) && isPlainObject(user[key])) {
                    // A top-level object field (workScenarioCounts, regrades, etc.) that
                    // already exists on an older account can still be missing a sub-key
                    // added to the schema later — e.g. workScenarioCounts.companion,
                    // added well after plenty of real accounts already had a
                    // workScenarioCounts object. The check above only ever sees the
                    // whole object as "present," so a sub-key like that would silently
                    // stay undefined forever. Caught the hard way: `workScenarioCounts
                    // .companion += 1` on an unhealed account produces NaN, which
                    // DynamoDB's UpdateItem rejects outright — failing the ENTIRE
                    // combined write for that action (including the real companion
                    // grant sitting right next to it in the same call), silently, since
                    // updateUserFields only logs write failures rather than surfacing
                    // them. One level of nesting is enough for every current schema
                    // field; go deeper only if a field actually nests further.
                    const missingNested = {};
                    for (const nestedKey of Object.keys(defaults[key])) {
                        if (user[key][nestedKey] === undefined) {
                            missingNested[nestedKey] = defaults[key][nestedKey];
                        }
                    }
                    if (Object.keys(missingNested).length > 0) {
                        missingFields[key] = { ...user[key], ...missingNested };
                    }
                }
            }
            // Two fields are known secondary-index keys whose default value doesn't
            // match the index's expected type, so healing them always fails:
            //  - webLinkToken-index expects a String; our default is `null`, a distinct
            //    DynamoDB type (confirmed via the exact error DynamoDB returns: "Type
            //    mismatch for Index Key webLinkToken Expected: S Actual: NULL").
            //  - guildId doubles as a guild-membership index key; our default is
            //    Number 0, but real values are Discord guild snowflake Strings.
            // Skip both outright rather than waste a round trip on a write we already
            // know will fail — an account without a real value for either is already
            // correctly represented by the field's absence, and it'll get set with the
            // right type the moment it's ever given a real one.
            delete missingFields.guildId;
            delete missingFields.webLinkToken;

            if (Object.keys(missingFields).length > 0) {
                // Heal one field at a time rather than one combined write — if any
                // single field turns out to be a secondary index key with a type
                // conflict we don't know about yet (a combined UpdateItem call fails
                // atomically, so one bad field would otherwise block every other
                // legitimately-fixable field too), this way only that one field stays
                // unhealed instead of all of them.
                const healedFields = {};
                for (const [key, value] of Object.entries(missingFields)) {
                    const healed = await updateUserFields(userId, { [key]: value });
                    if (healed) {
                        healedFields[key] = value;
                    } else {
                        console.log(`findUser could not heal field "${key}" for ${userId} (may be a secondary index key) — leaving it unset`);
                    }
                }
                if (Object.keys(healedFields).length > 0) {
                    console.log(`findUser healed fields for ${userId}: ${Object.keys(healedFields).join(', ')}`);
                    user = { ...user, ...healedFields };
                }
            }

            return user;
        })
        .catch(function (err) {
            console.debug(`findUser error: ${JSON.stringify(err)}`)
        });
    return response
}

const addUser = async function (userId, username) {
    // webLinkToken is a GSI key (webLinkToken-index, type String); the schema default of
    // `null` is DynamoDB's distinct NULL type and gets rejected on Put with "Type mismatch
    // for Index Key webLinkToken Expected: S Actual: NULL" — the same reason findUser's
    // healing step skips backfilling it. Omit it entirely here too so brand-new users can
    // actually be created; it gets set with the correct String type later via linkWeb.js.
    const { webLinkToken, ...Item } = getDefaultUserFields(userId, username);
    var params = {
        TableName: awsConfigurations.aws_table_name,
        Item: Item
    };

    return docClient.put(params).promise()
        .then(async function (response) {
            console.log(`addUser ${userId} to the table`);
            return Item;
        })
        .catch(function (err) {
            console.log(`addUser error: ${JSON.stringify(err)}`);
        });
}

const getUsers = async function () {
    const params = {
        TableName: awsConfigurations.aws_table_name
    };
    return scanAll(params)
        .catch(function (err) {
            console.log(`getUsers error: ${JSON.stringify(err)}`);
            return [];
        });
}

function calculateMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Applies the passive-income tick to every user in one pass, and caches the resulting
// server-wide potato/starch totals (see getCachedServerTotal) plus the median lifetime
// earnings among active accounts (see getCatchUpBonus) so hot paths like /work don't
// need their own full table scan.
// getUsers() is a raw scan — it includes every row in the table, including ones that
// were only ever auto-vivified by an ADD-only write (e.g. the house account's tax-skim
// writes) and never got a full schema. Numeric fields default to 0 via toNumber so one
// such record can't poison this whole-server aggregate with NaN, and so that record's
// own bankStored/totalEarnings gets a valid value written back below (self-healing those
// two fields the next time this runs). Fields this function doesn't write, like
// starches, stay missing on the row itself until something calls findUser on it — see
// findUser's own healing step for the rest of the schema.
function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

const passivePotatoHandler = async function (timesInADay) {
    const allUsers = await getUsers();
    let serverTotal = 0;
    let serverTotalStarches = 0;
    const activeTotalEarnings = [];

    await Promise.all(allUsers.map(async user => {
        // Ladybug (+5%) / Mochi (+8%) and the live rebirth bonus — computed fresh here,
        // never folded into passiveAmount itself, same "one active modifier at the usage
        // site" pattern the guild buff system and every other companion perk follow.
        const passiveIncomePercent = companionFactory.getActivePerkValue(user, "passiveIncomePercent");
        const rebirthPercent = rebirthFactory.getLiveRebirthPercent(user);
        const passiveGain = Math.round(toNumber(user.passiveAmount) * (1 + passiveIncomePercent + rebirthPercent) / timesInADay);
        const userBankStored = toNumber(user.bankStored) + passiveGain;
        const userTotalEarnings = toNumber(user.totalEarnings) + passiveGain;
        await updateBankStoredPotatoesAndTotalEarnings(user.userId, userBankStored, userTotalEarnings);
        serverTotal += toNumber(user.potatoes) + userBankStored;
        serverTotalStarches += toNumber(user.starches);
        if (user.workCount > 0) {
            activeTotalEarnings.push(userTotalEarnings);
        }
    }));

    const medianTotalEarnings = calculateMedian(activeTotalEarnings);
    await updateStatFields("economy", { serverTotal, serverTotalStarches, medianTotalEarnings, activeUserCount: activeTotalEarnings.length });
    return;
}

// Guild treasury interest: a daily % of bankStored, scaled by member count, applied
// fractionally on the same 5-minute cadence passivePotatoHandler already uses for
// personal passive income — see Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER. Unlike
// personal passive income (a flat amount unrelated to what's already banked), this is a
// genuine percentage of bankStored, so an empty or freshly-emptied treasury earns
// nothing — there has to be something banked for a bigger roster to be worth it. Never
// pushes bankStored past bankCapacity, same "cap wins" rule every other guild deposit
// path already follows.
const applyGuildTreasuryInterest = async function (timesInADay) {
    const allGuilds = await getGuilds();

    await Promise.all(allGuilds.map(async guild => {
        const bankStored = toNumber(guild.bankStored);
        if (bankStored <= 0) return;

        const memberCount = Array.isArray(guild.memberList) ? guild.memberList.length : 0;
        const dailyRate = Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER * memberCount;
        const interest = Math.round(bankStored * dailyRate / timesInADay);
        if (interest <= 0) return;

        const bankCapacity = toNumber(guild.bankCapacity);
        const newBankStored = Math.min(bankStored + interest, bankCapacity);
        if (newBankStored === bankStored) return;

        await updateGuildDatabase(guild.guildId, 'bankStored', newBankStored);
    }));
}

// Returns the catch-up multiplier bonus (e.g. 0.8 => +80%) for a user's personal work
// multiplier, based on how far their lifetime totalEarnings sits below the server
// median. Scaled down toward 0 both by population size and by how "mature" (deep) the
// economy currently is, so it stays dormant on a young/shallow server and only reaches
// full strength once there's a genuinely deep gap to correct. See systems/economy-and-work.md.
const getCatchUpBonus = async function (userDetails) {
    const economy = await getStatDatabase("economy");
    if (!economy || !economy.medianTotalEarnings || economy.medianTotalEarnings <= 0) return 0;
    if (!economy.activeUserCount || economy.activeUserCount < CatchUp.MIN_POPULATION) return 0;

    const target = economy.medianTotalEarnings;
    const maturity = Math.min(target / CatchUp.MATURITY_REFERENCE, 1);
    const effectiveStrength = CatchUp.CATCHUP_STRENGTH * maturity;

    const gap = Math.max(0, Math.min((target - userDetails.totalEarnings) / target, 1));
    return gap * effectiveStrength;
}

const updateBankStoredPotatoesAndTotalEarnings = async function (userId, newBankStored, newTotalEarnings) {
    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set bankStored = :bankStored, totalEarnings = :totalEarnings",
        ExpressionAttributeValues: {
            ":bankStored": newBankStored,
            ":totalEarnings": newTotalEarnings
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateBankStoredPotatoesAndTotalEarnings: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateBankStoredPotatoesAndTotalEarnings error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Birthday Handling
const addBirthday = async function (userId, username, birthday) {
    const Item = {
        userId: userId,
        username: username,
        birthday: birthday
    };
    var params = {
        TableName: awsConfigurations.aws_birthday_table_name,
        Item: Item
    };

    return docClient.put(params).promise()
        .then(async function (response) {
            console.log(`addBirthday ${JSON.stringify(Item)} to the table`);
        })
        .catch(function (err) {
            console.log(`addBirthday error: ${JSON.stringify(err)}`);
        });
}

const getAllBirthdays = async function () {
    const params = {
        TableName: awsConfigurations.aws_birthday_table_name
    };
    let birthdayList;
    const response = await docClient.scan(params).promise()
        .then(async function (data) {
            // console.log(`getAllBirthdays: ${JSON.stringify(data)}`);
            birthdayList = data.Items;
        })
        .catch(function (err) {
            console.log(`getAllBirthdays error: ${JSON.stringify(err)}`);
        });
    return birthdayList
}

// Betting handling
const addBet = async function (betId, optionOne, optionTwo, description, thumbnailUrl, baseAmount) {
    const Item = {
        betId: betId,
        description: description,
        thumbnailUrl: thumbnailUrl,
        isLocked: false,
        isActive: true,
        optionOne: optionOne,
        optionOneVoters: [],
        optionOneTotal: baseAmount,
        optionTwo: optionTwo,
        optionTwoVoters: [],
        optionTwoTotal: baseAmount,
        winningOption: "",
        baseAmount: baseAmount
    };

    var params = {
        TableName: awsConfigurations.aws_betting_table_name,
        Item: Item
    };

    return docClient.put(params).promise()
        .then(async function (response) {
            console.log(`addNewBet ${JSON.stringify(Item)} to the table`);
        })
        .catch(function (err) {
            console.log(`addNewBet error: ${JSON.stringify(err)}`);
        });
}

const getMostRecentBet = async function () {
    let betList = await getAllBets();
    betList.sort((a, b) => parseFloat(b.betId) - parseFloat(a.betId));
    const mostRecentBet = betList[0];
    return mostRecentBet
}

const getAllBets = async function () {
    const params = {
        TableName: awsConfigurations.aws_betting_table_name
    };
    let betList;
    const response = await docClient.scan(params).promise()
        .then(async function (data) {
            // console.log(`getAllBets: ${JSON.stringify(data)}`);
            betList = data.Items;
        })
        .catch(function (err) {
            console.log(`getAllBets error: ${JSON.stringify(err)}`);
        });
    return betList
}

const addUserToBet = async function (betId, userId, userDisplayName, bet, choice) {
    const mostRecentBet = await getMostRecentBet();

    let newList, newTotal, optionName;
    if (choice == 1) {
        let foundFlag = false
        mostRecentBet.optionOneVoters.forEach(voter => {
            if (foundFlag == false && voter.userId == userId) {
                voter.bet += bet;
                foundFlag = true;
            }
        })
        if (foundFlag == false) {
            mostRecentBet.optionOneVoters.push({
                userId: userId,
                bet: bet,
                userDisplayName: userDisplayName
            });
        }
        newList = mostRecentBet.optionOneVoters;
        newTotal = mostRecentBet.optionOneTotal += bet;
        optionName = 'optionOne';
    } else {
        let foundFlag = false
        mostRecentBet.optionTwoVoters.forEach(voter => {
            if (foundFlag == false && voter.userId == userId) {
                voter.bet += bet;
                foundFlag = true;
            }
        })
        if (foundFlag == false) {
            mostRecentBet.optionTwoVoters.push({
                userId: userId,
                bet: bet,
                userDisplayName: userDisplayName
            });
        }
        newList = mostRecentBet.optionTwoVoters;
        newTotal = mostRecentBet.optionTwoTotal += bet;
        optionName = 'optionTwo'
    };
    const params = {
        TableName: awsConfigurations.aws_betting_table_name,
        Key: {
            betId: betId,
        },
        UpdateExpression: `set ${optionName}Voters = :newList, ${optionName}Total = :newTotal`,
        ExpressionAttributeValues: {
            ":newList": newList,
            ":newTotal": newTotal,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserPotatoes: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserPotatoes error: ${JSON.stringify(err)}`)
        });
    return response;
}

const endCurrentBet = async function (betId, winningOption) {
    const params = {
        TableName: awsConfigurations.aws_betting_table_name,
        Key: {
            betId: betId,
        },
        UpdateExpression: `set isActive = :isActive, winningOption = :winningOption`,
        ExpressionAttributeValues: {
            ":isActive": false,
            ":winningOption": winningOption,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`endCurrentBet: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`endCurrentBet error: ${JSON.stringify(err)}`)
        });
    return response;
}

const lockCurrentBet = async function (betId) {
    const params = {
        TableName: awsConfigurations.aws_betting_table_name,
        Key: {
            betId: betId,
        },
        UpdateExpression: `set isLocked = :isLocked`,
        ExpressionAttributeValues: {
            ":isLocked": true,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`lockCurrentBet: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`lockCurrentBet error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Stats
const updateStatDatabase = async function (trackingId, attributeName, attributeValue) {
    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: trackingId,
        },
        UpdateExpression: `set #attrName = :attrValue`,
        ExpressionAttributeNames: {
            "#attrName": attributeName,
        },
        ExpressionAttributeValues: {
            ":attrValue": attributeValue,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateStatDatabase: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateStatDatabase error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Combines multiple stats-table attribute writes for one trackingId into a single call.
const updateStatFields = async function (trackingId, setAttributes = {}) {
    const { expression, names, values } = buildUpdateExpression(setAttributes);
    if (!expression) return;

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: trackingId,
        },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .catch(function (err) {
            console.debug(`updateStatFields error: ${JSON.stringify(err)}`)
        });
    return response;
}

const getStatDatabase = async function (trackingId) {
    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        KeyConditionExpression: 'trackingId = :trackingId',
        ExpressionAttributeValues: { ':trackingId': trackingId }
    };

    const response = docClient.query(params).promise()
        .then(async function (data) {
            coinflip = data.Items[0]
            return coinflip;
        })
        .catch(function (err) {
            console.debug(`getStatDatabase error: ${JSON.stringify(err)}`)
        });
    return response
}

// Guilds
// Note: previously had a comment-only `.then()` handler, which meant every call
// resolved to `undefined` on BOTH success and failure — harmless while every existing
// call site fired-and-forgot the return value, but it made the return value useless for
// anything that needed to know whether the write actually landed (e.g. findGuildById's
// healing loop below). Matches updateUserFields's shape now: resolves to the DynamoDB
// response (truthy) on success, undefined (falsy) on failure.
const updateGuildDatabase = async function (guildId, attributeName, attributeValue) {
    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: `set #attrName = :attrValue`,
        ExpressionAttributeNames: {
            "#attrName": attributeName,
        },
        ExpressionAttributeValues: {
            ":attrValue": attributeValue,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .catch(function (err) {
            console.debug(`updateGuildDatabase error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Optimistic-concurrency write for guild attributes that get read-modify-written by
// several commands (memberList, inviteList) — invite/join-guild/kick/promote/demote/
// pass-leadership all read the whole guild, mutate a list locally, then write the whole
// list back with no locking, so two near-simultaneous mutations (e.g. two invitees
// joining at once) can silently clobber each other. Conditioning the write on the
// guildVersion the caller actually read closes that race: if another command wrote to
// this guild in between, the write is rejected instead of overwriting it, and the
// caller re-prompts the user to retry instead of losing the change. attribute_not_exists
// covers guild records created before this field existed, healing them to version 0 on
// their first guarded write. Returns true if the write landed, false if it lost the race
// (or hit any other error).
const updateGuildFieldsWithLock = async function (guildId, expectedVersion, setAttributes) {
    const version = expectedVersion || 0;
    const { expression, names, values } = buildUpdateExpression({ ...setAttributes, guildVersion: version + 1 });

    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: expression,
        ConditionExpression: "attribute_not_exists(guildVersion) OR guildVersion = :expectedVersion",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ...values, ":expectedVersion": version },
    };

    try {
        await docClient.update(params).promise();
        return true;
    } catch (err) {
        if (err.code !== 'ConditionalCheckFailedException') {
            console.debug(`updateGuildFieldsWithLock error: ${JSON.stringify(err)}`);
        }
        return false;
    }
}

// Same optimistic-concurrency shape as updateGuildFieldsWithLock, for stats-table docs
// that get read-modify-written by more than one command at once — the companion market's
// shared `listings` array (list/buy/cancel could all race on the same doc) is the first
// user of this. Conditions the write on a `version` field the caller read, so a
// concurrent write loses instead of silently clobbering; attribute_not_exists covers a
// doc created before this field existed, healing it to version 0 on its first guarded write.
const updateStatFieldsWithLock = async function (trackingId, expectedVersion, setAttributes) {
    const version = expectedVersion || 0;
    const { expression, names, values } = buildUpdateExpression({ ...setAttributes, version: version + 1 });

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: trackingId,
        },
        UpdateExpression: expression,
        ConditionExpression: "attribute_not_exists(version) OR version = :expectedVersion",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: { ...values, ":expectedVersion": version },
    };

    try {
        await docClient.update(params).promise();
        return true;
    } catch (err) {
        if (err.code !== 'ConditionalCheckFailedException') {
            console.debug(`updateStatFieldsWithLock error: ${JSON.stringify(err)}`);
        }
        return false;
    }
}

const getGuilds = async function () {
    const params = {
        TableName: awsConfigurations.aws_guilds_table_name
    };
    let guildList = await scanAll(params)
        .catch(function (err) {
            console.log(`getGuilds error: ${JSON.stringify(err)}`);
            return [];
        });
    guildList = guildList.filter(guild => guild.memberList.length > 0);
    return guildList
}

const findGuildById = async function (guildId) {
    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        KeyConditionExpression: 'guildId = :guildId',
        // FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':guildId': guildId }
    };

    const response = docClient.query(params).promise()
        .then(async function (data) {
            let guild = data.Items[0];
            if (!guild) return guild;

            // Heal a guild record that predates a schema field added after the guild
            // was created. The guild table has no ADD-only write path that could
            // auto-vivify a partial item the way the user table's tax-skim writes
            // did — but every guild created before a given feature shipped is still
            // permanently missing that feature's field(s) unless something backfills
            // it, since createGuild only ever `put`s the schema as it existed at
            // creation time. Same failure mode (and fix) as findUser's own healing
            // step — see architecture/data-model.md. guildLeaderId/guildLeaderUsername
            // are passed as undefined here since they only ever affect the memberList
            // default, which a *found* guild record will never actually be missing
            // (it's been present since the guild's very first write) — so that default
            // is constructed but never actually used by this path.
            const defaults = getDefaultGuildFields(guild.guildId, guild.guildName, undefined, undefined, guild.thumbnailUrl);
            const missingFields = {};
            for (const key of Object.keys(defaults)) {
                if (guild[key] === undefined) {
                    missingFields[key] = defaults[key];
                }
            }

            if (Object.keys(missingFields).length > 0) {
                // Heal one field at a time rather than one combined write — same
                // reasoning as findUser: an unexpected failure on one field (e.g. a
                // future secondary index key type conflict) shouldn't block every
                // other legitimately-fixable field too.
                const healedFields = {};
                for (const [key, value] of Object.entries(missingFields)) {
                    const healed = await updateGuildDatabase(guildId, key, value);
                    if (healed) {
                        healedFields[key] = value;
                    } else {
                        console.log(`findGuildById could not heal field "${key}" for ${guildId} — leaving it unset`);
                    }
                }
                if (Object.keys(healedFields).length > 0) {
                    console.log(`findGuildById healed fields for ${guildId}: ${Object.keys(healedFields).join(', ')}`);
                    guild = { ...guild, ...healedFields };
                }
            }

            return guild;
        })
        .catch(function (err) {
            console.debug(`findGuild error: ${JSON.stringify(err)}`)
        });
    return response
}

const findGuildByName = async function (guildName) {
    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        // KeyConditionExpression: 'guildName = :guildName',
        FilterExpression: 'guildNameLowercase = :guildNameLowercase',
        ExpressionAttributeValues: { ':guildNameLowercase': guildName.toLowerCase() }
    };

    const response = docClient.scan(params).promise()
        .then(async function (data) {
            guild = data.Items[0]
            // console.debug(`findGuildByName found guild: ${JSON.stringify(user)}`)
            return guild;
        })
        .catch(function (err) {
            console.debug(`findGuildByName error: ${JSON.stringify(err)}`)
        });
    return response
}

// The full default guild shape. Extracted so both createGuild (new records) and
// findGuildById's healing step (existing-but-partial records — see below) stay in sync
// with exactly one schema definition, mirroring getDefaultUserFields/findUser.
function getDefaultGuildFields(guildId, guildName, guildLeaderId, guildLeaderUsername, guildThumbnailUrl) {
    return {
        guildId: guildId,
        guildName: guildName,
        guildNameLowercase: guildName.toLowerCase(),
        memberCap: 5,
        memberList: [
            {
                id: guildLeaderId,
                username: guildLeaderUsername,
                role: 'Leader'
            }
        ],
        bankCapacity: 1000000,
        // Mirrors sweetPotatoBuffs.bankCapacity on the user table: an additive bonus
        // layered on top of guildShops' bankCapacity ladder, tracked separately so it
        // survives shop purchases instead of being overwritten by them. Starts equal to
        // the starting bankCapacity above so a fresh guild's BASE (bankCapacity -
        // bankCapacityBonus) is exactly 0 — guildShops' bankCapacity tier 0's
        // currentAmount — which is what guildBuy.js's exact-match getNextItemFromShop
        // lookup requires to find a tier at all. Without this, a brand-new guild's
        // bankCapacity (1,000,000) never matched any tier boundary and /guild-buy
        // bank-capacity always reported "already maxed out!".
        bankCapacityBonus: 1000000,
        bankStored: 0,
        // No stored level/raidRewardMultiplier field — both are computed live from
        // raidCount by raidFactory.js's getRaidLevelInfo (see constants.js's RaidLevel).
        // The old stored fields were permanently stuck at their defaults with no code
        // path ever updating them; computing them removes that sync-drift class of bug
        // entirely instead of adding a second write path to keep in sync.
        raidCount: 0,
        totalEarnings: 0,
        thumbnailUrl: guildThumbnailUrl,
        raidTimer: 0,
        inviteList: [],
        // No stored raidList — the live raid roster is computed on demand from
        // memberList + each member's autoJoinRaids toggle (see raidFactory.js's
        // getLiveRaidRoster), same "compute live, never let a second write path drift
        // out of sync" reasoning as raidCount/raidRewardMultiplier above. The old
        // stored array needed leave.js/kick.js to explicitly prune a departing member
        // and neither did, so a departed member could linger in a raid indefinitely.
        guildBuff: "workMulti",
        guildVersion: 0,
        guildContract: {                  // see systems/guild-contracts.md
            templateId: null,
            rotationDate: null,
            memberBaselines: {},
            frozenContribution: 0,
            completed: false
        },
        raidHistory: [],       // most recent HISTORY_MAX_ENTRIES guild raids — see startRaid.js
        contractHistory: []    // most recent HISTORY_MAX_ENTRIES completed Guild Contracts — see guildContractFactory.js
    };
}

const createGuild = async function (guildId, guildName, guildLeaderId, guildLeaderUsername, guildThumbnailUrl) {
    const Item = getDefaultGuildFields(guildId, guildName, guildLeaderId, guildLeaderUsername, guildThumbnailUrl);

    var params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Item: Item
    };

    return docClient.put(params).promise()
        .then(async function (response) {
            console.log(`createGuild ${JSON.stringify(Item)} to the table`);
        })
        .catch(function (err) {
            console.log(`createGuild error: ${JSON.stringify(err)}`);
        });
}

const getServerTotal = async function () {
    let total = 0;
    let allUsers = await getUsers();
    allUsers.forEach(user => {
        total += user.potatoes;
        total += user.bankStored;
    })
    return total
}

// Reads the server total cached by passivePotatoHandler (refreshed every 5 minutes)
// instead of scanning the whole user table live. Falls back to a live scan if the
// cache hasn't been populated yet (e.g. right after a fresh deploy).
const getCachedServerTotal = async function () {
    const economy = await getStatDatabase("economy");
    if (economy && typeof economy.serverTotal === 'number') {
        return economy.serverTotal;
    }
    return getServerTotal();
}

const getServerTotalStarches = async function () {
    let total = 0;
    let allUsers = await getUsers();
    allUsers.forEach(user => {
        total += user.starches;
    })
    return total
}

const getSortedUsers = async function () {
    let allUsers = await getUsers();
    const sortedUsers = allUsers.sort((a, b) => parseFloat(b.potatoes + b.bankStored) - parseFloat(a.potatoes + a.bankStored));
    return sortedUsers
}

const getSortedUserStarches = async function () {
    let allUsers = await getUsers();
    const sortedUsers = allUsers.sort((a, b) => parseFloat(b.starches) - parseFloat(a.starches));
    return sortedUsers
}

// Guild level (see raidFactory.js's getRaidLevelInfo) is now computed purely from
// raidCount, so sorting by level-then-raidCount is exactly equivalent to sorting by
// raidCount alone — level is a monotonic readout of the same number, not a separate
// signal. Simplified accordingly rather than keeping a two-key sort over one value.
const getSortedGuildsByLevelAndRaidCount = async function () {
    let allGuilds = await getGuilds();
    return allGuilds.sort((a, b) => b.raidCount - a.raidCount);
}

const getSortedGuildsById = async function () {
    let allGuilds = await getGuilds();
    const sortedUsers = allGuilds.sort((a, b) => parseFloat(b.guildId) - parseFloat(a.guildId));
    return sortedUsers
}

// Shared shape for a fire-and-forget "set one field to a fixed value across every user"
// bulk update — removeStarches/resetAllTowerEntries each repeated this inline (a third,
// unused copy — addNewUserAttribute — has been removed entirely). Not awaited per-user
// (matches both originals' existing fire-and-forget behavior — neither ever awaited
// individual completions, only that the loop kicked off).
async function bulkUpdateAllUsers(fieldName, value, label) {
    let userList = await getUsers();

    userList.forEach(async user => {
        const params = {
            TableName: awsConfigurations.aws_table_name,
            Key: {
                userId: user.userId,
            },
            UpdateExpression: `set ${fieldName} = :${fieldName}`,
            ExpressionAttributeValues: {
                [`:${fieldName}`]: value,
            },
            ReturnValues: "ALL_NEW",
        };

        await docClient.update(params).promise()
            .then(async function (data) {
                console.log(`${label}: ${JSON.stringify(data)}`)
            })
            .catch(function (err) {
                console.log(`${label} error: ${JSON.stringify(err)}`)
            });
    })
    console.log('updated all users')
}

// Was previously mislabeling its own log output "addNewUserAttribute" (a leftover from
// being copy-pasted from that now-removed function) — now labeled correctly.
const removeStarches = async function () {
    return bulkUpdateAllUsers('starches', 0, 'removeStarches');
}

const resetAllTowerEntries = async function () {
    return bulkUpdateAllUsers('canEnterTower', true, 'resetAllTowerEntries');
}

// Daily Tater Tower leaderboard — a small array living in the stats table's
// "tower_leaderboard" doc, one entry per survived run today (see towerFactory.js for how
// "survived" vs "died" is determined). Read/appended by enter-tower.js as runs finish,
// ranked/paid out/cleared by towerLeaderboardFactory.js at the daily reset.
const recordTowerLeaderboardEntry = async function (entry) {
    const tower = await getStatDatabase("tower_leaderboard");
    const entries = (tower && tower.entries) || [];
    entries.push(entry);
    await updateStatFields("tower_leaderboard", { entries });
}

const getTowerLeaderboard = async function () {
    const tower = await getStatDatabase("tower_leaderboard");
    return (tower && tower.entries) || [];
}

const clearTowerLeaderboard = async function () {
    await updateStatFields("tower_leaderboard", { entries: [] });
}

// Which quests are currently live, and when each category's rotation started (used to
// tell a fresh per-user progress snapshot from a stale one left over from a prior
// rotation of the same quest — see questFactory.js).
const getActiveQuests = async function () {
    return getStatDatabase("active_quests");
}

const setActiveQuests = async function (activeQuests) {
    await updateStatFields("active_quests", activeQuests);
}

// Which Guild Contract is currently live server-wide (template + rotation date) — each
// guild's own progress against it (roster snapshot + accumulated per-member deltas) is
// tracked separately on the guild record itself (guild.guildContract), not here. Mirrors
// getActiveQuests/setActiveQuests, just for the single shared weekly guild objective
// instead of the daily/weekly per-user quest sets — see guildContractFactory.js.
const getActiveGuildContract = async function () {
    return getStatDatabase("active_guild_contract");
}

const setActiveGuildContract = async function (activeContract) {
    await updateStatFields("active_guild_contract", activeContract);
}

// Persists a Guild Contract's completion — the bankCapacity reward, its matching
// bankCapacityBonus bump (see getDefaultGuildFields — keeps the reward layered on top of
// guildShops' ladder instead of getting silently absorbed by the next shop purchase),
// and the guildContract map itself (marked completed: true) — in one atomic conditional
// write, so two guild members finishing the objective via near-simultaneous /work calls
// can't both grant the reward. Same race-safety shape as claimDailyStreak/updateIfNewRecord.
// Returns true if this call won the completion, false if it lost the race (or hit any
// other error) — a lost race isn't a bug, it just means another concurrent call already
// applied the reward first.
const completeGuildContract = async function (guildId, newBankCapacity, newBankCapacityBonus, updatedGuildContract) {
    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set bankCapacity = :bankCapacity, bankCapacityBonus = :bankCapacityBonus, guildContract = :guildContract",
        ConditionExpression: "attribute_not_exists(guildContract.completed) OR guildContract.completed = :false",
        ExpressionAttributeValues: {
            ":bankCapacity": newBankCapacity,
            ":bankCapacityBonus": newBankCapacityBonus,
            ":guildContract": updatedGuildContract,
            ":false": false,
        },
        ReturnValues: "ALL_NEW",
    };

    return docClient.update(params).promise()
        .then(() => true)
        .catch(function (err) {
            if (err.code !== "ConditionalCheckFailedException") {
                console.debug(`completeGuildContract error: ${JSON.stringify(err)}`)
            }
            return false;
        });
}

module.exports = {
    addUserDatabase,
    calculateWorkTimerValue,
    updateUserDatabase,
    updateUserFields,
    claimDailyStreak,
    updateIfNewRecord,
    resolveScavenge,
    addUser,
    findUser,
    getUsers,
    passivePotatoHandler,
    applyGuildTreasuryInterest,
    getCatchUpBonus,

    addBirthday,
    getAllBirthdays,

    addBet,
    getMostRecentBet,
    getAllBets,
    addUserToBet,
    endCurrentBet,
    lockCurrentBet,

    updateStatDatabase,
    updateStatFields,
    updateStatFieldsWithLock,
    getStatDatabase,

    updateGuildDatabase,
    updateGuildFieldsWithLock,
    findGuildById,
    findGuildByName,
    createGuild,

    getServerTotal,
    getCachedServerTotal,
    getServerTotalStarches,
    getSortedUsers,
    getSortedUserStarches,
    getSortedGuildsByLevelAndRaidCount,
    getSortedGuildsById,
    removeStarches,
    resetAllTowerEntries,

    recordTowerLeaderboardEntry,
    getTowerLeaderboard,
    clearTowerLeaderboard,

    getActiveQuests,
    setActiveQuests,

    getActiveGuildContract,
    setActiveGuildContract,
    completeGuildContract
}
