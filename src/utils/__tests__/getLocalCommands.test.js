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

    // Regression coverage for a live incident (2026-09-24): /admin's reset-tower subcommand's
    // new full-wipe option had a 121-character description — Discord's real cap is 100 —
    // which made applicationCommands.create/edit throw DiscordAPIError[50035]
    // ("options[1].options[1].description[BASE_TYPE_BAD_LENGTH]") for the WHOLE /admin
    // command at startup (01registerCommands.js's per-command try/catch limited the blast
    // radius to just this one command, but every /admin subcommand — give, stats, the works —
    // was unusable until fixed, since Discord rejects the entire command definition on one
    // bad field, not just the offending option). Recurses into every option (including nested
    // Subcommand/SubcommandGroup options, exactly the shape that broke here — the bad
    // description was two levels deep) so a future command definition mistake fails this test
    // immediately instead of surfacing as a startup registration error.
    test('every command name/description, including nested subcommand options, stays within Discord\'s length limits', () => {
        // Discord's real API limits (application command NAME_MAX_LENGTH / DESCRIPTION_MAX_LENGTH).
        const NAME_MAX = 32;
        const DESCRIPTION_MAX = 100;

        const violations = [];
        function checkNode(node, path) {
            if (typeof node.name === 'string' && (node.name.length < 1 || node.name.length > NAME_MAX)) {
                violations.push(`${path} name (${node.name.length} chars): "${node.name}"`);
            }
            if (typeof node.description === 'string' && (node.description.length < 1 || node.description.length > DESCRIPTION_MAX)) {
                violations.push(`${path} description (${node.description.length} chars): "${node.description}"`);
            }
            for (const option of node.options || []) {
                checkNode(option, `${path} > ${option.name || '(unnamed option)'}`);
            }
        }

        const localCommands = getLocalCommands();
        for (const command of localCommands) {
            checkNode(command, command.name);
        }

        expect(violations).toEqual([]);
    });
});
