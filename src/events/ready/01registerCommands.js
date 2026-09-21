const { awsConfigurations } = require("../../utils/constants");
const areCommandsDifferent = require('../../utils/areCommandsDifferent');
const getApplicationCommands = require('../../utils/getApplicationCommands');
const getLocalCommands = require('../../utils/getLocalCommands');

module.exports =  (client) => {
    try {
        const localCommands = getLocalCommands();
        const allGuilds = client.guilds.cache.map(guild => guild.id);
        // const allGuilds = [awsConfigurations.testServer];
        allGuilds.forEach(async function (guild) {
            const applicationCommands = await getApplicationCommands(
                client,
                guild
            );
            for (const localCommand of localCommands) {
                const { name, description, options } = localCommand;

                // Each command's own create/edit/delete is wrapped independently — this loop
                // used to have no per-command guard, so ONE bad command (a bad description, a
                // transient Discord API hiccup, or hitting the command-count cap) threw an
                // unhandled rejection that skipped every command still left in this `for` loop,
                // not just the failing one. Since this whole function runs as the body of an
                // async callback passed to `allGuilds.forEach` (never awaited by anything), that
                // rejection wasn't even caught by this file's own outer try/catch below — it was
                // a fully unhandled rejection. Catching per-command here means one failure is
                // logged and skipped, and every command after it in the list still gets its own
                // create/edit/delete attempt.
                try {
                    const existingCommand = await applicationCommands.cache.find(
                        (cmd) => cmd.name === name
                    );

                    if (existingCommand) {
                        if (localCommand.deleted) {
                            await applicationCommands.delete(existingCommand.id);
                            console.log(`Deleted command "${name}".`);
                            continue;
                        }

                        if (areCommandsDifferent(existingCommand, localCommand)) {
                            await applicationCommands.edit(existingCommand.id, {
                                description,
                                options,
                            });

                            console.log(`Edited command "${name}".`);
                        }
                    } else {
                        if (localCommand.deleted) {
                            console.log(
                                `Skipping registering command "${name}" as it's set to delete.`
                            );
                            continue;
                        }

                        await applicationCommands.create({
                            name,
                            description,
                            options,
                        });

                        console.log(`Registered command "${name}."`);
                    }
                } catch (commandError) {
                    console.log(`There was an error registering command "${name}": ${commandError}`);
                    continue;
                }
            }
        });
    } catch (error) {
        console.log(`There was an error: ${error}`);
    }
};