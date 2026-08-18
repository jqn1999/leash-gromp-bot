const { awsConfigurations, Work, CatchUp } = require("../utils/constants.js");
const AWS = require('aws-sdk');
// const config = require('../config.js');

AWS.config.update(awsConfigurations.aws_remote_config);
const docClient = new AWS.DynamoDB.DocumentClient();

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

// Computes the work-timer expiry (including the guild workTimer-buff discount) without
// writing it, so callers can fold the result into a combined updateUserFields call.
const calculateWorkTimerValue = async function (userDetails, cooldownTime) {
    let time = cooldownTime == Work.POISON_POTATO_TIMER_INCREASE_SECONDS ? Date.now() + cooldownTime * 1000 : Date.now() + Work.WORK_TIMER_SECONDS * 1000

    const userGuildId = userDetails.guildId;
    if (userGuildId) {
        let guild = await findGuildById(userDetails.guildId);
        if (guild) {
            if (guild.guildBuff == "workTimer") {
                const timeReduced = cooldownTime * 1000 * .10; // 10% reduction
                time -= timeReduced;
            }
        }
    }
    return time;
}

const updateWorkTimer = async function (userDetails, cooldownTime) {
    const time = await calculateWorkTimerValue(userDetails, cooldownTime);
    return updateUserFields(userDetails.userId, { workTimer: time });
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
        bankCapacity: 0,
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
            golden: 0
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
        worldBossWinCount: 0
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
        const passiveGain = Math.round(toNumber(user.passiveAmount) / timesInADay);
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
        .then(async function (data) {
            // console.debug(`updateGuildDatabase: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildDatabase error: ${JSON.stringify(err)}`)
        });
    return response;
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
            guild = data.Items[0]
            // console.debug(`findGuild found guild: ${JSON.stringify(user)}`)
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

const createGuild = async function (guildId, guildName, guildLeaderId, guildLeaderUsername, guildThumbnailUrl) {
    const Item = {
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
        bankStored: 0,
        level: 1,
        raidCount: 0,
        totalEarnings: 0,
        thumbnailUrl: guildThumbnailUrl,
        raidTimer: 0,
        inviteList: [],
        raidList: [],
        raidRewardMultiplier: 1,
        guildBuff: "workMulti"
    };

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

// Misc
const addNewUserAttribute = async function () {
    let userList = await getUsers();

    userList.forEach(async user => {
        const params = {
            TableName: awsConfigurations.aws_table_name,
            Key: {
                userId: user.userId,
            },
            UpdateExpression: "set maxStarches = :maxStarches",
            ExpressionAttributeValues: {
                ":maxStarches": 25000,
            },
            ReturnValues: "ALL_NEW",
        };

        const response = await docClient.update(params).promise()
            .then(async function (data) {
                console.log(`addNewUserAttribute: ${JSON.stringify(data)}`)
            })
            .catch(function (err) {
                console.log(`addNewUserAttribute error: ${JSON.stringify(err)}`)
            });
    })
    console.log('updated all users')
    // return response;
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

const getSortedGuildsByLevelAndRaidCount = async function () {
    let allGuilds = await getGuilds();
    const sortedGuilds = allGuilds.sort((a, b) => {
        // First, compare by level
        const levelComparison = parseFloat(b.level) - parseFloat(a.level);

        // If levels are the same, compare by memberCount
        return levelComparison != 0 ? levelComparison : b.raidCount - a.raidCount;
    });

    return sortedGuilds;
}

const getSortedGuildsById = async function () {
    let allGuilds = await getGuilds();
    const sortedUsers = allGuilds.sort((a, b) => parseFloat(b.guildId) - parseFloat(a.guildId));
    return sortedUsers
}

const removeStarches = async function () {
    let userList = await getUsers();

    userList.forEach(async user => {
        const params = {
            TableName: awsConfigurations.aws_table_name,
            Key: {
                userId: user.userId,
            },
            UpdateExpression: "set starches = :starches",
            ExpressionAttributeValues: {
                ":starches": 0,
            },
            ReturnValues: "ALL_NEW",
        };

        const response = await docClient.update(params).promise()
            .then(async function (data) {
                console.log(`addNewUserAttribute: ${JSON.stringify(data)}`)
            })
            .catch(function (err) {
                console.log(`addNewUserAttribute error: ${JSON.stringify(err)}`)
            });
    })
    console.log('updated all users')
    // return response;
}

const resetAllTowerEntries = async function () {
    let userList = await getUsers();

    userList.forEach(async user => {
        const params = {
            TableName: awsConfigurations.aws_table_name,
            Key: {
                userId: user.userId,
            },
            UpdateExpression: "set canEnterTower = :canEnterTower",
            ExpressionAttributeValues: {
                ":canEnterTower": true,
            },
            ReturnValues: "ALL_NEW",
        };

        const response = await docClient.update(params).promise()
            .then(async function (data) {
                console.log(`resetAllTowerEntries: ${JSON.stringify(data)}`)
            })
            .catch(function (err) {
                console.log(`resetAllTowerEntries error: ${JSON.stringify(err)}`)
            });
    })
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

module.exports = {
    addUserDatabase,
    updateWorkTimer,
    calculateWorkTimerValue,
    updateUserDatabase,
    updateUserFields,
    claimDailyStreak,
    addUser,
    findUser,
    getUsers,
    passivePotatoHandler,
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
    getStatDatabase,

    updateGuildDatabase,
    findGuildById,
    findGuildByName,
    createGuild,

    addNewUserAttribute,
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
    setActiveQuests
}
