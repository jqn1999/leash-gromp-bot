// Companion "Work Count" -> "XP" Rename, Part 2 (2026-08-31) — /work's own structural
// exception. Its companion-leveling write happens AFTER the result embed is already sent,
// so the real grant amount isn't known at embed-build time the way it is for the other 5
// commands. Mirrors this file's own existing _cooldownSkippedByCompanion pattern: a
// non-persisted, in-memory-only flag (`_companionXpGained`) stamped onto userDetails once
// near the top of performWork, read at each embed call site. Exercised end-to-end through
// the REAL performWork/embedFactory (only dynamoHandler + WorkFactory + achievement/quest
// factories are mocked), so this locks in the actual wiring, not just the embed's own
// conditional logic (already covered directly in embedFactory.test.js).
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/achievementFactory');
jest.mock('../../../utils/questFactory');
jest.mock('../../../utils/workFactory', () => {
    const actual = jest.requireActual('../../../utils/workFactory');
    return {
        ...actual,
        WorkFactory: jest.fn().mockImplementation(() => ({
            handleRegularWork: jest.fn().mockResolvedValue(500),
        })),
    };
});

const dynamoHandler = require('../../../utils/dynamoHandler');
const { AchievementFactory } = require('../../../utils/achievementFactory');
const { QuestFactory } = require('../../../utils/questFactory');

const workModule = require('../work');

// work.js instantiates these once at module-load time (singletons) — captured here, right
// after the require above (so construction has already happened) and before any
// beforeEach's jest.clearAllMocks() wipes the *.mock.instances record of that construction
// (the instances/methods themselves stay alive and usable).
const achievementFactoryInstance = AchievementFactory.mock.instances[0];
const questFactoryInstance = QuestFactory.mock.instances[0];

function companionsWith(id, instanceId, workCount = 41, name) {
    return { owned: [{ instanceId, id, workCount }], active: instanceId, ownedCount: 1, mythicOwnedCount: 1 };
}
const NOTHING_EQUIPPED = { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 };

function baseUser(companions) {
    return {
        userId: 'user-1',
        username: 'User',
        workTimer: 0,
        companions,
        workScenarioCounts: { metalFailure: 0 },
    };
}

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        followUp: jest.fn().mockResolvedValue(),
        options: { get: () => undefined },
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getStatDatabase.mockResolvedValue({ workCount: 41, totalPayout: 0 });
    dynamoHandler.getCachedServerTotal.mockResolvedValue(1_000_000);
    dynamoHandler.getCatchUpBonus.mockResolvedValue(0);
    dynamoHandler.updateStatDatabase.mockResolvedValue();
    dynamoHandler.updateIfNewRecord.mockResolvedValue();
    dynamoHandler.updateUserFields.mockResolvedValue();
    achievementFactoryInstance.checkAndUnlock.mockResolvedValue([]);
    questFactoryInstance.checkAndClaimQuests.mockResolvedValue({ completedQuests: [] });
    // Forces the roll into the REGULAR (last, chance: 1) scenario every time.
    jest.spyOn(Math, 'random').mockReturnValue(0.999999);
});

afterEach(() => {
    Math.random.mockRestore();
});

async function runWork(companions) {
    const user = baseUser(companions);
    dynamoHandler.findUser.mockImplementation(async () => user);
    const interaction = fakeInteraction();
    await workModule.callback({}, interaction);
    return interaction;
}

describe('/work result embed folds companion XP into the existing "Work Count:" field', () => {
    test('a companion equipped shows "N (+1 XP: Name)" in the Work Count field', async () => {
        const interaction = await runWork(companionsWith('sprout', 'sprout-a', 41));
        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        const field = embed.data.fields.find(f => f.name === 'Work Count:');
        expect(field.value).toBe('42 (+1 XP: Sprout)');
    });

    test('nothing equipped shows the plain count with no XP suffix', async () => {
        const interaction = await runWork(NOTHING_EQUIPPED);
        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        const field = embed.data.fields.find(f => f.name === 'Work Count:');
        expect(field.value).toBe('42');
    });

    test('never adds a second, standalone "Companion XP" field on /work\'s own embed, even with a companion equipped', async () => {
        const interaction = await runWork(companionsWith('sprout', 'sprout-a', 41));
        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        expect(embed.data.fields.find(f => f.name.includes('Companion XP'))).toBeUndefined();
    });
});
