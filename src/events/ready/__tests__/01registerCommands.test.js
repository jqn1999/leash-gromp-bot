// Discord's 100-command-per-guild cap (systems' own roadmap.md "Discord 100-command cap hit
// on startup" entries) recurred after the 2026-09-20 fix because that fix only ever addressed
// getLocalCommands()'s own non-deleted file count — it never taught this script to notice a
// command still registered on DISCORD with no local file left representing it at all (the
// consolidation passes deleted old command files outright rather than keeping them around
// just to mark `deleted: true`). This suite covers the orphan-cleanup pass added to close
// that gap: a command genuinely registered on Discord with zero matching local file (active
// or `deleted: true`) gets deleted before the create/edit loop runs, freeing its slot in the
// same pass rather than leaving it stuck until a human notices.
jest.mock('../../../utils/getLocalCommands');
jest.mock('../../../utils/getApplicationCommands');
jest.mock('../../../utils/areCommandsDifferent');

const getLocalCommands = require('../../../utils/getLocalCommands');
const getApplicationCommands = require('../../../utils/getApplicationCommands');
const areCommandsDifferent = require('../../../utils/areCommandsDifferent');
const registerCommands = require('../01registerCommands');

// registerCommands' own guild loop is `allGuilds.forEach(async ...)`, never awaited by the
// exported function itself (a pre-existing, deliberately-unchanged shape — see this file's
// own header comment) — a real Discord API round trip would never resolve mid-microtask, but
// every mock here resolves immediately, so draining the microtask queue once via setImmediate
// is enough for the whole per-guild body (however many sequential awaits it chains) to finish
// before assertions run.
function flush() {
    return new Promise((resolve) => setImmediate(resolve));
}

function fakeApplicationCommands(existingEntries) {
    const cache = new Map(existingEntries.map((cmd) => [cmd.id, cmd]));
    cache.find = (predicate) => [...cache.values()].find(predicate);
    return {
        cache,
        delete: jest.fn().mockResolvedValue({}),
        edit: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
    };
}

function fakeClient(guildIds) {
    // Real code does `client.guilds.cache.map(guild => guild.id)` — feed the mapper actual
    // `{ id }` objects so that extraction behaves the same way here, not a raw id string.
    return {
        guilds: { cache: { map: (fn) => guildIds.map((id) => fn({ id })) } },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    areCommandsDifferent.mockReturnValue(false);
});

describe('01registerCommands — orphan cleanup', () => {
    test('deletes a Discord-registered command with no matching local file at all', async () => {
        getLocalCommands.mockReturnValue([
            { name: 'work', description: 'd', options: [] },
        ]);
        const applicationCommands = fakeApplicationCommands([
            { id: 'id-work', name: 'work' },
            { id: 'id-old-admin-give', name: 'admin-give' }, // file deleted outright during consolidation
        ]);
        getApplicationCommands.mockResolvedValue(applicationCommands);

        registerCommands(fakeClient(['guild-1']));
        await flush();

        expect(applicationCommands.delete).toHaveBeenCalledWith('id-old-admin-give');
        expect(applicationCommands.delete).not.toHaveBeenCalledWith('id-work');
    });

    test('does not touch a command that still has a matching local file, even an unchanged one', async () => {
        getLocalCommands.mockReturnValue([
            { name: 'work', description: 'd', options: [] },
        ]);
        const applicationCommands = fakeApplicationCommands([
            { id: 'id-work', name: 'work' },
        ]);
        getApplicationCommands.mockResolvedValue(applicationCommands);

        registerCommands(fakeClient(['guild-1']));
        await flush();

        expect(applicationCommands.delete).not.toHaveBeenCalled();
    });

    test('a command explicitly marked deleted:true locally is removed by the existing per-command branch, not double-deleted by orphan cleanup', async () => {
        getLocalCommands.mockReturnValue([
            { name: 'work', description: 'd', options: [] },
            { name: 'old-command', description: 'd', options: [], deleted: true },
        ]);
        const applicationCommands = fakeApplicationCommands([
            { id: 'id-work', name: 'work' },
            { id: 'id-old-command', name: 'old-command' },
        ]);
        getApplicationCommands.mockResolvedValue(applicationCommands);

        registerCommands(fakeClient(['guild-1']));
        await flush();

        expect(applicationCommands.delete).toHaveBeenCalledTimes(1);
        expect(applicationCommands.delete).toHaveBeenCalledWith('id-old-command');
    });

    test('freeing an orphaned slot happens before create attempts in the same pass, so a brand-new command can register without waiting for a second restart', async () => {
        getLocalCommands.mockReturnValue([
            { name: 'brand-new-command', description: 'd', options: [] },
        ]);
        const applicationCommands = fakeApplicationCommands([
            { id: 'id-old-admin-give', name: 'admin-give' },
        ]);
        getApplicationCommands.mockResolvedValue(applicationCommands);

        registerCommands(fakeClient(['guild-1']));
        await flush();

        expect(applicationCommands.delete).toHaveBeenCalledWith('id-old-admin-give');
        expect(applicationCommands.create).toHaveBeenCalledWith({ name: 'brand-new-command', description: 'd', options: [] });
    });

    test('a failure deleting one orphan is caught and logged, and does not block cleanup of others or the create/edit loop after it', async () => {
        getLocalCommands.mockReturnValue([
            { name: 'work', description: 'd', options: [] },
        ]);
        const applicationCommands = fakeApplicationCommands([
            { id: 'id-orphan-1', name: 'orphan-one' },
            { id: 'id-orphan-2', name: 'orphan-two' },
            { id: 'id-work', name: 'work' },
        ]);
        applicationCommands.delete.mockImplementation((id) => {
            if (id === 'id-orphan-1') return Promise.reject(new Error('Discord API hiccup'));
            return Promise.resolve({});
        });
        getApplicationCommands.mockResolvedValue(applicationCommands);
        const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        registerCommands(fakeClient(['guild-1']));
        await flush();

        expect(applicationCommands.delete).toHaveBeenCalledWith('id-orphan-1');
        expect(applicationCommands.delete).toHaveBeenCalledWith('id-orphan-2');
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('error deleting orphaned command "orphan-one"'));
        consoleSpy.mockRestore();
    });

    test('runs the cleanup independently per guild', async () => {
        getLocalCommands.mockReturnValue([
            { name: 'work', description: 'd', options: [] },
        ]);
        const guildOneCommands = fakeApplicationCommands([{ id: 'g1-orphan', name: 'orphan' }]);
        const guildTwoCommands = fakeApplicationCommands([{ id: 'g2-orphan', name: 'orphan' }]);
        getApplicationCommands.mockImplementation((client, guildId) =>
            Promise.resolve(guildId === 'guild-1' ? guildOneCommands : guildTwoCommands)
        );

        registerCommands(fakeClient(['guild-1', 'guild-2']));
        await flush();

        expect(guildOneCommands.delete).toHaveBeenCalledWith('g1-orphan');
        expect(guildTwoCommands.delete).toHaveBeenCalledWith('g2-orphan');
    });
});
