// regradeChanceBoostPercent rework (2026-09-04, direct instruction) — "instead of a flat 3%
// regrade chance increase it is 50%... for the regrades that is normally 50% it's 75%, for 10%
// it's now 15%". Elder Rootbeard's regrade perk used to ADD a flat amount onto a regrade tier's
// own chance; it now MULTIPLIES it instead. These tests lock in the actual chanceOfSuccess
// value passed to the result embed (not just the constant's raw value), and prove the boost
// changes real success/fail outcomes, not just a displayed number.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { shops, workRegradeTiers } = require('../../../utils/constants');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../regrade');

const workShop = shops.find(s => s.shopId === 'workShop');
const REQUIRED_WORK_BASE = workShop.items[workShop.items.length - 1].amount;
const TIER = workRegradeTiers[0]; // chance: .5

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.updateUserFields.mockResolvedValue();
    dynamoHandler.updateUserDatabase.mockResolvedValue();
    dynamoHandler.addUserDatabase.mockResolvedValue();
});

function baseUser(companions) {
    return {
        userId: 'user-1',
        username: 'User',
        potatoes: 999999999999,
        workMultiplierAmount: REQUIRED_WORK_BASE,
        sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
        regrades: {
            workMulti: { regradeAmount: 0, failStack: 0 },
            passiveAmount: { regradeAmount: 0, failStack: 0 },
            bankCapacity: { regradeAmount: 0, failStack: 0 },
        },
        companions,
    };
}

// Confirm-preview step (direct instruction — "show an embed with the regrade info and
// buttons for regrading or not") — editReply now returns a reply object a confirm/cancel
// button collector attaches to, same shape startRaid*.test.js's own fakeInteraction uses.
// sacrificeChoice-style param names would be misleading here since there's only one real
// decision; `buttonChoice` picks which click (or lack of one) the mocked collector hands
// back: 'confirm' (default), 'cancel', or anything else for a timeout.
function fakeInteraction({ buttonChoice = 'confirm', viewTiers = false } = {}) {
    const replyObj = {
        edit: jest.fn().mockResolvedValue(),
        awaitMessageComponent: jest.fn().mockImplementation(async () => {
            if (buttonChoice === 'confirm') return { customId: 'regrade_confirm', deferUpdate: jest.fn().mockResolvedValue() };
            if (buttonChoice === 'cancel') return { customId: 'regrade_cancel', deferUpdate: jest.fn().mockResolvedValue() };
            return null; // timeout
        }),
    };
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(replyObj),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
        options: {
            get: (name) => {
                if (name === 'regrade-select') return { value: 'work-multi' };
                if (name === 'view-tiers') return viewTiers ? { value: true } : undefined;
                return undefined;
            }
        },
    };
}

// Runs /regrade once (through a confirmed regrade attempt by default) and returns the args
// createRegradeEmbed was called with — captured BEFORE the spy is restored, since
// mockRestore() also wipes mock.calls.
async function runRegrade(companions, randomValue, interactionOverrides = {}) {
    dynamoHandler.findUser.mockResolvedValue(baseUser(companions));
    const spy = jest.spyOn(EmbedFactory.prototype, 'createRegradeEmbed').mockReturnValue({});
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(randomValue);
    let call;
    try {
        await callback({}, fakeInteraction(interactionOverrides));
        call = spy.mock.calls[0];
    } finally {
        randomSpy.mockRestore();
        spy.mockRestore();
    }
    return call;
}

test('no companion equipped: chanceOfSuccess is exactly the tier\'s own chance, unaffected by the rework', async () => {
    const call = await runRegrade({ owned: [], active: null }, 0.999999);
    expect(call[7]).toBeCloseTo(TIER.chance);
});

test('Elder Rootbeard equipped (level 1, +50%): chanceOfSuccess is the tier\'s chance multiplied by 1.5, not added to', async () => {
    const call = await runRegrade({ owned: [{ instanceId: 'elder-a', id: 'elder_rootbeard', workCount: 10 }], active: 'elder-a' }, 0.999999);
    // TIER.chance (.5) * 1.5 = .75 — a flat +3% add would have given .53, not .75.
    expect(call[7]).toBeCloseTo(TIER.chance * 1.5);
    expect(call[7]).not.toBeCloseTo(TIER.chance + 0.03);
});

