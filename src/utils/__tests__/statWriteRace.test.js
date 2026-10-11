// End-to-end regression for the base-drift race (2026-10-11 atomic-stat-writes refactor — see
// statWriteFactory.js and .claude/roadmap.md): a minimal in-memory DynamoDB applies the REAL
// UpdateExpressions dynamoHandler.updateUserFields builds, and two REAL writers (a raid stat
// grant and a shop buy / a regrade payload) each compute their write from the SAME stale
// snapshot, then land in both orders. The invariant that must hold afterward is
// raw - sweetPotatoBuffs - regradeAmount === the purchased shop tier, exactly. A control test
// replays the OLD absolute-SET shapes against the same store to prove the harness really does
// catch the drift it exists to prevent.
jest.mock('aws-sdk', () => {
    const documentClient = { put: jest.fn(), query: jest.fn(), update: jest.fn(), scan: jest.fn(), transactWrite: jest.fn() };
    return {
        config: { update: jest.fn() },
        DynamoDB: { DocumentClient: jest.fn(() => documentClient) },
    };
});

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const dynamoHandler = require('../dynamoHandler');
const { RaidFactory } = require('../raidFactory');
const raidFactory = new RaidFactory();
const { attemptShopBuy } = require('../shopFactory');
const rebirthFactory = require('../rebirthFactory');
const { regradeSuccessWrites } = require('../statWriteFactory');
const { shops } = require('../constants');

// Applies "set a = :x, b.c = :y add d :z, e.f :w" with #name placeholders to a plain object.
function applyUpdate(item, { UpdateExpression, ExpressionAttributeNames: names = {}, ExpressionAttributeValues: values = {} }) {
    const [setPart, addPart] = (() => {
        const m = UpdateExpression.match(/^(?:set (.*?))?(?: ?add (.*))?$/);
        return [m[1], m[2]];
    })();
    const resolvePath = (token) => token.split('.').map(seg => names[seg] ?? seg);
    const walk = (path) => {
        let node = item;
        for (const seg of path.slice(0, -1)) node = node[seg];
        return [node, path[path.length - 1]];
    };
    for (const clause of (setPart ? setPart.split(', ') : [])) {
        const [lhs, rhs] = clause.split(' = ');
        const [node, key] = walk(resolvePath(lhs));
        node[key] = values[rhs];
    }
    for (const clause of (addPart ? addPart.split(', ') : [])) {
        const [lhs, rhs] = clause.split(' ');
        const [node, key] = walk(resolvePath(lhs));
        node[key] = (node[key] || 0) + values[rhs];
    }
}

function makePlayer() {
    // Maxed work shop (base 100) with real sweet + regrade bonuses already on top.
    return {
        userId: 'u1', username: 'u',
        potatoes: 1e15,
        workMultiplierAmount: 50 + 20 + 10, // base at tier 50 (shop item before the top tier), sweet 20, regrade 10
        passiveAmount: 0,
        bankCapacity: 50000,
        maxStarches: 25000,
        sweetPotatoBuffs: { workMultiplierAmount: 20, passiveAmount: 0, bankCapacity: 0 },
        regrades: {
            workMulti: { regradeAmount: 10, failStack: 0 },
            passiveAmount: { regradeAmount: 0, failStack: 0 },
            bankCapacity: { regradeAmount: 0, failStack: 0 },
        },
    };
}

let store;
let snapshot;

beforeEach(() => {
    jest.restoreAllMocks();
    store = makePlayer();
    snapshot = JSON.parse(JSON.stringify(store));
    docClient.update.mockImplementation((params) => ({
        promise: async () => { applyUpdate(store, params); return { Attributes: store }; },
    }));
    // Every reader gets the SAME stale snapshot (a fresh deep copy each call), regardless of
    // what the other writer has already landed — the overlapping-commands scenario.
    jest.spyOn(dynamoHandler, 'findUser').mockImplementation(async () => JSON.parse(JSON.stringify(snapshot)));
});

