const AWS = require('aws-sdk');
const config = require('../config.js');

// User Handling
const findUser = async function (userId, username) {
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: config.aws_table_name,
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
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const Item = {
        userId: userId,
        username: username,
        potatoes: 5000,
        totalEarnings: 0,
        totalLosses: 0
    };
    var params = {
        TableName: config.aws_table_name,
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

const updateUserPotatoes = async function (userId, potatoes, totalEarnings, totalLosses) {
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: config.aws_table_name,
        Key: {
            userId: userId,
        },
        UpdateExpression: "set potatoes = :potatoes, totalEarnings = :totalEarnings, totalLosses = :totalLosses",
        ExpressionAttributeValues: {
            ":potatoes": potatoes,
            ":totalEarnings": totalEarnings,
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

const getUsers = async function () {
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: config.aws_table_name
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
        let userPotatoes = user.potatoes += passiveGain;
        let userTotalEarnings = user.totalEarnings;
        let userTotalLosses = user.totalLosses;
        await updateUserPotatoes(userId, userPotatoes, userTotalEarnings, userTotalLosses);
    });
    return;
}

const updateUserWorkTimer = async function (userId) {
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: config.aws_table_name,
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

// Birthday Handling
const addBirthday = async function (userId, username, birthday) {
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const Item = {
        userId: userId,
        username: username,
        birthday: birthday
    };
    var params = {
        TableName: config.aws_birthday_table_name,
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
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: config.aws_birthday_table_name
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
const addBet = async function (betId, optionOne, optionTwo, description, thumbnailUrl) {
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const Item = {
        betId: betId,
        description: description,
        thumbnailUrl: thumbnailUrl,
        isLocked: false,
        isActive: true,
        optionOne: optionOne,
        optionOneVoters: [],
        optionOneTotal: 0,
        optionTwo: optionTwo,
        optionTwoVoters: [],
        optionTwoTotal: 0,
        winningOption: ""
    };

    var params = {
        TableName: config.aws_betting_table_name,
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
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: config.aws_betting_table_name
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

const addUserToBet = async function (betId, userId, bet, choice) {
    AWS.config.update(config.aws_remote_config);
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
                bet: bet
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
                bet: bet
            });
        }
        newList = mostRecentBet.optionTwoVoters;
        newTotal = mostRecentBet.optionTwoTotal += bet;
        optionName = 'optionTwo'
    };
    const params = {
        TableName: config.aws_betting_table_name,
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
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: config.aws_betting_table_name,
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
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    const params = {
        TableName: config.aws_betting_table_name,
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

// Misc
const addNewUserAttribute = async function () {
    AWS.config.update(config.aws_remote_config);
    const docClient = new AWS.DynamoDB.DocumentClient();

    let userList = await getUsers();

    userList.forEach(async user => {
        const params = {
            TableName: config.aws_table_name,
            Key: {
                userId: user.userId,
            },
            UpdateExpression: "set workTimer = :workTimer",
            ExpressionAttributeValues: {
                ":workTimer": 0,
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

module.exports = {
    addUser,
    findUser,
    updateUserPotatoes,
    getUsers,
    addPotatoesAllUsers,
    updateUserWorkTimer,

    addBirthday,
    getAllBirthdays,

    addBet,
    getMostRecentBet,
    getAllBets,
    addUserToBet,
    endCurrentBet,
    lockCurrentBet,

    addNewUserAttribute,
}
