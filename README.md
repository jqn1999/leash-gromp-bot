# Leash Gromp Discord Bot

## Table of Contents

 - Introduction
 - Developer Setup Guide
 - FAQ
 - Development Team

## Introduction
A Discord bot that allows users engage in strategic gameplay to accumulate virtual potatoes, subsequently utilizing these resources to unlock and apply various upgrades. Beyond its playful premise, the project was made to gain practical experience with developing a **Node.js** application and gain familiarity with AWS services such as **Amazon DynamoDB** and **Amazon EC2**. The management side of the project made use of Github to allow for easy collaboration with other developers as needed and Jira for managing bodies of work required for the bot to continue to improve.

## Developer Setup Guide
### This project requires the following to be installed:

- [Node.js and NPM (I personally am on v16.16 and v9.1.3 but they should be backwards compatible)](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)
- After installing the above, go to the root of the project and run `npm i` which will install the required dependencies for the project

### Next, you need a .env file to place your credentials for accessing AWS and the bot:
- Create a .env file at the root of your project with the below schema
- Ask another developer on the team, who is already setup, to provide you the required keys and token below for your .env file

```
AWS_ACCESS_KEY_ID = <ACCESS_KEY>
AWS_SECRET_ACCESS_KEY_ID = <SECRET_ACCESS_KEY>
AWS_REGION = us-east-1
BOT_TOKEN = <BOT_TOKEN>
```
**Note:** The given keys will be to a **Non-Prod** bot connecting to a **Non-Prod** environment of **AWS DynamoDB** to allow for development without impacting any users. The **Prod** keys for the actual Leash Gromp bot are only kept in the EC2 instance that runs the live bot 24/7.

### Finally, Get Invitations to Jira, Github, and Discord:
- Ask for an invite to the Jira project and [Github project](https://github.com/jqn1999/leash-gromp-bot)
- In order to avoid bot commands being intercepted by each other, developers may want to [create their own personal Discord bots](https://discordjs.guide/preparations/setting-up-a-bot-application.html#creating-your-bot) and provide their particular token in the `.env` file mentioned in the previous section.

## How To Run Locally
- In order to run the project locally all you need to do is run `node src/index.js` at the root of the project
- If you want the bot to reload after every code change just install `nodemon` and run `nodemon src/index.js`

## FAQ

**Q: Why is this section empty?**

**A:** This is currently just a placeholder section until I find any pain points with people trying to setup and contribute to this project

## Development Team
- Joshua Nguyen - [Developer](https://www.linkedin.com/in/joshua-nguyen-cs/)
- Matt Li - [Developer](https://github.com/officialmattli)