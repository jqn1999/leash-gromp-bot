module.exports = (existingCommand, localCommand) => {
    const areChoicesDifferent = (existingChoices, localChoices) => {
        for (const localChoice of localChoices) {
            const existingChoice = existingChoices?.find(
                (choice) => choice.name === localChoice.name
            );

            if (!existingChoice) {
                return true;
            }

            if (localChoice.value !== existingChoice.value) {
                return true;
            }
        }
        return false;
    };

    const areOptionsDifferent = (existingOptions, localOptions) => {
        for (const localOption of localOptions) {
            const existingOption = existingOptions?.find(
                (option) => option.name === localOption.name
            );

            if (!existingOption) {
                return true;
            }

            if (
                localOption.description !== existingOption.description ||
                localOption.type !== existingOption.type ||
                (localOption.required || false) !== existingOption.required ||
                // Discord never sends an autocomplete interaction for an option unless
                // the LIVE registered command has autocomplete: true on it — the bot's
                // own local command definition having it isn't enough. Without this
                // check, adding (or removing) autocomplete on an option that already
                // exists on Discord was silently invisible to areCommandsDifferent, so
                // 01registerCommands.js's sync-on-startup never called
                // applicationCommands.edit(...) to push the change, and the option
                // stayed a plain text field on Discord's side indefinitely.
                (localOption.autocomplete || false) !== (existingOption.autocomplete || false) ||
                (localOption.choices?.length || 0) !==
                (existingOption.choices?.length || 0) ||
                areChoicesDifferent(
                    localOption.choices || [],
                    existingOption.choices || []
                )
            ) {
                return true;
            }
        }
        return false;
    };

    if (
        existingCommand.description !== localCommand.description ||
        existingCommand.options?.length !== (localCommand.options?.length || 0) ||
        areOptionsDifferent(existingCommand.options, localCommand.options || [])
    ) {
        return true;
    }

    return false;
};