const base = () => rebirthFactory.getBaseValue(store, 'workMultiplierAmount');
const workShop = shops.find(s => s.shopId === 'workShop');
const nextTierAmount = workShop.items.find(i => i.currentAmount === 50).amount;

describe('stat writers racing from the same stale snapshot', () => {
    test('a raid stat grant and a shop buy leave base exactly on the purchased tier, in either landing order', async () => {
        const grant = () => raidFactory.handleStatSplit([{ id: 'u1', username: 'u' }], 'workMultiplierAmount', 3);
        const buy = () => attemptShopBuy('u1', 'u', 'workShop');

        // Order 1: grant lands, then the (stale-snapshot) buy.
        await grant(); await buy();
        expect(base()).toBeCloseTo(nextTierAmount);
        expect(store.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(23);
        expect(store.workMultiplierAmount).toBeCloseTo(nextTierAmount + 23 + 10);

        // Order 2 on a fresh player: buy lands first, then the grant.
        store = makePlayer(); snapshot = JSON.parse(JSON.stringify(store));
        await buy(); await grant();
        expect(base()).toBeCloseTo(nextTierAmount);
        expect(store.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(23);
        expect(store.workMultiplierAmount).toBeCloseTo(nextTierAmount + 23 + 10);
    });

    test('a raid stat grant and a regrade success leave base untouched in either landing order', async () => {
        const grant = () => raidFactory.handleStatSplit([{ id: 'u1', username: 'u' }], 'workMultiplierAmount', 3);
        const regrade = async () => {
            const { adds, sets } = regradeSuccessWrites('workMultiplierAmount', 5);
            await dynamoHandler.updateUserFields('u1', sets, adds);
        };

        await grant(); await regrade();
        expect(base()).toBeCloseTo(50);
        expect(store.regrades.workMulti.regradeAmount).toBe(15);
        expect(store.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(23);

        store = makePlayer(); snapshot = JSON.parse(JSON.stringify(store));
        await regrade(); await grant();
        expect(base()).toBeCloseTo(50);
        expect(store.regrades.workMulti.regradeAmount).toBe(15);
        expect(store.sweetPotatoBuffs.workMultiplierAmount).toBeCloseTo(23);
    });

    // Control: the OLD write shapes (absolute raw SET + whole stale sweetPotatoBuffs object, and
    // an absolute-raw regrade) from the same stale snapshot DO drift base in this harness — so a
    // green result above is the refactor working, not the harness being unable to see the bug.
    test('control: the old absolute-SET shapes landing in the same overlap drop base below its tier', async () => {
        // Old grant: SET raw = snapshot.raw + 3, SET whole sweetPotatoBuffs from the snapshot.
        const oldGrant = () => dynamoHandler.updateUserFields('u1', {
            workMultiplierAmount: snapshot.workMultiplierAmount + 3,
            sweetPotatoBuffs: { ...snapshot.sweetPotatoBuffs, workMultiplierAmount: snapshot.sweetPotatoBuffs.workMultiplierAmount + 3 },
        });
        // Old regrade: SET whole regrades object + SET raw = snapshot.raw + 5.
        const oldRegrade = () => dynamoHandler.updateUserFields('u1', {
            workMultiplierAmount: snapshot.workMultiplierAmount + 5,
            regrades: { ...snapshot.regrades, workMulti: { regradeAmount: snapshot.regrades.workMulti.regradeAmount + 5, failStack: 0 } },
        });

        // The regrade lands first, then the grant (stale raw overwrites the regrade's raw
        // increment, but regradeAmount keeps it): raw is short by exactly the regrade step.
        await oldRegrade(); await oldGrant();
        expect(base()).toBeCloseTo(50 - 5);
        // ...which is precisely the shortfall healBaseDrift turns into a whole-tier demotion.
        expect(rebirthFactory.healBaseDrift(store)).not.toBeNull();
    });
});
