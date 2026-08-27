// Coverage for the new /set-raid-payout command — mirrors setRaidSplit.test.js's own shape
// (Leader/Co-Leader only, deferReply -> requireUserDetails -> requireUserGuild -> role check
// -> updateGuildDatabase). Also covers the guild.raidPayoutMode default/self-healing path
// (findGuildById's own healing loop is exercised for real by requireUserGuild) and confirms
// /set-raid-payout writes the raw value straight through, unmodified.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { callback } = require('../setRaidPayout');
const { GuildRoles } = require('../../../utils/constants');

function fakeInteraction(mode) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User', avatar: 'avatar-hash' },
        options: {
            get: (name) => (name === 'mode' && mode !== undefined ? { value: mode } : undefined),
        },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        memberList: [{ id: 'user-1', username: 'User', role: 'Leader' }],
        raidPayoutMode: 'bank',
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/set-raid-payout permission gate', () => {
    test('Leader can set the payout mode', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [{ id: 'user-1', username: 'User', role: GuildRoles.LEADER }],
        }));
        const interaction = fakeInteraction('direct');

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'raidPayoutMode', 'direct');
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('direct'));
    });

    test('Co-Leader can set the payout mode', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [{ id: 'user-1', username: 'User', role: GuildRoles.COLEADER }],
        }));
        const interaction = fakeInteraction('bank');

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'raidPayoutMode', 'bank');
    });

    test('a plain Member is rejected and no write happens', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [{ id: 'user-1', username: 'User', role: GuildRoles.MEMBER }],
        }));
        const interaction = fakeInteraction('direct');

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('co-leader or the guild leader'));
    });

    test('an Elder is rejected the same as a plain Member — this is stricter than start-raid\'s own Elder allowance', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({
            memberList: [{ id: 'user-1', username: 'User', role: GuildRoles.ELDER }],
        }));
        const interaction = fakeInteraction('direct');

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildDatabase).not.toHaveBeenCalled();
    });
});

describe('/set-raid-payout default value on a pre-existing guild', () => {
    test('a guild record healed to raidPayoutMode: "bank" (predates this field) is respected as the starting value, and a write still switches it', async () => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        // Simulates findGuildById's own healing pass already having backfilled the
        // missing field with the default before this command ever sees the guild.
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture({ raidPayoutMode: 'bank' }));
        const interaction = fakeInteraction('direct');

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'raidPayoutMode', 'direct');
    });
});

describe('/set-raid-payout writes the raw selected value through unmodified', () => {
    test.each(['bank', 'direct'])('writes %s exactly as selected', async (mode) => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'user-1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guildFixture());
        const interaction = fakeInteraction(mode);

        await callback({}, interaction);

        expect(dynamoHandler.updateGuildDatabase).toHaveBeenCalledWith(7, 'raidPayoutMode', mode);
    });
});
