// Bank Capacity's final regrade tier jumps regradeAmount straight to REGRADE_CAPS.bankCapacity
// (103,000,000,000) — the same threshold that makes /bank and /profile start showing
// "Unlimited" instead of a number. Direct instruction, 2026-09-27, following a question about
// whether /regrade's own embeds show that milestone or just the literal +100,000,000,000
// increase: all three regrade embeds (preview, result, tiers-list) now special-case it.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { shops, bankRegradeTiers, REGRADE_CAPS } = require('../../../utils/constants');
const { EmbedFactory } = require('../../../utils/embedFactory');
const regradeCommand = require('../regrade');
const { callback, buildTierRows, TRACK_CONFIGS } = regradeCommand;

const bankShop = shops.find(s => s.shopId === 'bankShop');
const REQUIRED_BANK_BASE = bankShop.items[bankShop.items.length - 1].amount;
const FINAL_TIER = bankRegradeTiers[bankRegradeTiers.length - 1];

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
});

function userAtBankTier(regradeAmount) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 999999999999999,
        bankCapacity: REQUIRED_BANK_BASE + regradeAmount,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        regrades: {
            workMulti: { regradeAmount: 0, failStack: 0 },
            passiveAmount: { regradeAmount: 0, failStack: 0 },
            bankCapacity: { regradeAmount, failStack: 0 },
        },
        companions: { owned: [], active: null },
    };
}

function fakeInteraction({ buttonChoice = 'confirm', viewTiers = false } = {}) {
    const replyObj = {
        edit: jest.fn().mockResolvedValue(),
        awaitMessageComponent: jest.fn().mockImplementation(async () => {
            if (buttonChoice === 'confirm') return { customId: 'regrade_confirm', deferUpdate: jest.fn().mockResolvedValue() };
            if (buttonChoice === 'cancel') return { customId: 'regrade_cancel', deferUpdate: jest.fn().mockResolvedValue() };
            return null;
        }),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => {
                if (name === 'regrade-select') return { value: 'bank-capacity' };
                if (name === 'view-tiers') return viewTiers ? { value: true } : undefined;
                return undefined;
            }
        },
    };
}

describe('preview embed', () => {
    test('the final tier shows willMaxBankCapacity: true', async () => {
        dynamoHandler.findUser.mockResolvedValue(userAtBankTier(FINAL_TIER.currentRegradeAmount));
        const previewSpy = jest.spyOn(EmbedFactory.prototype, 'createRegradePreviewEmbed').mockReturnValue({});

        await callback({}, fakeInteraction());

        const [, , , , , , , , , , willMaxBankCapacity] = previewSpy.mock.calls[0];
        expect(willMaxBankCapacity).toBe(true);
        previewSpy.mockRestore();
    });

    test('an earlier tier shows willMaxBankCapacity: false', async () => {
        dynamoHandler.findUser.mockResolvedValue(userAtBankTier(0));
        const previewSpy = jest.spyOn(EmbedFactory.prototype, 'createRegradePreviewEmbed').mockReturnValue({});

        await callback({}, fakeInteraction());

        const [, , , , , , , , , , willMaxBankCapacity] = previewSpy.mock.calls[0];
        expect(willMaxBankCapacity).toBe(false);
        previewSpy.mockRestore();
    });
});

describe('result embed', () => {
    test('a SUCCESSFUL final-tier attempt passes willMaxBankCapacity: true', async () => {
        dynamoHandler.findUser.mockResolvedValue(userAtBankTier(FINAL_TIER.currentRegradeAmount));
        const resultSpy = jest.spyOn(EmbedFactory.prototype, 'createRegradeEmbed').mockReturnValue({});
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees success

        await callback({}, fakeInteraction());

        const [, , , , , , , , , , , , willMaxBankCapacity] = resultSpy.mock.calls[0];
        expect(willMaxBankCapacity).toBe(true);
        randomSpy.mockRestore();
        resultSpy.mockRestore();
    });

    test('a FAILED final-tier attempt passes willMaxBankCapacity: false (regradeAmount never moved)', async () => {
        dynamoHandler.findUser.mockResolvedValue(userAtBankTier(FINAL_TIER.currentRegradeAmount));
        const resultSpy = jest.spyOn(EmbedFactory.prototype, 'createRegradeEmbed').mockReturnValue({});
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.999999); // guarantees failure

        await callback({}, fakeInteraction());

        const [, , , , , , , , , , , , willMaxBankCapacity] = resultSpy.mock.calls[0];
        expect(willMaxBankCapacity).toBe(false);
        randomSpy.mockRestore();
        resultSpy.mockRestore();
    });

    test('a successful attempt on a NON-final tier passes willMaxBankCapacity: false', async () => {
        dynamoHandler.findUser.mockResolvedValue(userAtBankTier(0));
        const resultSpy = jest.spyOn(EmbedFactory.prototype, 'createRegradeEmbed').mockReturnValue({});
        const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // guarantees success

        await callback({}, fakeInteraction());

        const [, , , , , , , , , , , , willMaxBankCapacity] = resultSpy.mock.calls[0];
        expect(willMaxBankCapacity).toBe(false);
        randomSpy.mockRestore();
        resultSpy.mockRestore();
    });
});

describe('tiers-list rows (buildTierRows)', () => {
    test('only the final bank-capacity tier row carries willMaxBankCapacity: true', () => {
        const rows = buildTierRows(TRACK_CONFIGS['bank-capacity'], 0);
        const flagged = rows.filter(r => r.willMaxBankCapacity);
        expect(flagged).toHaveLength(1);
        expect(flagged[0].tier).toBe(FINAL_TIER);
    });

    test('work-multi and passive-income tracks never flag any row (only bankCapacity gets Unlimited framing)', () => {
        const workRows = buildTierRows(TRACK_CONFIGS['work-multi'], 0);
        const passiveRows = buildTierRows(TRACK_CONFIGS['passive-income'], 0);
        expect(workRows.every(r => !r.willMaxBankCapacity)).toBe(true);
        expect(passiveRows.every(r => !r.willMaxBankCapacity)).toBe(true);
    });
});
