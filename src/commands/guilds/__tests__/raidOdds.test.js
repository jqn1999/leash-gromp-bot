// Regression coverage for /raid-odds — a read-only preview of every unlocked raid
// mode's tier odds/success chance/rewards, added 2026-09-12 (direct instruction: "give a
// way for guilds to see the raid probabilities of each tier without having to wait for
// raid cd to be done", then "it can be similar to the bounty board mercs have which has
// a single embed with all the odds/rewards/etc"). The one property every test here
// ultimately protects: this command must NEVER reject on cooldown, unlike /start-raid's
// own preview — that's the entire reason it exists as a separate command.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Raid, RaidLevel } = require('../../../utils/constants');
const { callback } = require('../raidOdds');

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        memberList: [
            { id: 'leader', username: 'Leader', role: 'Leader' },
            { id: 'm2', username: 'Member2', role: 'Member' },
        ],
        raidCount: 0,
        // Far in the future — on cooldown by default, since that's the exact scenario
        // this command needs to keep working under.
        raidTimer: Date.now() + 10 * 60 * 1000,
        guildBuff: 'workMulti',
        raidSplitMode: 'even',
        ...overrides,
    };
}

function userFixture(id, workMultiplierAmount) {
    return {
        userId: id,
        username: id,
        guildId: 7,
        workMultiplierAmount,
        rebirthCount: 0,
        autoJoinRaids: true,
    };
}

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'leader', username: 'Leader', displayName: 'Leader' },
        options: { get: () => undefined },
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    const leader = userFixture('leader', 100);
    const m2 = userFixture('m2', 50);
    dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? leader : id === 'm2' ? m2 : undefined));
});

describe('/raid-odds', () => {
    test('shows odds even while the guild raid is on cooldown — the whole point of this command', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledTimes(1);
        const call = interaction.editReply.mock.calls[0][0];
        expect(call.embeds).toBeDefined();
        // Never a plain-string cooldown rejection like /start-raid's own would send.
        expect(typeof call).not.toBe('string');
        const embed = call.embeds[0];
        const cooldownField = embed.data.fields.find(f => f.name.includes('Cooldown'));
        expect(cooldownField.value).toMatch(/Ready in/);
        expect(cooldownField.value).toMatch(/preview only, nothing has been rolled/);
    });

    test('shows "Ready now" cooldown text once the timer has actually elapsed', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidTimer: Date.now() - 1000 }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        const cooldownField = embed.data.fields.find(f => f.name.includes('Cooldown'));
        expect(cooldownField.value).toMatch(/Ready now/);
    });

    test('a guild with no members in the raid list gets a rejection message, not an embed', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ memberList: [] }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no members in the raid list'));
    });

    test('a user with no guild gets a rejection message, not an embed', async () => {
        dynamoHandler.findGuildById.mockResolvedValue(undefined);
        dynamoHandler.findUser.mockImplementation(async (id) => (id === 'leader' ? { ...userFixture('leader', 100), guildId: null } : undefined));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('no guild'));
    });

    test('Elite/Legendary sections only appear once the guild has actually unlocked them', async () => {
        // Level 1 (raidCount 0): neither Elite (needs Raid.ELITE_MIN_GUILD_LEVEL, 7) nor
        // Legendary (needs Raid.LEGENDARY_MIN_GUILD_LEVEL, 9) should appear.
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidCount: 0 }));
        const belowInteraction = fakeInteraction();
        await callback({}, belowInteraction);
        const belowFields = belowInteraction.editReply.mock.calls[0][0].embeds[0].data.fields;
        expect(belowFields.some(f => f.name.includes('Elite'))).toBe(false);
        expect(belowFields.some(f => f.name.includes('Legendary'))).toBe(false);
        expect(belowFields.some(f => f.name.includes('Regular'))).toBe(true);
        expect(belowFields.some(f => f.name.includes('Baby'))).toBe(true);
        expect(belowFields.some(f => f.name.includes('Stat'))).toBe(true);

        // Legendary's own unlock level (9) — both Elite and Legendary should now appear.
        const legendaryMinWins = RaidLevel.THRESHOLDS.find(t => t.level === Raid.LEGENDARY_MIN_GUILD_LEVEL).winsRequired;
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidCount: legendaryMinWins }));
        const atInteraction = fakeInteraction();
        await callback({}, atInteraction);
        const atFields = atInteraction.editReply.mock.calls[0][0].embeds[0].data.fields;
        expect(atFields.some(f => f.name.includes('Elite'))).toBe(true);
        expect(atFields.some(f => f.name.includes('Legendary'))).toBe(true);
    });

    test('per-bracket lines include odds, success chance, and both reward/penalty text', async () => {
        const legendaryMinWins = RaidLevel.THRESHOLDS.find(t => t.level === Raid.LEGENDARY_MIN_GUILD_LEVEL).winsRequired;
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidCount: legendaryMinWins }));
        const interaction = fakeInteraction();

        await callback({}, interaction);

        const fields = interaction.editReply.mock.calls[0][0].embeds[0].data.fields;
        const regularField = fields.find(f => f.name.includes('Regular'));
        expect(regularField.value).toMatch(/% odds/);
        expect(regularField.value).toMatch(/% success/);
        expect(regularField.value).toMatch(/✅/);
        expect(regularField.value).toMatch(/❌/);
    });
});
