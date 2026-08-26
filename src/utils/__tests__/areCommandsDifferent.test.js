const areCommandsDifferent = require('../areCommandsDifferent');

function existingCommand(overrides = {}) {
    return {
        description: 'desc',
        options: [{ name: 'guild-name', description: 'x', type: 3, required: true }],
        ...overrides,
    };
}

function localCommand(overrides = {}) {
    return {
        description: 'desc',
        options: [{ name: 'guild-name', description: 'x', type: 3, required: true }],
        ...overrides,
    };
}

describe('areCommandsDifferent', () => {
    test('identical commands are not different', () => {
        expect(areCommandsDifferent(existingCommand(), localCommand())).toBe(false);
    });

    test('a changed description is different', () => {
        expect(areCommandsDifferent(existingCommand({ description: 'old' }), localCommand({ description: 'new' }))).toBe(true);
    });

    // Regression coverage for a real bug: Discord only ever sends an autocomplete
    // interaction for an option if the LIVE registered command has autocomplete: true on
    // it — the bot's own local command definition having it isn't enough. Without this
    // check, adding (or removing) autocomplete on an option that already exists on
    // Discord was invisible to this diff, so 01registerCommands.js's sync-on-startup
    // never pushed the change and the option stayed a plain text field indefinitely.
    test('adding autocomplete to an existing option IS a difference', () => {
        const existing = existingCommand({ options: [{ name: 'guild-name', description: 'x', type: 3, required: true, autocomplete: false }] });
        const local = localCommand({ options: [{ name: 'guild-name', description: 'x', type: 3, required: true, autocomplete: true }] });
        expect(areCommandsDifferent(existing, local)).toBe(true);
    });

    test('removing autocomplete from an existing option IS a difference', () => {
        const existing = existingCommand({ options: [{ name: 'guild-name', description: 'x', type: 3, required: true, autocomplete: true }] });
        const local = localCommand({ options: [{ name: 'guild-name', description: 'x', type: 3, required: true, autocomplete: false }] });
        expect(areCommandsDifferent(existing, local)).toBe(true);
    });

    test('an option with autocomplete unset on both sides is not a false positive', () => {
        const existing = existingCommand({ options: [{ name: 'guild-name', description: 'x', type: 3, required: true }] });
        const local = localCommand({ options: [{ name: 'guild-name', description: 'x', type: 3, required: true, autocomplete: false }] });
        expect(areCommandsDifferent(existing, local)).toBe(false);
    });

    test('a changed required flag is different', () => {
        const existing = existingCommand({ options: [{ name: 'guild-name', description: 'x', type: 3, required: false }] });
        const local = localCommand({ options: [{ name: 'guild-name', description: 'x', type: 3, required: true }] });
        expect(areCommandsDifferent(existing, local)).toBe(true);
    });

    test('an added option is different', () => {
        const existing = existingCommand({ options: [] });
        const local = localCommand();
        expect(areCommandsDifferent(existing, local)).toBe(true);
    });

    test('a changed choice value is different', () => {
        const existing = existingCommand({ options: [{ name: 'tier', description: 'x', type: 3, required: true, choices: [{ name: 'I', value: 'I' }] }] });
        const local = localCommand({ options: [{ name: 'tier', description: 'x', type: 3, required: true, choices: [{ name: 'I', value: 'II' }] }] });
        expect(areCommandsDifferent(existing, local)).toBe(true);
    });
});
