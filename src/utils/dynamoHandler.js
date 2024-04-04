const { awsConfigurations, Work } = require("../utils/constants.js");
const AWS = require('aws-sdk');
// const config = require('../config.js');

// User Handling
const addUserDatabase = async function (userId, attributeName, attributeValue) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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

const updateWorkTimer = async function (userDetails, cooldownTime) {
    let userId = userDetails.userId
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    // check for work timer guild buff
    const userGuildId = userDetails.guildId;
    let time = cooldownTime == Work.POISON_POTATO_TIMER_INCREASE_SECONDS ? Date.now() + cooldownTime*1000 : Date.now() + Work.WORK_TIMER_SECONDS*1000
    if (userGuildId) {
        let guild = await findGuildById(userDetails.guildId);
        if (guild) {
            if (guild.guildBuff == "workTimer") {
                const timeReduced = cooldownTime * 1000 * .10; // 10% reduction
                time -= timeReduced;
            }
        }
    }

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: `set #attrName = :attrValue`,
        ExpressionAttributeNames: {
            "#attrName": "workTimer",
        },
        ExpressionAttributeValues: {
            ":attrValue": time,
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

const findUser = async function (userId, username) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        KeyConditionExpression: 'userId = :userId',
        // FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId }
    };

    const response = docClient.query(params).promise()
        .then(async function (data) {
            if (data.Count == 0) {
                console.log(`findUser not found`);
                await addUser(userId, username);
                return null;
            }
            user = data.Items[0]
            // console.debug(`findUser found user: ${JSON.stringify(user)}`)
            return user;
        })
        .catch(function (err) {
            console.debug(`findUser error: ${JSON.stringify(err)}`)
        });
    return response
}

const addUser = async function (userId, username) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const Item = {
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
        }
    };
    var params = {
        TableName: awsConfigurations.aws_table_name,
        Item: Item
    };

    return docClient.put(params).promise()
        .then(async function (response) {
            console.log(`addUser ${userId} to the table`);
        })
        .catch(function (err) {
            console.log(`addUser error: ${JSON.stringify(err)}`);
        });
}

const getUsers = async function () {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name
    };
    let userList;
    const response = await docClient.scan(params).promise()
        .then(async function (data) {
            // console.log(`getUsers: ${JSON.stringify(data)}`);
            userList = data.Items;
        })
        .catch(function (err) {
            console.log(`getUsers error: ${JSON.stringify(err)}`);
        });
    return userList
}

const passivePotatoHandler = async function (timesInADay) {
    const allUsers = await getUsers();
    await allUsers.forEach(async user => {
        const passiveGain = Math.round(user.passiveAmount / timesInADay);
        let userId = user.userId;
        let userBankStored = user.bankStored + passiveGain;
        let userTotalEarnings = user.totalEarnings + passiveGain;
        await updateBankStoredPotatoesAndTotalEarnings(userId, userBankStored, userTotalEarnings);
    });
    return;
}

const updateBankStoredPotatoesAndTotalEarnings = async function (userId, newBankStored, newTotalEarnings) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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

const getStatDatabase = async function (trackingId) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_guilds_table_name
    };
    let guildList;
    const response = await docClient.scan(params).promise()
        .then(async function (data) {
            // console.log(`getGuilds: ${JSON.stringify(data)}`);
            guildList = data.Items;
            guildList = guildList.filter(guild => guild.memberList.length > 0);
        })
        .catch(function (err) {
            console.log(`getGuilds error: ${JSON.stringify(err)}`);
        });
    return guildList
}

const findGuildById = async function (guildId) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    let userList = await getUsers();

    userList.forEach(async user => {
        const params = {
            TableName: awsConfigurations.aws_table_name,
            Key: {
                userId: user.userId,
            },
            UpdateExpression: "set workScenarioCounts = :workScenarioCounts",
            ExpressionAttributeValues: {
                ":workScenarioCounts": {
                    regular: 0,
                    large: 0,
                    sweet: 0,
                    taro: 0,
                    poison: 0,
                    metalSuccess: 0,
                    metalFailure: 0,
                    golden: 0
                },
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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

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

module.exports = {
    addUserDatabase,
    updateWorkTimer,
    updateUserDatabase,
    addUser,
    findUser,
    getUsers,
    passivePotatoHandler,

    addBirthday,
    getAllBirthdays,

    addBet,
    getMostRecentBet,
    getAllBets,
    addUserToBet,
    endCurrentBet,
    lockCurrentBet,

    updateStatDatabase,
    getStatDatabase,

    updateGuildDatabase,
    findGuildById,
    findGuildByName,
    createGuild,

    addNewUserAttribute,
    getServerTotal,
    getServerTotalStarches,
    getSortedUsers,
    getSortedUserStarches,
    getSortedGuildsByLevelAndRaidCount,
    getSortedGuildsById,
    removeStarches,
    resetAllTowerEntries
}
