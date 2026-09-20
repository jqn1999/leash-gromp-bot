// /trading-post — Guild-scoped and Merc-Faction-scoped NPC potion vendor
// (systems/trading-post.md). Mocks at the dynamoHandler boundary the command actually
// touches; tradingPostFactory stays REAL so scope resolution/purchase-rule logic is
// actually exercised, not stubbed.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { Potions } = require('../../../utils/constants');
const { callback } = require('../tradingPost');

function fakeInteraction() {
    const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(null), edit: jest.fn().mockResolvedValue() };
    const interaction = {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(reply),
        user: { id: 'user-1', username: 'User', displayName: 'User', avatar: 'hash' },
    };
    return { interaction, reply };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 10000000,
        guildId: 0,
        isMercenary: false,
        activePotion: null,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('/trading-post', () => {
    test('a player who could not be looked up gets the standard database-error reply, no embed', async () => {
        dynamoHandler.findUser.mockResolvedValue(null);
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('database error'));
    });

    // The core reject-with-no-scope path — neither guilded nor a mercenary.
    test('rejects outright for a player with no resolved scope (neither guilded nor a mercenary)', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 0, isMercenary: false }));
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/guild.*mercenary/i));
        expect(dynamoHandler.findGuildById).not.toHaveBeenCalled();
    });

    test('a guilded player sees the guild-scoped embed, titled after their own guild', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 'g1' }));
        dynamoHandler.findGuildById.mockResolvedValue({ guildId: 'g1', guildName: 'Spud Squad' });
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        expect(embed.data.title).toContain('Spud Squad');
        expect(embed.data.fields).toHaveLength(Potions.CATALOG.length);
    });

    test('a guilded player whose guild can no longer be found gets a clear lookup error', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 'g1' }));
        dynamoHandler.findGuildById.mockResolvedValue(null);
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringMatching(/error looking for your guild/i));
    });

    test('a mercenary sees the merc-scoped embed without a guild lookup', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ isMercenary: true }));
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        expect(dynamoHandler.findGuildById).not.toHaveBeenCalled();
        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        expect(embed.data.title).toMatch(/Hooded Trader/i);
    });

    // End-to-end purchase click — the command's own wiring around
    // tradingPostFactory.attemptPurchasePotion (that function's own branching is covered
    // directly in tradingPostFactory.test.js).
    test('clicking a buy button purchases the potion and re-renders with the fresh state', async () => {
        const potion = Potions.CATALOG[0];
        const startingUser = baseUser({ guildId: 'g1' });
        dynamoHandler.findGuildById.mockResolvedValue({ guildId: 'g1', guildName: 'Spud Squad' });
        dynamoHandler.updateUserFields.mockResolvedValue({});

        const { interaction, reply } = fakeInteraction();
        reply.awaitMessageComponent
            .mockResolvedValueOnce({ customId: `trading_post_buy_${potion.id}`, deferUpdate: jest.fn().mockResolvedValue() })
            .mockResolvedValueOnce(null);

        const afterPurchaseUser = baseUser({
            guildId: 'g1',
            potatoes: startingUser.potatoes - potion.pricePotatoes,
            activePotion: { potionId: potion.id, effectType: potion.effectType, value: potion.value, expiresAt: Date.now() + potion.durationSeconds * 1000 },
        });
        // Three findUser calls happen in order: the command's own initial lookup, then
        // tradingPostFactory.attemptPurchasePotion's own internal re-fetch (a fresh read
        // right before writing, same precedent shopFactory.attemptShopBuy already sets),
        // then the command's own post-purchase re-render fetch.
        dynamoHandler.findUser
            .mockResolvedValueOnce(startingUser)
            .mockResolvedValueOnce(startingUser)
            .mockResolvedValueOnce(afterPurchaseUser);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', expect.objectContaining({
            potatoes: startingUser.potatoes - potion.pricePotatoes,
        }));
        const finalCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        expect(finalCall.content).toContain(potion.name);
    });
});
