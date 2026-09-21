// Regression coverage for the 2026-09-20 incident: getLocalCommands() returning 101
// non-deleted commands hit Discord's hard 100-command-per-guild cap, which made
// applicationCommands.create throw DiscordAPIError[30032] on startup for any command
// registered after the 100th — see roadmap.md's dated entry and 01registerCommands.js's own
// per-command try/catch fix (which limits the blast radius of a future cap hit, but doesn't
// prevent one). This test is the actual guard against the cap being silently hit again: it
// requires every real command file (not a mock), exactly like 01registerCommands.js does at
// startup, so a newly added command file pushing the count back to 100 fails CI immediately
// instead of surfacing as a production startup crash.
const getLocalCommands = require('../getLocalCommands');

describe('getLocalCommands', () => {
    test('the number of non-deleted commands stays under Discord\'s 100-per-guild cap', () => {
        const localCommands = getLocalCommands();
        const nonDeletedCount = localCommands.filter((cmd) => !cmd.deleted).length;

        expect(nonDeletedCount).toBeLessThan(100);
    });

    test('the 8 former standalone admin/moderation commands are consolidated under one /admin command', () => {
        const localCommands = getLocalCommands();
        const names = localCommands.map((cmd) => cmd.name);

        expect(names).toContain('admin');
        expect(names).not.toEqual(expect.arrayContaining([
            'admin-give', 'admin-reset-tower', 'admin-stats', 'admin-trigger-event',
            'admin-work', 'admin-world-boss', 'set-activity-channel', 'set-merc-chat-channel',
        ]));

        const admin = localCommands.find((cmd) => cmd.name === 'admin');
        const subcommandNames = (admin.options || []).map((opt) => opt.name);
        expect(subcommandNames).toEqual(expect.arrayContaining([
            'give', 'reset-tower', 'stats', 'trigger-event', 'work',
            'trigger-world-boss', 'set-activity-channel', 'set-merc-chat-channel',
        ]));
    });
});
