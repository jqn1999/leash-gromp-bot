// /trading-post — Guild-scoped and Merc-Faction-scoped NPC potion vendor
// (systems/trading-post.md). Mocks at the dynamoHandler boundary the command actually
// touches; tradingPostFactory stays REAL so scope resolution/daily-rotation/purchase-rule
// logic is actually exercised, not stubbed.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { getDailyTag, getDailyRotation, computePotionPrice } = require('../../../utils/tradingPostFactory');
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
        workMultiplierAmount: 10,
        passiveAmount: 100000,
        ...overrides,
    };
}

// The caller in every test below is 'user-1' — this is their own actual daily rotation,
// used the same way tradingPostFactory.attemptPurchasePotion itself derives it, so tests
// never assume a specific catalog id is on offer.
const rotation = getDailyRotation('user-1');

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

    test('a guilded player sees the guild-scoped embed, titled after their own guild, showing today\'s 3 rotated potions', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ guildId: 'g1' }));
        dynamoHandler.findGuildById.mockResolvedValue({ guildId: 'g1', guildName: 'Spud Squad' });
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        const embed = interaction.editReply.mock.calls[0][0].embeds[0];
        expect(embed.data.title).toContain('Spud Squad');
        expect(embed.data.fields).toHaveLength(rotation.length);
        rotation.forEach((potion) => {
            expect(embed.data.fields.some(f => f.name.startsWith(potion.name))).toBe(true);
        });
    });

    test('buy button labels/prices reflect the LIVE computed price for the viewing player, not a flat price', async () => {
        const user = baseUser({ guildId: 'g1' });
        dynamoHandler.findUser.mockResolvedValue(user);
        dynamoHandler.findGuildById.mockResolvedValue({ guildId: 'g1', guildName: 'Spud Squad' });
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        const buttons = interaction.editReply.mock.calls[0][0].components[0].components;
        rotation.forEach((potion, i) => {
            const price = computePotionPrice(potion, user);
            expect(buttons[i].data.label).toContain(price.toLocaleString());
        });
    });

    // Daily stock limit (2026-09-21) — the buy button for a potion already bought today is
    // disabled up front (a "doomed click should never even be possible"), and the embed's
    // own field for it carries the same note, so the two can never disagree.
    test('a potion already bought today shows a disabled button and an "already bought" note, others stay normal', async () => {
        const today = getDailyTag();
        dynamoHandler.findUser.mockResolvedValue(baseUser({
            guildId: 'g1',
            tradingPostDailyPurchases: { dailyTag: today, potionIds: [rotation[0].id] },
        }));
        dynamoHandler.findGuildById.mockResolvedValue({ guildId: 'g1', guildName: 'Spud Squad' });
        const { interaction } = fakeInteraction();

        await callback({}, interaction);

        const call = interaction.editReply.mock.calls[0][0];
        const boughtField = call.embeds[0].data.fields[0];
        expect(boughtField.value).toMatch(/already bought today/i);
        const otherField = call.embeds[0].data.fields[1];
        expect(otherField.value).not.toMatch(/already bought today/i);

        const buttons = call.components[0].components;
        expect(buttons[0].data.disabled).toBe(true);
        expect(buttons[1].data.disabled).toBeFalsy();
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
    test('a successful purchase closes the shop out — direct instruction, no re-rendered embed/buttons, no further click awaited', async () => {
        const potion = rotation[0];
        const startingUser = baseUser({ guildId: 'g1' });
        const price = computePotionPrice(potion, startingUser);
        dynamoHandler.findGuildById.mockResolvedValue({ guildId: 'g1', guildName: 'Spud Squad' });
        dynamoHandler.updateUserFields.mockResolvedValue({});

        const { interaction, reply } = fakeInteraction();
        reply.awaitMessageComponent
            .mockResolvedValueOnce({ customId: `trading_post_buy_${potion.id}`, deferUpdate: jest.fn().mockResolvedValue() })
            .mockResolvedValueOnce(null);

        // Two findUser calls happen in order: the command's own initial lookup, then
        // tradingPostFactory.attemptPurchasePotion's own internal re-fetch (a fresh read
        // right before writing, same precedent shopFactory.attemptShopBuy already sets) — a
        // successful purchase never triggers the command's OWN post-purchase re-fetch
        // anymore, since there's no embed left to render fresh state into.
        dynamoHandler.findUser
            .mockResolvedValueOnce(startingUser)
            .mockResolvedValueOnce(startingUser);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledWith('user-1', expect.objectContaining({
            potatoes: startingUser.potatoes - price,
        }));
        expect(dynamoHandler.findUser).toHaveBeenCalledTimes(2);
        const finalCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        expect(finalCall.content).toContain(potion.name);
        expect(finalCall.embeds).toEqual([]);
        expect(finalCall.components).toEqual([]);
        // The loop breaks immediately on a successful purchase rather than looping back to
        // await a second click.
        expect(reply.awaitMessageComponent).toHaveBeenCalledTimes(1);
    });

    test('a rejected purchase (e.g. a different potion already active) leaves the shop open with fresh state, not closed', async () => {
        const potion = rotation[0];
        const activePotion = rotation.find(p => p.effectType !== potion.effectType) || rotation[1];
        const startingUser = baseUser({
            guildId: 'g1',
            activePotion: { potionId: activePotion.id, effectType: activePotion.effectType, value: activePotion.value, expiresAt: Date.now() + 60_000 },
        });
        dynamoHandler.findGuildById.mockResolvedValue({ guildId: 'g1', guildName: 'Spud Squad' });

        const { interaction, reply } = fakeInteraction();
        reply.awaitMessageComponent
            .mockResolvedValueOnce({ customId: `trading_post_buy_${potion.id}`, deferUpdate: jest.fn().mockResolvedValue() })
            .mockResolvedValueOnce(null);

        // Rejected purchase never writes, so the command's post-rejection re-render re-fetches
        // the SAME (unchanged) user a third time.
        dynamoHandler.findUser
            .mockResolvedValueOnce(startingUser)
            .mockResolvedValueOnce(startingUser)
            .mockResolvedValueOnce(startingUser);

        await callback({}, interaction);

        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        const finalCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        expect(finalCall.content).toMatch(/already have/i);
        expect(finalCall.embeds).toHaveLength(1);
        expect(finalCall.components).toHaveLength(1);
        // The loop keeps going after a rejection, waiting for a second click.
        expect(reply.awaitMessageComponent).toHaveBeenCalledTimes(2);
    });
});
