const { awsConfigurations } = require("../utils/constants.js");
const AWS = require('aws-sdk');
// const config = require('../config.js');

const statTrackingIds = {
    COINFLIP: "coinflip",
    WORK: "work",
    BET: "bet",
}

// User Handling
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
        guildId: 0
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

const updateUserPotatoes = async function (userId, potatoes) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set potatoes = :potatoes",
        ExpressionAttributeValues: {
            ":potatoes": potatoes,
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

const updateUserPotatoesAndEarnings = async function (userId, potatoes, totalEarnings) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set potatoes = :potatoes, totalEarnings = :totalEarnings",
        ExpressionAttributeValues: {
            ":potatoes": potatoes,
            ":totalEarnings": totalEarnings
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserPotatoesAndEarnings: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserPotatoesAndEarnings error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateUserPotatoesAndLosses = async function (userId, potatoes, totalLosses) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set potatoes = :potatoes, totalLosses = :totalLosses",
        ExpressionAttributeValues: {
            ":potatoes": potatoes,
            ":totalLosses": totalLosses
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserPotatoesAndLosses: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserPotatoesAndLosses error: ${JSON.stringify(err)}`)
        });
    return response;
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

const addPotatoesAllUsers = async function (passiveGain) {
    const allUsers = await getUsers();
    await allUsers.forEach(async user => {
        let userId = user.userId;
        let userPotatoes = user.potatoes + passiveGain;
        let userTotalEarnings = user.totalEarnings + passiveGain;
        await updateUserPotatoesAndEarnings(userId, userPotatoes, userTotalEarnings);
    });
    return;
}

const passivePotatoHandler = async function (timesInADay) {
    const allUsers = await getUsers();
    await allUsers.forEach(async user => {
        const passiveGain = Math.round(user.passiveAmount/timesInADay);
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

const updateUserWorkTimer = async function (userId) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set workTimer = :workTimer",
        ExpressionAttributeValues: {
            ":workTimer": Date.now(),
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

const updateUserWorkTimerAdditionalTime = async function (userId, extraMilliseconds) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set workTimer = :workTimer",
        ExpressionAttributeValues: {
            ":workTimer": Date.now()+extraMilliseconds,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserWorkTimerAdditionalTime: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserWorkTimerAdditionalTime error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateUserRobTimer = async function (userId, extraMilliseconds) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set robTimer = :robTimer",
        ExpressionAttributeValues: {
            ":robTimer": Date.now()+extraMilliseconds,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserRobTimer: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserRobTimer error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateUserLosses = async function (userId, totalLosses) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set totalLosses = :totalLosses",
        ExpressionAttributeValues: {
            ":totalLosses": totalLosses
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

const updateUserGuildId = async function (userId, guildId) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set guildId = :guildId",
        ExpressionAttributeValues: {
            ":guildId": guildId
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserGuildId: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserGuildId error: ${JSON.stringify(err)}`)
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
const getCoinflipStats = async function () {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        KeyConditionExpression: 'trackingId = :trackingId',
        ExpressionAttributeValues: { ':trackingId': statTrackingIds.COINFLIP }
    };

    const response = docClient.query(params).promise()
        .then(async function (data) {
            coinflip = data.Items[0]
            return coinflip;
        })
        .catch(function (err) {
            console.debug(`getCoinflipStats error: ${JSON.stringify(err)}`)
        });
    return response
}

const addCoinflipHeads = async function (headsCount) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: statTrackingIds.COINFLIP,
        },
        UpdateExpression: "set heads = :heads",
        ExpressionAttributeValues: {
            ":heads": headsCount+1
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`addCoinflipHeads: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`addCoinflipHeads error: ${JSON.stringify(err)}`)
        });
    return response;
}

const addCoinflipTails = async function (tailsCount) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: statTrackingIds.COINFLIP,
        },
        UpdateExpression: "set tails = :tails",
        ExpressionAttributeValues: {
            ":tails": tailsCount+1
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`addCoinflipTails: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`addCoinflipTails error: ${JSON.stringify(err)}`)
        });
    return response;
}

const addCoinflipTotalPayout = async function (totalPayout, bet) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: statTrackingIds.COINFLIP,
        },
        UpdateExpression: "set totalPayout = :totalPayout",
        ExpressionAttributeValues: {
            ":totalPayout": totalPayout+bet
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`addCoinflipHeads: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`addCoinflipHeads error: ${JSON.stringify(err)}`)
        });
    return response;
}

const addCoinflipTotalReceived = async function (totalReceived, bet) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: statTrackingIds.COINFLIP,
        },
        UpdateExpression: "set totalReceived = :totalReceived",
        ExpressionAttributeValues: {
            ":totalReceived": totalReceived-bet
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`addCoinflipHeads: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`addCoinflipHeads error: ${JSON.stringify(err)}`)
        });
    return response;
}

