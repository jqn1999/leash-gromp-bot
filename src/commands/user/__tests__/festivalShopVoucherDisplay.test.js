// Encounter Vouchers' result embed used to hardcode potatoesGained: 0 (fine while Sweet
// Potato — which never grants potatoes — was the only voucher). Adding Metal/Large Potato
// vouchers (2026-09-28, direct instruction: "add the new vouchers for sweet/metal/large")
// exposed a real display bug: Metal/Large DO grant real potatoes (credited via their own
// handler's DB write), but the confirmation embed would have shown "0 potatoes gained"
// regardless. These tests lock in the fix — extracting potatoesGained correctly whether the
// voucher's underlying handler returns a bare number (Large Potato), an object with
// potatoesGained (Metal Potato), or an object without one at all (Sweet Potato).
jest.mock('../../../utils/dynamoHandler');
jest.mock('../../../utils/festivalFactory');

const dynamoHandler = require('../../../utils/dynamoHandler');
const festivalFactory = require('../../../utils/festivalFactory');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../festivalShop');

function fakeInteraction() {
    const replyObj = {
        edit: jest.fn().mockResolvedValue(),
        awaitMessageComponent: jest.fn()
            .mockResolvedValueOnce({ customId: 'festival_shop_test_item', deferUpdate: jest.fn().mockResolvedValue() })
            .mockResolvedValueOnce(null),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        followUp: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User' },
    };
}

function userDetails() {
    return { userId: 'user-1', username: 'User', workCount: 5 };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.findUser.mockResolvedValue(userDetails());
    dynamoHandler.getActiveFestival.mockResolvedValue({ festivalId: 'frost_fair', endsAt: Date.now() + 100000 });
    festivalFactory.isFestivalLive.mockReturnValue(true);
    festivalFactory.buildFestivalShopView.mockReturnValue({ festivalId: 'frost_fair', items: [], balance: 0 });
});

test('Large Potato voucher (bare-number result): the real potatoesGained value reaches createWorkEmbed, not 0', async () => {
    festivalFactory.attemptPurchaseFestivalSlot.mockResolvedValue({
        ok: true, message: 'bought it!',
        voucherResult: { mob: { name: 'Large Potato' }, result: 4321 },
    });
    const spy = jest.spyOn(EmbedFactory.prototype, 'createWorkEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const call = spy.mock.calls.find(c => c[3]?.name === 'Large Potato');
    expect(call[2]).toBe(4321);
    spy.mockRestore();
});

test('Metal Potato voucher (object with potatoesGained): the real value reaches createWorkEmbed, not 0', async () => {
    festivalFactory.attemptPurchaseFestivalSlot.mockResolvedValue({
        ok: true, message: 'bought it!',
        voucherResult: { mob: { name: 'Metal Potato' }, result: { potatoesGained: 9999, statGrant: [{ type: 'workMultiplierAmount', amount: 1 }] } },
    });
    const spy = jest.spyOn(EmbedFactory.prototype, 'createWorkEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const call = spy.mock.calls.find(c => c[3]?.name === 'Metal Potato');
    expect(call[2]).toBe(9999);
    expect(call[8]).toEqual([{ type: 'workMultiplierAmount', amount: 1 }]);
    spy.mockRestore();
});

test('Sweet Potato voucher (object with no potatoesGained field): correctly defaults to 0, not a crash', async () => {
    festivalFactory.attemptPurchaseFestivalSlot.mockResolvedValue({
        ok: true, message: 'bought it!',
        voucherResult: { mob: { name: 'Sweet Potato' }, result: { random: 0, statGrant: [{ type: 'passiveAmount', amount: 5 }] } },
    });
    const spy = jest.spyOn(EmbedFactory.prototype, 'createWorkEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const call = spy.mock.calls.find(c => c[3]?.name === 'Sweet Potato');
    expect(call[2]).toBe(0);
    spy.mockRestore();
});
