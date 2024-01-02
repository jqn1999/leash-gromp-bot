require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const commands = [
    // {
    //     name: 'profile',
    //     description: 'Sends an embed of a user\'s profile'
    // },
    // {
    //     name: 'cf',
    //     description: 'Coinflip',
    //     options: [
    //         {
    //             name: 'bet-amount',
    //             description: 'Amount to bet',
    //             type: ApplicationCommandOptionType.Number,
    //             required: true
    //         }
    //     ],
        
    // },
    // {
    //     name: 'find-user',
    //     description: 'Finds user in DynamoDB',
    //     options: [
    //         {
    //             name: 'user-id',
    //             description: 'User to find',
    //             type: ApplicationCommandOptionType.String,
    //             required: true
    //         }
    //     ]
    // }
];

const rest = new REST({ version: '10'}).setToken(process.env.BOT_TOKEN);

(async () => {
    console.log('Registering commands');
    try {
        const serverList = ['334579085667860481', '168379467931058176', '533073599435636736']
        serverList.forEach(async server => {
            // await rest.put(
            //     Routes.applicationGuildCommands(process.env.CLIENT_ID),
            //     { body: [] }
            // );
            rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: [] })
                .then(() => console.log('Successfully deleted all application commands.'))
                .catch(console.error);
            console.log('done registering for server ' + server);
        })
    } catch (e) {
        console.log(`There was an error ${e}`);
    }
})();