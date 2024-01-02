const { ApplicationCommandOptionType } = require("discord.js");
const dynamoHandler = require("../../utils/dynamoHandler");

const monthsAndDays = {
    "01": 31,
    "02": 29,
    "03": 31,
    "04": 30,
    "05": 31,
    "06": 30,
    "07": 31,
    "08": 31,
    "09": 30,
    "10": 31,
    "11": 30,
    "12": 31,
}

function validateDate(month, day) {
    try {
        console.log(`${month} ${day}`)
        if (Number(day) <= monthsAndDays[month]  && Number(day) > 0) {
            return true
        }
        return false
    } catch (err) {
        console.log(`convertAndValidateNumbers error: ${err} Month: ${month} Day: ${day}`)
        return false
    }

}

module.exports = {
    name: "add-birthday",
    description: "Adds a birthday",
    // devOnly: false,
    // testOnly: false,
    options: [
        {
            name: 'birthday-person',
            description: 'Person this birthday is for',
            required: true,
            type: ApplicationCommandOptionType.Mentionable,
        },
        {
            name: 'month',
            description: 'Birthday month',
            required: true,
            type: ApplicationCommandOptionType.String,
            choices: [
                {
                    name: 'January',
                    value: '01'
                },
                {
                    name: 'February',
                    value: '02'
                },
                {
                    name: 'March',
                    value: '03'
                },
                {
                    name: 'April',
                    value: '04'
                },
                {
                    name: 'May',
                    value: '05'
                },
                {
                    name: 'June',
                    value: '06'
                },
                {
                    name: 'July',
                    value: '07'
                },
                {
                    name: 'August',
                    value: '08'
                },
                {
                    name: 'September',
                    value: '09'
                },
                {
                    name: 'October',
                    value: '10'
                },
                {
                    name: 'November',
                    value: '11'
                },
                {
                    name: 'December',
                    value: '12'
                }
            ]
        },
        {
            name: 'day',
            description: '1 - 31',
            required: true,
            type: ApplicationCommandOptionType.String
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const birthdayPerson = interaction.options.get('birthday-person').value;
        const birthdayMonth = interaction.options.get('month').value;
        let birthdayDay = interaction.options.get('day').value;

        if (birthdayDay.length == 1) {
            birthdayDay = `0${birthdayDay}`;
        }

        if (!validateDate(birthdayMonth, birthdayDay)) {
            await interaction.editReply("Date was invalid or unable to be processed")
            return;
        }

        const targetUser = await interaction.guild.members.fetch(birthdayPerson);
        if (!targetUser) {
            await interaction.editReply("That user doesn't exist in this server.");
            return;
        }
        const birthdayDate = `${birthdayMonth}-${birthdayDay}`
        await dynamoHandler.addBirthday(targetUser.user.id, targetUser.user.username, birthdayDate);
        interaction.editReply(`Birthday (${birthdayDate}) for ${targetUser.user.username} was added to the database!`)
    }
}