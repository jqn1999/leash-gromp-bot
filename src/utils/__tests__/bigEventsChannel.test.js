// Big Events Channel (2026-09-16 follow-up, direct instruction — "add mythic and above
// companions or the tower/yukon/guild companions to the big events"). Bot-side counterpart
// to financial-project's own postBigEvent — see systems/server-activity-channel.md.
jest.mock('../dynamoHandler');

const dynamoHandler = require('../dynamoHandler');
const {
    postBigEvent,
    isBigEventCompanion,
    describeCompanion,
    BIG_EVENT_WIN_CHANCE_THRESHOLD,
    BIG_EVENT_WORK_ENCOUNTERS,
    BIG_EVENT_WORK_LABELS,
} = require('../bigEventsChannel');

const mythic = { id: 'mochi', name: 'Mochi', rarity: 'mythic' };
const heirloom = { id: 'yamimic', name: 'Yamimic, the Thousand-Faced', rarity: 'heirloom' };
const commonCompanion = { id: 'sprout', name: 'Sprout', rarity: 'common' };
const legendaryNoDropSource = { id: 'spudsprite', name: 'Spudsprite', rarity: 'legendary' };
const yukon = { id: 'yukon', name: 'Yukon, the Highwayman', rarity: 'legendary', dropSource: 'bounty' };
const cinderroot = { id: 'cinderroot', name: 'Cinderroot, the Hoardwarden', rarity: 'legendary', dropSource: 'guildRaid' };
const bastion = { id: 'bastion', name: 'Bastion, the Tower Warden', rarity: 'legendary', dropSource: 'tower' };

describe('isBigEventCompanion', () => {
    test('true for Mythic rarity', () => {
        expect(isBigEventCompanion(mythic)).toBe(true);
    });

    test('true for Heirloom rarity', () => {
        expect(isBigEventCompanion(heirloom)).toBe(true);
    });

    test('false for Common/Legendary companions with no special dropSource', () => {
        expect(isBigEventCompanion(commonCompanion)).toBe(false);
        expect(isBigEventCompanion(legendaryNoDropSource)).toBe(false);
    });

    test('true for Yukon (dropSource: bounty) despite being Legendary, not Mythic+', () => {
        expect(isBigEventCompanion(yukon)).toBe(true);
    });

    test('true for Cinderroot (dropSource: guildRaid)', () => {
        expect(isBigEventCompanion(cinderroot)).toBe(true);
    });

    test('true for Bastion (dropSource: tower)', () => {
        expect(isBigEventCompanion(bastion)).toBe(true);
    });
});

describe('describeCompanion', () => {
    test('formats name and rarity label', () => {
        expect(describeCompanion(mythic)).toBe('Mochi (Mythic)');
        expect(describeCompanion(heirloom)).toBe('Yamimic, the Thousand-Faced (Heirloom)');
        expect(describeCompanion(yukon)).toBe('Yukon, the Highwayman (Legendary)');
    });
});

// Widened same day (direct instruction — "I also wanted the big events to generally
// include normal discord bot commands too for the golden and metals and such") to also
// cover real Discord commands, not just the website — see work.js/takeBounty.js/
// robNpc.js/startRaid.js's own call sites. These constants are what those files share.
describe('BIG_EVENT_WIN_CHANCE_THRESHOLD / BIG_EVENT_WORK_ENCOUNTERS / BIG_EVENT_WORK_LABELS', () => {
    test('win-chance threshold is 30%, matching financial-project\'s own constant', () => {
        expect(BIG_EVENT_WIN_CHANCE_THRESHOLD).toBe(0.30);
    });

    test('encounter set covers exactly golden/metalSuccess/ancient/goldenYam', () => {
        expect([...BIG_EVENT_WORK_ENCOUNTERS].sort()).toEqual(['ancient', 'golden', 'goldenYam', 'metalSuccess'].sort());
        expect(BIG_EVENT_WORK_ENCOUNTERS.has('regular')).toBe(false);
        expect(BIG_EVENT_WORK_ENCOUNTERS.has('metalFailure')).toBe(false);
    });

    test('every encounter in the set has a matching label', () => {
        for (const type of BIG_EVENT_WORK_ENCOUNTERS) {
            expect(typeof BIG_EVENT_WORK_LABELS[type]).toBe('string');
        }
    });
});

describe('postBigEvent', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn().mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        delete global.fetch;
    });

    test('does nothing when no big events channel is configured', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue(undefined);

        await postBigEvent('test message');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does nothing when the stored doc has no webhookUrl', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ channelId: 'chan-1' });

        await postBigEvent('test message');

        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('posts a Gold embed to the configured webhook', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ webhookUrl: 'https://discord.com/api/webhooks/big/token' });

        await postBigEvent('✨ **Someone** found something amazing!');

        expect(dynamoHandler.getStatDatabase).toHaveBeenCalledWith('server_big_events_channel');
        expect(global.fetch).toHaveBeenCalledWith('https://discord.com/api/webhooks/big/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [{ description: '✨ **Someone** found something amazing!', color: 0xFFD700 }] }),
        });
    });

    test('a fetch failure is swallowed, never thrown back to the caller', async () => {
        dynamoHandler.getStatDatabase.mockResolvedValue({ webhookUrl: 'https://discord.com/api/webhooks/big/token' });
        global.fetch.mockRejectedValue(new Error('network blip'));

        await expect(postBigEvent('test message')).resolves.toBeUndefined();
    });

    test('a getStatDatabase failure is also swallowed', async () => {
        dynamoHandler.getStatDatabase.mockRejectedValue(new Error('dynamo blip'));

        await expect(postBigEvent('test message')).resolves.toBeUndefined();
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