test('the boost changes a real roll outcome, not just the displayed number', async () => {
    // Between the un-boosted chance (.5) and the boosted chance (.75) — fails without
    // Rootbeard, succeeds with Rootbeard, on the exact same roll.
    const rollBetween = 0.6;

    const withoutRootbeard = await runRegrade({ owned: [], active: null }, rollBetween);
    // increase (arg index 6) is 0 on a fail, currentTier.increase on a success.
    expect(withoutRootbeard[6]).toBe(0);

    const withRootbeard = await runRegrade({ owned: [{ instanceId: 'elder-a', id: 'elder_rootbeard', workCount: 10 }], active: 'elder-a' }, rollBetween);
    expect(withRootbeard[6]).toBe(TIER.increase);
});

describe('confirm-preview step (direct instruction: show an embed with buttons for regrading or not)', () => {
    test('shows a preview embed with a Confirm/Cancel row before spending anything', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ owned: [], active: null }));
        const previewSpy = jest.spyOn(EmbedFactory.prototype, 'createRegradePreviewEmbed').mockReturnValue({});
        const interaction = fakeInteraction({ buttonChoice: 'confirm' });

        await callback({}, interaction);

        expect(previewSpy).toHaveBeenCalledTimes(1);
        const firstEditReplyCall = interaction.editReply.mock.calls[0][0];
        expect(firstEditReplyCall.components).toHaveLength(1);
        expect(dynamoHandler.addUserDatabase).toHaveBeenCalled(); // confirmed -> actually spent
        previewSpy.mockRestore();
    });

    test('cancel: no potatoes spent, no regrade attempted', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ owned: [], active: null }));
        const interaction = fakeInteraction({ buttonChoice: 'cancel' });

        await callback({}, interaction);

        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });

    test('timeout (awaitMessageComponent resolves null): identical to cancel, no regrade attempted', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ owned: [], active: null }));
        const interaction = fakeInteraction({ buttonChoice: 'timeout' });

        await callback({}, interaction);

        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();
        expect(dynamoHandler.updateUserDatabase).not.toHaveBeenCalled();
    });

    test('re-validates against a fresh read at confirm time, not the preview\'s original read', async () => {
        // Potatoes drop below the tier's cost between the preview and the confirm click —
        // findUser's SECOND call (the confirm-time re-fetch) returns the poorer user.
        const richUser = baseUser({ owned: [], active: null });
        const poorUser = { ...richUser, potatoes: 0 };
        dynamoHandler.findUser
            .mockResolvedValueOnce(richUser)
            .mockResolvedValueOnce(poorUser);
        const interaction = fakeInteraction({ buttonChoice: 'confirm' });

        await callback({}, interaction);

        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();
        const lastEditReplyCall = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0];
        expect(lastEditReplyCall).toMatch(/do not have enough to regrade/);
    });
});

describe('view-tiers option (direct instruction: add option to see all regrade tiers with pagination)', () => {
    test('renders the tier ladder instead of a preview, and never spends or rolls anything', async () => {
        dynamoHandler.findUser.mockResolvedValue(baseUser({ owned: [], active: null }));
        const tiersSpy = jest.spyOn(EmbedFactory.prototype, 'createRegradeTiersPageEmbed').mockReturnValue({});
        const previewSpy = jest.spyOn(EmbedFactory.prototype, 'createRegradePreviewEmbed').mockReturnValue({});
        // buttonChoice: 'timeout' — the pagination loop's own click-through behavior is
        // runPaginatedReply's concern, not this command's; this test only needs the first
        // page to render correctly, so the mocked collector resolves null (timeout) to
        // exit the loop immediately via its own no-op "clear components" branch.
        const interaction = fakeInteraction({ viewTiers: true, buttonChoice: 'timeout' });

        await callback({}, interaction);

        expect(tiersSpy).toHaveBeenCalledTimes(1);
        expect(previewSpy).not.toHaveBeenCalled();
        expect(dynamoHandler.addUserDatabase).not.toHaveBeenCalled();

        // 14 work-multi tiers at 6/page -> 3 pages -> a pagination row is attached.
        const firstEditReplyCall = interaction.editReply.mock.calls[0][0];
        expect(firstEditReplyCall.components).toHaveLength(1);

        tiersSpy.mockRestore();
        previewSpy.mockRestore();
    });
});
