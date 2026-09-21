const { awsConfigurations } = require("../../utils/constants");
const areCommandsDifferent = require('../../utils/areCommandsDifferent');
const getApplicationCommands = require('../../utils/getApplicationCommands');
const getLocalCommands = require('../../utils/getLocalCommands');

module.exports =  (client) => {
    try {
        const localCommands = getLocalCommands();
        const allGuilds = client.guilds.cache.map(guild => guild.id);
        // const allGuilds = [awsConfigurations.testServer];
        const localCommandNames = new Set(localCommands.map((c) => c.name));
        allGuilds.forEach(async function (guild) {
            const applicationCommands = await getApplicationCommands(
                client,
                guild
            );

            // Orphan cleanup — a command genuinely registered on Discord with NO matching
            // local command file at all (not even a `deleted: true` stub), left behind by a
            // consolidation pass that deleted the old file outright instead of keeping it
            // around just to mark it deleted (root cause of the cap being hit again after the
            // 2026-09-20 fix: getLocalCommands()'s own non-deleted count looked comfortably
            // under 100, but Discord's ACTUAL registered count for the guild never dropped,
            // since nothing here had ever looked at Discord's own command list to find and
            // remove a name with no local file left to represent it — the loop below only ever
            // walks `localCommands`, so it's structurally blind to this case). Runs before the
            // create/edit loop so freed slots are available to it in the same pass, not the
            // next bot restart.
            for (const [commandId, existingCommand] of applicationCommands.cache) {
                if (!localCommandNames.has(existingCommand.name)) {
                    try {
                        await applicationCommands.delete(commandId);
                        console.log(`Deleted orphaned command "${existingCommand.name}" (no matching local command file).`);
                    } catch (orphanError) {
                        console.log(`There was an error deleting orphaned command "${existingCommand.name}": ${orphanError}`);
                    }
                }
            }

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