const getWorkStats = async function () {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        KeyConditionExpression: 'trackingId = :trackingId',
        ExpressionAttributeValues: { ':trackingId': statTrackingIds.WORK }
    };

    const response = docClient.query(params).promise()
        .then(async function (data) {
            work = data.Items[0]
            return work;
        })
        .catch(function (err) {
            console.debug(`getWorkStats error: ${JSON.stringify(err)}`)
        });
    return response
}

const addWorkCount = async function (workCount) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: statTrackingIds.WORK,
        },
        UpdateExpression: "set workCount = :workCount",
        ExpressionAttributeValues: {
            ":workCount": workCount+1
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`addWorkCount: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`addWorkCount error: ${JSON.stringify(err)}`)
        });
    return response;
}

const addWorkTotalPayout = async function (totalPayout, amount) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_stats_table_name,
        Key: {
            trackingId: statTrackingIds.WORK,
        },
        UpdateExpression: "set totalPayout = :totalPayout",
        ExpressionAttributeValues: {
            ":totalPayout": totalPayout+amount
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`addWorkTotalPayout: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`addWorkTotalPayout error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Shops
const getShop = async function (shopId) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_shop_table_name,
        KeyConditionExpression: 'shopId = :shopId',
        ExpressionAttributeValues: { ':shopId': shopId }
    };

    const response = docClient.query(params).promise()
        .then(async function (data) {
            shop = data.Items[0]
            return shop;
        })
        .catch(function (err) {
            console.debug(`getShop error: ${JSON.stringify(err)}`)
        });
    return response
}

const updateUserSweetPotatoBuffs = async function (userId, newSweetPotatoBuffs) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set sweetPotatoBuffs = :sweetPotatoBuffs",
        ExpressionAttributeValues: {
            ":sweetPotatoBuffs": newSweetPotatoBuffs,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserSweetPotatoBuffs: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserSweetPotatoBuffs error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateUserWorkMultiplier = async function (userId, newWorkMultiplierAmount) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set workMultiplierAmount = :workMultiplierAmount",
        ExpressionAttributeValues: {
            ":workMultiplierAmount": newWorkMultiplierAmount,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserWorkMultiplier: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserWorkMultiplier error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateUserPassiveIncome = async function (userId, newPassiveIncome) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set passiveAmount = :passiveAmount",
        ExpressionAttributeValues: {
            ":passiveAmount": newPassiveIncome,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserPassiveIncome: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserPassiveIncome error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateUserBankCapacity = async function (userId, newBankCapacity) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set bankCapacity = :bankCapacity",
        ExpressionAttributeValues: {
            ":bankCapacity": newBankCapacity,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserBankCapacity: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserBankCapacity error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateGuildBankCapacity = async function (guildId, newBankCapacity) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set bankCapacity = :bankCapacity",
        ExpressionAttributeValues: {
            ":bankCapacity": newBankCapacity,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateGuildBankCapacity: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildBankCapacity error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Banking
const updateUserAndBankStoredPotatoes = async function (userId, newPotatoes, newBankStored) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set potatoes = :potatoes, bankStored = :bankStored",
        ExpressionAttributeValues: {
            ":potatoes": newPotatoes,
            ":bankStored": newBankStored
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateUserAndBankStoredPotatoes: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateUserAndBankStoredPotatoes error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Guilds
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
        activeRaid: false,
        raidTimer: 0,
        inviteList: [],
        raidList: []
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

const updateGuildInviteList = async function (guildId, newGuildInviteList) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set inviteList = :inviteList",
        ExpressionAttributeValues: {
            ":inviteList": newGuildInviteList,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateGuildInviteList: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildInviteList error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateGuildMemberList = async function (guildId, newGuildMemberList) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set memberList = :memberList",
        ExpressionAttributeValues: {
            ":memberList": newGuildMemberList,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateGuildMemberList: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildMemberList error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateGuildBankStored = async function (guildId, newBankStored) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set bankStored = :bankStored",
        ExpressionAttributeValues: {
            ":bankStored": newBankStored,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateGuildBankStored: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildBankStored error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateGuildRaidList = async function (guildId, newRaidList) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set raidList = :raidList",
        ExpressionAttributeValues: {
            ":raidList": newRaidList,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateGuildRaidList: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildRaidList error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateGuildActiveRaidStatus = async function (guildId, activeRaid) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const guild = await findGuildById(guildId);
    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set activeRaid = :activeRaid",
        ExpressionAttributeValues: {
            ":activeRaid": activeRaid,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateGuildActiveRaidStatus: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildActiveRaidStatus error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateGuildRaidCount = async function (guildId) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const guild = await findGuildById(guildId);
    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set raidCount = :raidCount",
        ExpressionAttributeValues: {
            ":raidCount": guild.raidCount+1,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateGuildRaidCount: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildRaidCount error: ${JSON.stringify(err)}`)
        });
    return response;
}

