// No test file existed for /guild before this. Covers only the 2026-09-30 wiring added to
// its callback (see startRaid.js's resolveRaid for the full member-bonus writeup): before
// building the embed, /guild now fetches the whole guild roster via
// guildShopFactory.getAllMemberDetails, computes the live member bank-capacity bonus via
// getGuildMemberBankCapacityBonus, and passes it as createGuildEmbed's second arg (that
// function's own display logic is unit-tested separately in embedFactory.test.js).
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/guildShopFactory');
jest.mock('../../../utils/embedFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const guildShopFactory = require('../../../utils/guildShopFactory');
const { EmbedFactory } = require('../../../utils/embedFactory');
const guildCommand = require('../guild');

// guild.js's own top-level `new EmbedFactory()` runs once at require time, before any
// beforeEach — jest.clearAllMocks() below empties EmbedFactory.mock.instances itself (its
// own call history), so the instance reference has to be captured here, up front, not
// re-read from that array inside each test.
const embedInstance = EmbedFactory.mock.instances[0];

function fakeInteraction(guildName) {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'u1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => (name === 'guild-name' && guildName !== undefined ? { value: guildName } : undefined),
        },
    };
}

function guildFixture(overrides = {}) {
    return {
        guildId: 7,
        guildName: 'Some Guild',
        memberList: [{ id: 'u1', username: 'User', role: 'Leader' }],
        bankCapacity: 1_000_000,
        bankStored: 0,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/guild wires the live member bank-capacity bonus into createGuildEmbed', () => {
    test('viewing your own guild fetches the whole roster and passes the computed bonus through', async () => {
        const guild = guildFixture();
        dynamoHandler.findUser.mockResolvedValue({ userId: 'u1', username: 'User', guildId: 7 });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const allMemberDetailsPlaceholder = ['member-details-placeholder'];
        guildShopFactory.getAllMemberDetails.mockResolvedValue(allMemberDetailsPlaceholder);
        guildShopFactory.getGuildMemberBankCapacityBonus.mockReturnValue(12345);
        embedInstance.createGuildEmbed.mockReturnValue('EMBED_PLACEHOLDER');
        const interaction = fakeInteraction();

        await guildCommand.callback({}, interaction);

        expect(guildShopFactory.getAllMemberDetails).toHaveBeenCalledWith(guild);
        expect(guildShopFactory.getGuildMemberBankCapacityBonus).toHaveBeenCalledWith(allMemberDetailsPlaceholder);
        expect(embedInstance.createGuildEmbed).toHaveBeenCalledWith(guild, 12345);
        expect(interaction.editReply).toHaveBeenCalledWith({ embeds: ['EMBED_PLACEHOLDER'] });
    });

    test('looking up a guild by name goes through the same wiring', async () => {
        const guild = guildFixture({ guildId: 9, guildName: 'Other Guild' });
        dynamoHandler.findGuildByName.mockResolvedValue(guild);
        guildShopFactory.getAllMemberDetails.mockResolvedValue([]);
        guildShopFactory.getGuildMemberBankCapacityBonus.mockReturnValue(0);
        embedInstance.createGuildEmbed.mockReturnValue('EMBED_PLACEHOLDER');
        const interaction = fakeInteraction('Other Guild');

        await guildCommand.callback({}, interaction);

        expect(dynamoHandler.findUser).not.toHaveBeenCalled();
        expect(guildShopFactory.getAllMemberDetails).toHaveBeenCalledWith(guild);
        expect(embedInstance.createGuildEmbed).toHaveBeenCalledWith(guild, 0);
    });
});