const updateGuildTotalEarnings = async function (guildId, newTotalEarnings) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: awsConfigurations.aws_guilds_table_name,
        Key: {
            guildId: guildId,
        },
        UpdateExpression: "set totalEarnings = :totalEarnings",
        ExpressionAttributeValues: {
            ":totalEarnings": newTotalEarnings,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`updateGuildRaidCount: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`updateGuildRaidCount error: ${JSON.stringify(err)}`)
        });
    return response;
}

// Misc
const addNewUserAttribute = async function () {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    let userList = await getUsers();
    const newObject = {
        workMultiplierAmount: 0,
        passiveAmount: 0,
        bankCapacity: 0
    };

    userList.forEach(async user => {
        const params = {
            TableName: awsConfigurations.aws_table_name,
            Key: {
                userId: user.userId,
            },
            UpdateExpression: "set sweetPotatoBuffs = :sweetPotatoBuffs",
            ExpressionAttributeValues: {
                ":sweetPotatoBuffs": newObject,
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

const getSortedUsers = async function () {
    let allUsers = await getUsers();
    const sortedUsers = allUsers.sort((a, b) => parseFloat(b.potatoes+b.bankStored) - parseFloat(a.potatoes+a.bankStored));
    return sortedUsers
}

const getSortedGuildsByLevelAndMembers = async function () {
    let allGuilds = await getGuilds();
    const sortedGuilds = allGuilds.sort((a, b) => {
        // First, compare by level
        const levelComparison = parseFloat(b.level) - parseFloat(a.level);
        
        // If levels are the same, compare by memberCount
        return levelComparison != 0 ? levelComparison : b.memberList.length - a.memberList.length;
    });

    return sortedGuilds;
}

const getSortedGuildsById = async function () {
    let allGuilds = await getGuilds();
    const sortedUsers = allGuilds.sort((a, b) => parseFloat(b.guildId) - parseFloat(a.guildId));
    return sortedUsers
}

const addAdminUserPotatoes = async function (potatoes) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const adminUser = await findUser('1187560268172116029', "Leash Gromp")

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: "1187560268172116029",
        },
        UpdateExpression: "set potatoes = :potatoes",
        ExpressionAttributeValues: {
            ":potatoes": adminUser.potatoes + potatoes,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`addAdminUserPotatoes: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`addAdminUserPotatoes error: ${JSON.stringify(err)}`)
        });
    return response;
}

const addAdminUserBankedPotatoes = async function (potatoes) {
    AWS.config.update(awsConfigurations.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const adminUser = await findUser('1187560268172116029', "Leash Gromp")

    const params = {
        TableName: awsConfigurations.aws_table_name,
        Key: {
            userId: "1187560268172116029",
        },
        UpdateExpression: "set bankStored = :bankStored",
        ExpressionAttributeValues: {
            ":bankStored": adminUser.bankStored + potatoes,
        },
        ReturnValues: "ALL_NEW",
    };

    const response = await docClient.update(params).promise()
        .then(async function (data) {
            // console.debug(`addAdminUserBankedPotatoes: ${JSON.stringify(data)}`)
        })
        .catch(function (err) {
            console.debug(`addAdminUserBankedPotatoes error: ${JSON.stringify(err)}`)
        });
    return response;
}

module.exports = {
    addUser,
    findUser,
    updateUserPotatoes,
    updateUserPotatoesAndEarnings,
    updateUserPotatoesAndLosses,
    getUsers,
    addPotatoesAllUsers,
    passivePotatoHandler,
    updateUserWorkTimer,
    updateUserWorkTimerAdditionalTime,
    updateUserLosses,
    updateUserGuildId,
    updateUserRobTimer,

    addBirthday,
    getAllBirthdays,

    addBet,
    getMostRecentBet,
    getAllBets,
    addUserToBet,
    endCurrentBet,
    lockCurrentBet,

    getCoinflipStats,
    addCoinflipHeads,
    addCoinflipTails,
    addCoinflipTotalPayout,
    addCoinflipTotalReceived,
    getWorkStats,
    addWorkCount,
    addWorkTotalPayout,

    getShop,
    updateUserSweetPotatoBuffs,
    updateUserWorkMultiplier,
    updateUserPassiveIncome,
    updateUserBankCapacity,

    updateUserAndBankStoredPotatoes,

    findGuildById,
    findGuildByName,
    createGuild,
    updateGuildInviteList,
    updateGuildMemberList,
    updateGuildBankStored,
    updateGuildRaidList,
    updateGuildActiveRaidStatus,

    addNewUserAttribute,
    getServerTotal,
    getSortedUsers,
    getSortedGuildsByLevelAndMembers,
    getSortedGuildsById,
    addAdminUserPotatoes,
    addAdminUserBankedPotatoes,
}
