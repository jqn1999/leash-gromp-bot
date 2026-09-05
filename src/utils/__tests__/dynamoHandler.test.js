// Regression coverage for the "new users silently never get added" bug: addUser's
// initial Put included webLinkToken: null, which DynamoDB rejects because
// webLinkToken-index is a GSI expecting type String, not NULL. The Put failed, the
// error was swallowed, and every brand-new user's first command dead-ended with
// "could not be looked up due to a database error" without ever creating them.
//
// docClient is mocked so these tests exercise the real dynamoHandler logic (what gets
// sent to DynamoDB, what's returned on success/failure) without needing live AWS access.

jest.mock('aws-sdk', () => {
    const documentClient = {
        put: jest.fn(),
        query: jest.fn(),
        update: jest.fn(),
        scan: jest.fn(),
    };
    return {
        config: { update: jest.fn() },
        DynamoDB: { DocumentClient: jest.fn(() => documentClient) },
    };
});

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();
const dynamoHandler = require('../dynamoHandler');
const { Bank, shops, Work } = require('../constants');

const resolved = (value) => ({ promise: () => Promise.resolve(value) });
const rejected = (err) => ({ promise: () => Promise.reject(err) });

beforeEach(() => {
    jest.clearAllMocks();
});

describe('addUser', () => {
    test('never writes webLinkToken on the initial Put (GSI type-mismatch regression)', async () => {
        docClient.put.mockReturnValue(resolved({}));
        await dynamoHandler.addUser('u1', 'name');
        const putItem = docClient.put.mock.calls[0][0].Item;
        expect(putItem).not.toHaveProperty('webLinkToken');
    });

    test('returns the created record on success', async () => {
        docClient.put.mockReturnValue(resolved({}));
        const user = await dynamoHandler.addUser('u1', 'name');
        expect(user).toMatchObject({ userId: 'u1', username: 'name', potatoes: 0 });
    });

    test('returns undefined, not a throw, when the Put fails', async () => {
        docClient.put.mockReturnValue(rejected(new Error('ValidationException')));
        const user = await dynamoHandler.addUser('u1', 'name');
        expect(user).toBeUndefined();
    });

    // Regression: bankCapacity used to default to 0, meaning a brand-new account could not
    // protect a single potato from /rob until their first Bank Shop purchase landed (~44
    // /work calls on average). Bank.STARTING_CAPACITY closes that gap — a fresh account can
    // /bank deposit immediately. bankShop's tier 1 currentAmount MUST equal
    // Bank.STARTING_CAPACITY exactly, or buy.js's getNextItemFromShop (an exact-match
    // lookup) would never find a tier for a fresh account and report "already maxed out!"
    test('grants a non-zero starting bankCapacity that exactly matches bankShop tier 1\'s currentAmount', async () => {
        docClient.put.mockReturnValue(resolved({}));
        const user = await dynamoHandler.addUser('u1', 'name');
        expect(user.bankCapacity).toBe(Bank.STARTING_CAPACITY);
        expect(user.bankCapacity).toBeGreaterThan(0);

        const bankShop = shops.find(s => s.shopId === 'bankShop');
        expect(bankShop.items[0].currentAmount).toBe(Bank.STARTING_CAPACITY);
    });

    // Regression: a brand-new account must default to opted OUT of auto-joining guild
    // raids (matching the old /join-raid's "you must explicitly join" behavior) — an
    // accidental default of true would silently commit every new member's future
    // stats/potatoes to raids they never agreed to participate in.
    test('defaults autoJoinRaids to false', async () => {
        docClient.put.mockReturnValue(resolved({}));
        const user = await dynamoHandler.addUser('u1', 'name');
        expect(user.autoJoinRaids).toBe(false);
    });
});

describe('findUser', () => {
    test('creates and returns a brand-new user immediately instead of null', async () => {
        docClient.query.mockReturnValue(resolved({ Count: 0, Items: [] }));
        docClient.put.mockReturnValue(resolved({}));
        const user = await dynamoHandler.findUser('u2', 'name2');
        expect(user).toBeDefined();
        expect(user.userId).toBe('u2');
        expect(docClient.put).toHaveBeenCalledTimes(1);
    });

    // Regression: findUser backs every "re-fetch right before a critical write" call site
    // in this codebase (companion.js's attemptEquip, rob.js/bank.js/safehouse.js's
    // confirm-button flows, rebirth.js/shop.js, etc.) — the whole point of those re-fetches
    // is to see whatever the most recent write actually landed, not a stale in-memory
    // snapshot. DynamoDB's default eventually-consistent read can occasionally still
    // return a just-superseded item shortly after a different write on the same key, which
    // would silently defeat that "re-fetch fresh" discipline in exactly the same shape as
    // the bug it exists to prevent. This query is against the table's own partition key
    // (userId), not a GSI, so ConsistentRead actually takes effect here.
    test('always requests a strongly consistent read', async () => {
        docClient.query.mockReturnValue(resolved({ Count: 1, Items: [{ userId: 'u2b', username: 'name2b' }] }));
        docClient.update.mockReturnValue(resolved({}));
        await dynamoHandler.findUser('u2b', 'name2b');
        expect(docClient.query.mock.calls[0][0].ConsistentRead).toBe(true);
    });

    test('returns undefined on a genuine lookup error rather than a half-formed user', async () => {
        docClient.query.mockReturnValue(rejected(new Error('boom')));
        const user = await dynamoHandler.findUser('u3', 'name3');
        expect(user).toBeUndefined();
    });

    test('never attempts to heal guildId or webLinkToken on an existing partial record', async () => {
        docClient.query.mockReturnValue(resolved({
            Count: 1,
            Items: [{ userId: 'u4', username: 'name4' }], // missing every other field
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.findUser('u4', 'name4');

        const healedFieldNames = docClient.update.mock.calls
            .map(([params]) => Object.values(params.ExpressionAttributeNames)[0]);
        expect(healedFieldNames).not.toContain('guildId');
        expect(healedFieldNames).not.toContain('webLinkToken');
    });

    // Regression: an account created before workScenarioCounts.companion (and later,
    // .ancient) existed in the schema already has a workScenarioCounts object — so the
    // top-level `user[key] === undefined` check never fires for it — but that object is
    // still missing those sub-keys specifically. workFactory.js's
    // `workScenarioCounts.companion += 1` on such an account produces NaN, which
    // DynamoDB's UpdateItem rejects outright, silently failing that entire write
    // (including the actual companion grant sitting right next to it). This only
    // surfaced when testing companions on an account that predated the feature —
    // findUser has to shallow-heal missing sub-keys of an already-present object, not
    // just missing top-level fields.
    test('shallow-heals missing sub-keys of an already-present nested object (workScenarioCounts.companion/.ancient)', async () => {
        docClient.query.mockReturnValue(resolved({
            Count: 1,
            Items: [{
                userId: 'u5', username: 'name5',
                // Every ORIGINAL workScenarioCounts key present, but companion and
                // ancient (both added to the schema later) are missing — exactly what
                // an account that predates both features looks like.
                workScenarioCounts: { regular: 3, large: 1, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0 },
            }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        const user = await dynamoHandler.findUser('u5', 'name5');

        expect(user.workScenarioCounts.companion).toBe(0);
        expect(user.workScenarioCounts.ancient).toBe(0);
        // The existing counts must survive the heal untouched, not get reset to defaults.
        expect(user.workScenarioCounts.regular).toBe(3);
        expect(user.workScenarioCounts.large).toBe(1);

        const workScenarioCountsWrite = docClient.update.mock.calls.find(
            ([params]) => Object.values(params.ExpressionAttributeNames).includes('workScenarioCounts')
        );
        expect(workScenarioCountsWrite).toBeDefined();
        const writtenValue = Object.values(workScenarioCountsWrite[0].ExpressionAttributeValues)[0];
        expect(writtenValue).toEqual({ regular: 3, large: 1, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, companion: 0, ancient: 0, mimic: 0, goldenYam: 0 });
    });

    test('does not touch a nested object that already has every sub-key', async () => {
        docClient.query.mockReturnValue(resolved({
            Count: 1,
            Items: [{
                userId: 'u6', username: 'name6',
                workScenarioCounts: { regular: 0, large: 0, sweet: 0, taro: 0, poison: 0, metalSuccess: 0, metalFailure: 0, golden: 0, companion: 5, ancient: 0, mimic: 0, goldenYam: 0 },
            }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.findUser('u6', 'name6');

        const healedFieldNames = docClient.update.mock.calls
            .map(([params]) => Object.values(params.ExpressionAttributeNames)[0]);
        expect(healedFieldNames).not.toContain('workScenarioCounts');
    });

    // Regression coverage mirroring the workScenarioCounts.companion case above, for
    // Companion Scavenging's new companions.scavenging sub-field (roadmap #17) — an
    // account that predates this feature already has a `companions` object (owned/
    // active/ownedCount/mythicOwnedCount), so the top-level `user[key] === undefined`
    // check never fires for it; only the one-level-deep nested-object heal catches the
    // missing `scavenging` sub-key.
    test('shallow-heals a pre-existing companions object missing the new scavenging/scavengeReturnsByRarity/maxLevelCount/mythicMaxLevelCount sub-keys', async () => {
        docClient.query.mockReturnValue(resolved({
            Count: 1,
            Items: [{
                userId: 'u7', username: 'name7',
                // Already-migrated owned shape (instanceId present) so this test's write
                // assertions stay focused on the scavenging/scavengeReturnsByRarity heal
                // rather than also tripping the separate per-instance migration step below.
                companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 3 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0 },
            }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        const user = await dynamoHandler.findUser('u7', 'name7');

        expect(user.companions.scavenging).toBeNull();
        expect(user.companions.scavengeReturnsByRarity).toEqual({ legendary: 0, mythic: 0 });
        expect(user.companions.maxLevelCount).toBe(0);
        expect(user.companions.mythicMaxLevelCount).toBe(0);
        // Existing sub-fields must survive the heal untouched.
        expect(user.companions.owned).toEqual([{ instanceId: 'sprout-a', id: 'sprout', workCount: 3 }]);
        expect(user.companions.active).toBe('sprout-a');

        const companionsWrite = docClient.update.mock.calls.find(
            ([params]) => Object.values(params.ExpressionAttributeNames).includes('companions')
        );
        expect(companionsWrite).toBeDefined();
        const writtenValue = Object.values(companionsWrite[0].ExpressionAttributeValues)[0];
        expect(writtenValue).toEqual({
            owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 3 }], active: 'sprout-a', ownedCount: 1, mythicOwnedCount: 0,
            scavenging: null, scavengeReturnsByRarity: { legendary: 0, mythic: 0 }, maxLevelCount: 0, mythicMaxLevelCount: 0
        });
    });

    test('does not touch a companions object that already has every sub-key', async () => {
        docClient.query.mockReturnValue(resolved({
            Count: 1,
            Items: [{
                userId: 'u8', username: 'name8',
                companions: {
                    owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0,
                    scavenging: { instanceId: 'mole-a', rarity: 'rare', returnsAt: 123 }, scavengeReturnsByRarity: { legendary: 2, mythic: 0 },
                    maxLevelCount: 0, mythicMaxLevelCount: 0
                },
            }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.findUser('u8', 'name8');

        const healedFieldNames = docClient.update.mock.calls
            .map(([params]) => Object.values(params.ExpressionAttributeNames)[0]);
        expect(healedFieldNames).not.toContain('companions');
    });

    // Mercenary Bounties — isMercenary/mercenaryBountyWinCount/bountyTimer/npcRobTimer are
    // plain top-level fields, healed like any other top-level field (not an index key, so
    // none of guildId/webLinkToken's special-casing applies).
    test('heals every new Mercenary Bounties top-level field onto a pre-existing account', async () => {
        docClient.query.mockReturnValue(resolved({
            Count: 1,
            Items: [{ userId: 'u9', username: 'name9' }], // missing every other field, including the new Mercenary ones
        }));
        docClient.update.mockReturnValue(resolved({}));

        const user = await dynamoHandler.findUser('u9', 'name9');

        expect(user.isMercenary).toBe(false);
        expect(user.mercenaryBountyWinCount).toBe(0);
        expect(user.bountyTimer).toBe(0);
        expect(user.npcRobTimer).toBe(0);

        const healedFieldNames = docClient.update.mock.calls
            .map(([params]) => Object.values(params.ExpressionAttributeNames)[0]);
        expect(healedFieldNames).toEqual(expect.arrayContaining(['isMercenary', 'mercenaryBountyWinCount', 'bountyTimer', 'npcRobTimer']));
    });

    // records.largestBountyReward nests one level into the already-existing `records`
    // object — same one-level-deep nested healing that already backfills
    // workScenarioCounts.companion/companions.scavenging, so an account with a
    // pre-existing (but now-stale) records object still gets it backfilled without a
    // special case.
    test('shallow-heals records.largestBountyReward onto a pre-existing records object', async () => {
        docClient.query.mockReturnValue(resolved({
            Count: 1,
            Items: [{
                userId: 'u10', username: 'name10',
                records: { highestTowerFloor: 5, biggestWorkPayout: 1000, largestRaidContribution: 2000 },
            }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        const user = await dynamoHandler.findUser('u10', 'name10');

        expect(user.records.largestBountyReward).toBe(0);
        // Existing record values must survive the heal untouched.
        expect(user.records.highestTowerFloor).toBe(5);
        expect(user.records.biggestWorkPayout).toBe(1000);
        expect(user.records.largestRaidContribution).toBe(2000);

        const recordsWrite = docClient.update.mock.calls.find(
            ([params]) => Object.values(params.ExpressionAttributeNames).includes('records')
        );
        expect(recordsWrite).toBeDefined();
    });
});

// Companion Scavenging's collect/cancel race guard (roadmap #17) — same
// ConditionExpression-on-the-write shape as claimDailyStreak/updateIfNewRecord, so two
// near-simultaneous collect/cancel calls for the same scavenge can't both land.
describe('resolveScavenge', () => {
    test('conditions the write on companions.scavenging.instanceId matching the caller-supplied id', async () => {
        docClient.update.mockReturnValue(resolved({}));
        const result = await dynamoHandler.resolveScavenge('u1', 'sprout-a', { starches: 42 });

        expect(result).toBe(true);
        const params = docClient.update.mock.calls[0][0];
        expect(params.ConditionExpression).toBe('companions.scavenging.instanceId = :instanceId');
        expect(params.ExpressionAttributeValues[':instanceId']).toBe('sprout-a');
        expect(params.Key).toEqual({ userId: 'u1' });
    });

    test('writes every setAttributes field passed in', async () => {
        docClient.update.mockReturnValue(resolved({}));
        await dynamoHandler.resolveScavenge('u1', 'sprout-a', {
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 18 }], active: null, ownedCount: 1, mythicOwnedCount: 0, scavenging: null },
            starches: 100
        });

        const params = docClient.update.mock.calls[0][0];
        const setValues = Object.entries(params.ExpressionAttributeNames)
            .reduce((acc, [nameKey, fieldName]) => ({ ...acc, [fieldName]: params.ExpressionAttributeValues[nameKey.replace('#', ':')] }), {});
        expect(setValues.starches).toBe(100);
        expect(setValues.companions.scavenging).toBeNull();
    });

    test('returns false (not a throw) when the race was already lost — e.g. a near-simultaneous collect and cancel', async () => {
        const conditionalFailure = new Error('The conditional request failed');
        conditionalFailure.code = 'ConditionalCheckFailedException';
        docClient.update.mockReturnValue(rejected(conditionalFailure));

        const result = await dynamoHandler.resolveScavenge('u1', 'sprout', { starches: 42 });
        expect(result).toBe(false);
    });

    test('returns false without writing when setAttributes is empty', async () => {
        const result = await dynamoHandler.resolveScavenge('u1', 'sprout', {});
        expect(result).toBe(false);
        expect(docClient.update).not.toHaveBeenCalled();
    });
});

// Spud Keep pot payout collection (systems/spud-keep.md) — resolveCycle only ever credits
// spudKeepPendingPotatoes via an atomic ADD, never potatoes directly (a lump sum landing
// straight in a winner's liquid balance the instant the cycle resolves would make every
// daily reset a guaranteed rob target). collectSpudKeepReward is the only path that ever
// moves that balance into spendable/robbable potatoes, and only when the player themselves
// runs /spud-keep-collect. Same conditional-write race guard as resolveScavenge above —
// two concurrent collects reading the same pre-collect balance must not both succeed.
describe('collectSpudKeepReward', () => {
    test('moves the given amount from spudKeepPendingPotatoes into potatoes/totalEarnings, conditioned on the balance actually covering it', async () => {
        docClient.update.mockReturnValue(resolved({}));
        const result = await dynamoHandler.collectSpudKeepReward('u1', 500);

        expect(result).toBe(true);
        const params = docClient.update.mock.calls[0][0];
        expect(params.Key).toEqual({ userId: 'u1' });
        expect(params.UpdateExpression).toBe('add potatoes :amount, totalEarnings :amount, spudKeepPendingPotatoes :negAmount');
        expect(params.ConditionExpression).toBe('spudKeepPendingPotatoes >= :amount');
        expect(params.ExpressionAttributeValues).toEqual({ ':amount': 500, ':negAmount': -500 });
    });

    test('returns false (not a throw) when a concurrent collect already spent the balance', async () => {
        const conditionalFailure = new Error('The conditional request failed');
        conditionalFailure.code = 'ConditionalCheckFailedException';
        docClient.update.mockReturnValue(rejected(conditionalFailure));

        const result = await dynamoHandler.collectSpudKeepReward('u1', 500);
        expect(result).toBe(false);
    });
});

// Regression coverage for the guild memberList/inviteList race: every guild command
// that mutates one of these lists reads the whole guild, mutates locally, and writes
// the whole list back with no locking, so two near-simultaneous mutations (two invitees
// joining at once, a kick racing a promote, etc.) could silently clobber each other.
// updateGuildFieldsWithLock conditions the write on the guildVersion the caller actually
// read so a lost race is rejected instead of overwriting someone else's change.
describe('updateGuildFieldsWithLock', () => {
    test('writes the new fields and bumps guildVersion, conditioned on the version the caller read', async () => {
        docClient.update.mockReturnValue(resolved({}));
        const result = await dynamoHandler.updateGuildFieldsWithLock('g1', 3, { memberList: [{ id: 'u1' }] });

        expect(result).toBe(true);
        const params = docClient.update.mock.calls[0][0];
        expect(params.ConditionExpression).toBe('attribute_not_exists(guildVersion) OR guildVersion = :expectedVersion');
        expect(params.ExpressionAttributeValues[':expectedVersion']).toBe(3);
        const setValues = Object.entries(params.ExpressionAttributeNames)
            .reduce((acc, [nameKey, fieldName]) => ({ ...acc, [fieldName]: params.ExpressionAttributeValues[nameKey.replace('#', ':')] }), {});
        expect(setValues.memberList).toEqual([{ id: 'u1' }]);
        expect(setValues.guildVersion).toBe(4);
    });

    test('treats a missing expectedVersion (guild record predating this field) as 0', async () => {
        docClient.update.mockReturnValue(resolved({}));
        await dynamoHandler.updateGuildFieldsWithLock('g1', undefined, { inviteList: [] });

        const params = docClient.update.mock.calls[0][0];
        expect(params.ExpressionAttributeValues[':expectedVersion']).toBe(0);
    });

    test('returns false (not a throw) when another write already changed the guild in between', async () => {
        const conditionalFailure = new Error('The conditional request failed');
        conditionalFailure.code = 'ConditionalCheckFailedException';
        docClient.update.mockReturnValue(rejected(conditionalFailure));

        const result = await dynamoHandler.updateGuildFieldsWithLock('g1', 3, { memberList: [] });
        expect(result).toBe(false);
    });
});

// Regression coverage for guild bank capacity's tier-alignment bug: a fresh guild's
// starting bankCapacity (1,000,000) doesn't match any guildShops bankCapacity tier's
// currentAmount, and guildBuy.js's getNextItemFromShop is an exact-match lookup — so
// every brand-new guild's first /guild-buy bank-capacity reported "already maxed out!"
// with zero purchases made. bankCapacityBonus (mirroring sweetPotatoBuffs.bankCapacity
// on the user table) exists so guildBuy.js can back out a BASE value (bankCapacity -
// bankCapacityBonus) that lands exactly on tier 0's currentAmount (0) instead.
describe('getDefaultGuildFields (via createGuild)', () => {
    test('starting bankCapacity and bankCapacityBonus are equal, so BASE bankCapacity is exactly 0', async () => {
        docClient.put.mockReturnValue(resolved({}));
        await dynamoHandler.createGuild('g1', 'Test Guild', 'leader1', 'leaderName', 'thumb.png');
        const putItem = docClient.put.mock.calls[0][0].Item;
        expect(putItem.bankCapacity).toBe(putItem.bankCapacityBonus);
        expect(putItem.bankCapacity - putItem.bankCapacityBonus).toBe(0);
    });
});

// Guild treasury interest: a daily % of bankStored, scaled by member count, applied
// fractionally every 5-minute tick (see Bank.GUILD_TREASURY_DAILY_RATE_PER_MEMBER).
describe('applyGuildTreasuryInterest', () => {
    test('credits interest scaled by member count, never past bankCapacity', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 1000000, bankCapacity: 5000000, memberList: [{ id: 'a' }, { id: 'b' }] }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        // dailyRate = .001 * 2 members = .002; per-tick = 1,000,000 * .002 / 288 ≈ 6.94 → rounds to 7
        const params = docClient.update.mock.calls[0][0];
        expect(params.Key.guildId).toBe('g1');
        const newValue = Object.values(params.ExpressionAttributeValues)[0];
        expect(newValue).toBe(1000007);
    });

    test('caps the credited amount so bankStored never exceeds bankCapacity', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 4999999, bankCapacity: 5000000, memberList: Array.from({ length: 25 }, (_, i) => ({ id: `m${i}` })) }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        const params = docClient.update.mock.calls[0][0];
        const newValue = Object.values(params.ExpressionAttributeValues)[0];
        expect(newValue).toBe(5000000);
    });

    test('skips guilds with nothing stored — an empty treasury earns no interest', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 0, bankCapacity: 5000000, memberList: [{ id: 'a' }] }],
        }));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        expect(docClient.update).not.toHaveBeenCalled();
    });

    test('skips a guild whose per-tick interest rounds to 0 rather than writing a no-op', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 100, bankCapacity: 5000000, memberList: [{ id: 'a' }] }],
        }));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        expect(docClient.update).not.toHaveBeenCalled();
    });

    // Cinderroot, the Hoardwarden's perk 3c (see systems/guilds.md's "Guild Raid
    // Companion" design) — a flat rate bump on top of the base per-member daily rate for
    // any guild that owns the companion. getGuilds() is a raw scanAll (unhealed), so
    // guildCompanion can be undefined on a never-healed record as well as null on a
    // healed-but-never-won one — both must be treated identically (no bump), only a
    // real object should bump the rate.
    test('credits the bumped rate for a guild that owns the companion vs. the base rate for one without', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [
                { guildId: 'g1', bankStored: 1000000, bankCapacity: 5000000, memberList: [{ id: 'a' }, { id: 'b' }], guildCompanion: { id: 'cinderroot', acquiredAt: 1, acquiredRaidTier: 'regular' } },
                { guildId: 'g2', bankStored: 1000000, bankCapacity: 5000000, memberList: [{ id: 'a' }, { id: 'b' }], guildCompanion: null },
            ],
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        const updateByGuildId = Object.fromEntries(docClient.update.mock.calls.map(([params]) => [params.Key.guildId, Object.values(params.ExpressionAttributeValues)[0]]));
        // g1 (owns companion): dailyRate = (.001 + .0002) * 2 = .0024; per-tick = 1,000,000 * .0024 / 288 ≈ 8.33 -> 8
        expect(updateByGuildId.g1).toBe(1000008);
        // g2 (no companion): dailyRate = .001 * 2 = .002; per-tick = 1,000,000 * .002 / 288 ≈ 6.94 -> 7
        expect(updateByGuildId.g2).toBe(1000007);
    });

    // Never-healed record (guildCompanion undefined, not null) must be treated identically
    // to "healed, never won one" — see systems/guilds.md's loose `!= null` caveat.
    test('treats an unhealed record (guildCompanion undefined) the same as never owning one', async () => {
        docClient.scan.mockReturnValue(resolved({
            Items: [{ guildId: 'g1', bankStored: 1000000, bankCapacity: 5000000, memberList: [{ id: 'a' }, { id: 'b' }] }],
        }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.applyGuildTreasuryInterest(288);

        const newValue = Object.values(docClient.update.mock.calls[0][0].ExpressionAttributeValues)[0];
        expect(newValue).toBe(1000007);
    });
});

// Cinderroot, the Hoardwarden — guildCompanion self-heals to null for a guild record that
// predates this feature (see systems/guilds.md's "Guild Raid Companion" design, section 1).
// Mirrors findUser's own healing test convention above.
describe('findGuildById self-healing', () => {
    test('backfills a missing guildCompanion field to null on an existing guild record', async () => {
        const existingGuild = {
            guildId: 'g1', guildName: 'Test Guild', guildNameLowercase: 'test guild',
            memberCap: 5, memberList: [{ id: 'leader', username: 'Leader', role: 'Leader' }],
            bankCapacity: 1000000, bankCapacityBonus: 1000000, bankStored: 0,
            raidCount: 0, thumbnailUrl: 'thumb.png', raidTimer: 0, inviteList: [],
            guildBuff: 'workMulti', raidSplitMode: 'even', raidPayoutMode: 'bank',
            guildVersion: 0,
            guildContract: { templateId: null, rotationDate: null, memberBaselines: {}, frozenContribution: 0, completed: false },
            raidHistory: [], contractHistory: []
            // guildCompanion intentionally missing — predates this feature
        };
        docClient.query.mockReturnValue(resolved({ Items: [existingGuild] }));
        docClient.update.mockReturnValue(resolved({}));

        const guild = await dynamoHandler.findGuildById('g1');

        expect(guild.guildCompanion).toBeNull();
        const healedFieldNames = docClient.update.mock.calls
            .map(([params]) => Object.values(params.ExpressionAttributeNames)[0]);
        expect(healedFieldNames).toContain('guildCompanion');
    });
});

describe('calculateWorkTimerValue', () => {
    // Fieldmouse's workCooldownSkipChance — a real companion perk rather than a mock, so
    // this exercises the actual companionFactory.getActivePerkValue/getActiveCompanion
    // lookups, not a stand-in.
    const userWithFieldmouse = () => ({
        companions: { owned: [{ instanceId: 'fieldmouse-a', id: 'fieldmouse', workCount: 0 }], active: 'fieldmouse-a' }
    });

    afterEach(() => {
        Math.random.mockRestore();
    });

    test('a standard-length cooldown IS skippable on a companion proc', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0); // well below any skipChance
        const userDetails = userWithFieldmouse();

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThan(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toBe('fieldmouse');
    });

    // Regression test: a non-immune Poison Potato hit passes its own elevated
    // lockoutSeconds (workFactory.js's handlePoisonPotato), which must never be skippable
    // — previously a companion's workCooldownSkipChance proc on a poisoned call collapsed
    // the real lockout down to "ready now" and chained an immediate extra /work call,
    // whose own normal 5-minute cooldown was the last write to land, so the player saw a
    // bare 5-minute wait after being poisoned instead of the real, longer punishment.
    test('an elevated (non-standard) cooldown, like a Poison Potato lockout, is NEVER skipped even on a companion proc', async () => {
        jest.spyOn(Math, 'random').mockReturnValue(0); // would have skipped a standard cooldown
        const userDetails = userWithFieldmouse();
        const poisonLockoutSeconds = Work.POISON_POTATO_TIMER_INCREASE_SECONDS;

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, poisonLockoutSeconds);

        expect(result).toBeGreaterThanOrEqual(before + poisonLockoutSeconds * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toBeUndefined();
        // Never even rolled for a non-standard cooldown, so there's no % to report either
        // — see createPoisonPotatoEmbed's own missedCooldownSkipChance handling.
        expect(userDetails._cooldownSkipChance).toBeUndefined();
    });

    // Griseous's World Boss buff (systems/raids-and-world-events.md#server-wide-buff) — a
    // second, independent roll reached only once the companion roll (if any) has already
    // missed. Reuses _cooldownSkippedByCompanion (an object here, not a companion id
    // string) specifically so work.js's chain-continuation check keeps working unchanged.
    test('a standard-length cooldown is also skippable on a live World Boss cooldownSkip buff proc, with no companion equipped', async () => {
        docClient.query.mockReturnValue(resolved({
            Items: [{ trackingId: 'world_buff', bossName: 'Griseous, the Dragon Fruit', buffType: 'cooldownSkip', value: 0.05, expiresAt: Date.now() + 3600000 }]
        }));
        jest.spyOn(Math, 'random').mockReturnValue(0); // well below the buff's own value
        const userDetails = {}; // no companion at all

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThan(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toEqual({ worldBuffBossName: 'Griseous, the Dragon Fruit' });
    });

    test('an EXPIRED World Boss cooldownSkip buff is never rolled — cooldown proceeds normally', async () => {
        docClient.query.mockReturnValue(resolved({
            Items: [{ trackingId: 'world_buff', bossName: 'Griseous, the Dragon Fruit', buffType: 'cooldownSkip', value: 0.05, expiresAt: Date.now() - 1000 }]
        }));
        jest.spyOn(Math, 'random').mockReturnValue(0); // would have skipped a live buff
        const userDetails = {};

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toBeUndefined();
    });

    test('a live buff of a DIFFERENT type (e.g. workMulti) never triggers a cooldown skip', async () => {
        docClient.query.mockReturnValue(resolved({
            Items: [{ trackingId: 'world_buff', bossName: 'Thunderlord Raikon', buffType: 'workMulti', value: 0.10, expiresAt: Date.now() + 3600000 }]
        }));
        jest.spyOn(Math, 'random').mockReturnValue(0);
        const userDetails = {};

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toBeUndefined();
    });
});

describe('World Boss buff (getActiveWorldBuff / setActiveWorldBuff / isWorldBuffLive)', () => {
    test('getActiveWorldBuff reads the world_buff stats doc', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [{ trackingId: 'world_buff', buffType: 'workMulti', value: 0.10 }] }));
        const buff = await dynamoHandler.getActiveWorldBuff();
        expect(docClient.query).toHaveBeenCalledWith(expect.objectContaining({
            ExpressionAttributeValues: { ':trackingId': 'world_buff' }
        }));
        expect(buff).toEqual({ trackingId: 'world_buff', buffType: 'workMulti', value: 0.10 });
    });

    test('setActiveWorldBuff writes to the world_buff stats doc', async () => {
        docClient.update.mockReturnValue(resolved({}));
        const buff = { bossName: 'Yamsalot, the Iron Yam', buffType: 'starchDiscount', value: 0.10, expiresAt: 123 };
        await dynamoHandler.setActiveWorldBuff(buff);
        const [params] = docClient.update.mock.calls[0];
        expect(params.Key).toEqual({ trackingId: 'world_buff' });
    });

    test('isWorldBuffLive: true only for a matching, not-yet-expired buff', () => {
        const future = Date.now() + 60000, past = Date.now() - 60000;
        expect(dynamoHandler.isWorldBuffLive({ buffType: 'workMulti', expiresAt: future }, 'workMulti')).toBe(true);
        expect(dynamoHandler.isWorldBuffLive({ buffType: 'workMulti', expiresAt: past }, 'workMulti')).toBe(false);
        expect(dynamoHandler.isWorldBuffLive({ buffType: 'cooldownSkip', expiresAt: future }, 'workMulti')).toBe(false);
        expect(dynamoHandler.isWorldBuffLive(null, 'workMulti')).toBe(false);
        expect(dynamoHandler.isWorldBuffLive(undefined, 'workMulti')).toBe(false);
    });
});

// Spud Keep (systems/spud-keep.md) — spud_keep_buff/spud_keep_cooldown_buff mirror
// world_buff's own get/set shape exactly.
describe('Spud Keep buff docs (getActiveSpudKeepBuff / setActiveSpudKeepBuff / getActiveSpudKeepCooldownBuff / setActiveSpudKeepCooldownBuff)', () => {
    test('getActiveSpudKeepBuff reads the spud_keep_buff stats doc', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [{ trackingId: 'spud_keep_buff', holderType: 'guild', holderId: 'g1', buffType: 'passiveIncome', value: 0.06 }] }));
        const buff = await dynamoHandler.getActiveSpudKeepBuff();
        expect(docClient.query).toHaveBeenCalledWith(expect.objectContaining({
            ExpressionAttributeValues: { ':trackingId': 'spud_keep_buff' }
        }));
        expect(buff.holderType).toBe('guild');
    });

    test('setActiveSpudKeepBuff writes to the spud_keep_buff stats doc', async () => {
        docClient.update.mockReturnValue(resolved({}));
        await dynamoHandler.setActiveSpudKeepBuff({ holderType: 'mercenary', holderId: null, buffType: 'passiveIncome', value: 0.06, expiresAt: 123, consecutiveHoldCycles: 0 });
        const [params] = docClient.update.mock.calls[0];
        expect(params.Key).toEqual({ trackingId: 'spud_keep_buff' });
    });

    test('getActiveSpudKeepCooldownBuff reads the spud_keep_cooldown_buff stats doc', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [{ trackingId: 'spud_keep_cooldown_buff', holderType: 'guild', holderId: 'g1', buffType: 'cooldownReduction', value: 0.08 }] }));
        const buff = await dynamoHandler.getActiveSpudKeepCooldownBuff();
        expect(docClient.query).toHaveBeenCalledWith(expect.objectContaining({
            ExpressionAttributeValues: { ':trackingId': 'spud_keep_cooldown_buff' }
        }));
        expect(buff.buffType).toBe('cooldownReduction');
    });

    test('setActiveSpudKeepCooldownBuff writes to the spud_keep_cooldown_buff stats doc', async () => {
        docClient.update.mockReturnValue(resolved({}));
        await dynamoHandler.setActiveSpudKeepCooldownBuff({ holderType: 'guild', holderId: 'g1', buffType: 'cooldownReduction', value: 0.08, expiresAt: 123 });
        const [params] = docClient.update.mock.calls[0];
        expect(params.Key).toEqual({ trackingId: 'spud_keep_cooldown_buff' });
    });
});

// addStatFields (systems/spud-keep.md) — the first real consumer of buildUpdateExpression's
// own already-existing-but-previously-unused `addAttributes` parameter for the stats table.
describe('addStatFields', () => {
    test('issues an ADD UpdateExpression against the given trackingId', async () => {
        docClient.update.mockReturnValue(resolved({}));
        await dynamoHandler.addStatFields('spud_keep', { potPotatoes: 500 });
        const [params] = docClient.update.mock.calls[0];
        expect(params.TableName).toBe('leash-gromp-stats');
        expect(params.Key).toEqual({ trackingId: 'spud_keep' });
        expect(params.UpdateExpression).toBe('add #a0 :a0');
        expect(params.ExpressionAttributeValues[':a0']).toBe(500);
    });

    test('a negative amount subtracts via the same ADD expression (step 8\'s exact-payout subtraction)', async () => {
        docClient.update.mockReturnValue(resolved({}));
        await dynamoHandler.addStatFields('spud_keep', { potPotatoes: -500 });
        const [params] = docClient.update.mock.calls[0];
        expect(params.ExpressionAttributeValues[':a0']).toBe(-500);
    });

    test('an empty addAttributes object never issues a write', async () => {
        await dynamoHandler.addStatFields('spud_keep', {});
        expect(docClient.update).not.toHaveBeenCalled();
    });
});

// Spud Keep's passive-income half (systems/spud-keep.md) — folds additively into
// passivePotatoHandler's per-user passive gain, gated per-user by
// spudKeepFactory.isSpudKeepBuffLiveForUser (guildId/isMercenary), unlike the World Boss
// buff above which is free for everyone.
describe('passivePotatoHandler Spud Keep passive term', () => {
    test('a live guild-holder buff boosts only a member of the exact holding guild', async () => {
        const memberOfHolder = { userId: 'u1', guildId: 'g1', passiveAmount: 1000, bankStored: 0, totalEarnings: 0, potatoes: 0, starches: 0, workCount: 1 };
        const outsider = { userId: 'u2', guildId: 'g2', passiveAmount: 1000, bankStored: 0, totalEarnings: 0, potatoes: 0, starches: 0, workCount: 1 };
        docClient.scan.mockReturnValue(resolved({ Items: [memberOfHolder, outsider] }));
        docClient.query.mockReturnValue(resolved({ Items: [{ trackingId: 'spud_keep_buff', holderType: 'guild', holderId: 'g1', buffType: 'passiveIncome', value: 0.06, expiresAt: Date.now() + 60000 }] }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.passivePotatoHandler(288);

        const memberUpdate = docClient.update.mock.calls.find(([params]) => params.Key.userId === 'u1');
        const outsiderUpdate = docClient.update.mock.calls.find(([params]) => params.Key.userId === 'u2');
        expect(memberUpdate[0].ExpressionAttributeValues[':bankStored']).toBe(Math.round(1000 * 1.06 / 288));
        expect(outsiderUpdate[0].ExpressionAttributeValues[':bankStored']).toBe(Math.round(1000 / 288));
    });
});

// Spud Keep's cooldown-skip half (systems/spud-keep.md) — a flat holder-wide chance folded
// into calculateWorkTimerValue's single combined roll (cooldown-skip overhaul, 2026-09-05)
// rather than a deterministic reduction — see the cooldownFactory tests for the combine/roll
// math itself; these confirm the real wiring (guild lookup + attribution shape).
describe('calculateWorkTimerValue Spud Keep cooldown term', () => {
    let randomSpy;
    afterEach(() => { if (randomSpy) randomSpy.mockRestore(); });

    test('a live guild-holder cooldown buff can skip a member\'s /work cooldown entirely on a hit', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [{ trackingId: 'spud_keep_cooldown_buff', holderType: 'guild', holderId: 'g1', buffType: 'cooldownReduction', value: 0.08, expiresAt: Date.now() + 60000 }] }));
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // well below 0.08
        const userDetails = { guildId: 'g1' };

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThan(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toEqual({ source: 'spudKeep' });
    });

    test('a live guild-holder cooldown buff leaves the FULL cooldown on a miss (no partial reduction), but stamps the % chance that was rolled', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [{ trackingId: 'spud_keep_cooldown_buff', holderType: 'guild', holderId: 'g1', buffType: 'cooldownReduction', value: 0.08, expiresAt: Date.now() + 60000 }] }));
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // well above 0.08
        const userDetails = { guildId: 'g1' };

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toBeUndefined();
        // 2026-09-05, player-reported: a miss should still stamp the % chance that was
        // rolled (_cooldownSkipChance) so work.js can show it on the result embed instead
        // of leaving the player wondering whether they even had a real shot.
        expect(userDetails._cooldownSkipChance).toBeCloseTo(0.08);
    });

    test('a live buff held by a DIFFERENT guild never rolls a skip for this user', async () => {
        docClient.query.mockReturnValue(resolved({ Items: [{ trackingId: 'spud_keep_cooldown_buff', holderType: 'guild', holderId: 'g1', buffType: 'cooldownReduction', value: 0.08, expiresAt: Date.now() + 60000 }] }));
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0); // would have hit if it applied
        const userDetails = { guildId: 'g2' };

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toBeUndefined();
    });
});

// Guild's own selected workTimer buff — same conversion, same combined roll.
describe('calculateWorkTimerValue guild workTimer buff', () => {
    let randomSpy;
    afterEach(() => { if (randomSpy) randomSpy.mockRestore(); });

    function mockGuildQuery(guildBuff) {
        docClient.query.mockImplementation((params) => {
            if (params.ExpressionAttributeValues && ':guildId' in params.ExpressionAttributeValues) {
                return resolved({ Items: [{ guildId: 'g1', guildName: 'Spud Squad', guildBuff, raidCount: 0 }] });
            }
            return resolved({ Items: [] }); // no world buff, no Spud Keep buff live
        });
    }

    test('a guild with the workTimer buff selected can skip a member\'s cooldown on a hit', async () => {
        mockGuildQuery('workTimer');
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const userDetails = { guildId: 'g1' };

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThan(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toEqual({ source: 'guildBuff', label: 'Spud Squad' });
    });

    test('a guild with a DIFFERENT buff selected never rolls a workTimer skip', async () => {
        mockGuildQuery('robChance');
        randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
        const userDetails = { guildId: 'g1' };

        const before = Date.now();
        const result = await dynamoHandler.calculateWorkTimerValue(userDetails, Work.WORK_TIMER_SECONDS);

        expect(result).toBeGreaterThanOrEqual(before + Work.WORK_TIMER_SECONDS * 1000);
        expect(userDetails._cooldownSkippedByCompanion).toBeUndefined();
    });
});

// Brassica's passiveBoost buff (systems/raids-and-world-events.md#server-wide-buff) folds
// additively into passivePotatoHandler's per-user passive gain, same site as
// passiveIncomePercent/rebirthPercent.
describe('passivePotatoHandler world buff term', () => {
    const baseUser = { userId: 'u1', passiveAmount: 1000, bankStored: 0, totalEarnings: 0, potatoes: 0, starches: 0, workCount: 1 };

    test('a live passiveBoost buff adds its value on top of the normal passive gain', async () => {
        docClient.scan.mockReturnValue(resolved({ Items: [baseUser] }));
        docClient.query.mockReturnValue(resolved({ Items: [{ trackingId: 'world_buff', buffType: 'passiveBoost', value: 0.10, expiresAt: Date.now() + 60000 }] }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.passivePotatoHandler(288); // 288 = ticks/day at the real 5-minute cadence

        const [updateParams] = docClient.update.mock.calls[0];
        expect(updateParams.ExpressionAttributeValues[':bankStored']).toBe(Math.round(1000 * 1.10 / 288));
    });

    test('an expired or absent buff leaves the passive gain unboosted', async () => {
        docClient.scan.mockReturnValue(resolved({ Items: [baseUser] }));
        docClient.query.mockReturnValue(resolved({ Items: [] }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.passivePotatoHandler(288);

        const [updateParams] = docClient.update.mock.calls[0];
        expect(updateParams.ExpressionAttributeValues[':bankStored']).toBe(Math.round(1000 / 288));
    });
});

// Passive-pet leveling (2026-08-30) — companionFactory.applyPassiveCompanionTick ticked
// once per user per 5-minute cycle for whoever has a passiveIncomePercent companion
// equipped (Rootcarver/Elder Rootbeard/Mochi). tickSeconds is derived from timesInADay
// itself (86400/288 = 300s) rather than a second hardcoded constant.
describe('passivePotatoHandler passive-pet leveling', () => {
    test('a live Rootcarver (passiveIncomePercent) gains time-based workCount via a second write', async () => {
        const user = {
            userId: 'u1', passiveAmount: 1000, bankStored: 0, totalEarnings: 0, potatoes: 0, starches: 0, workCount: 1,
            companions: { owned: [{ instanceId: 'rootcarver-a', id: 'rootcarver', workCount: 10, passiveLevelAccumulatorSeconds: 300 }], active: 'rootcarver-a' }
        };
        docClient.scan.mockReturnValue(resolved({ Items: [user] }));
        docClient.query.mockReturnValue(resolved({ Items: [] }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.passivePotatoHandler(288);

        // The bankStored/totalEarnings write is always first, then the companions write
        // (only fired when applyPassiveCompanionTick actually changes something); a third
        // call is the trailing updateStatFields("economy", ...) write, unrelated here.
        expect(docClient.update).toHaveBeenCalledTimes(3);
        const [companionsParams] = docClient.update.mock.calls[1];
        const updatedCompanions = companionsParams.ExpressionAttributeValues[':s0'];
        // 300 (existing accumulator) + 300 (this tick) = 600 >= 450 -> +1 workCount, 150 remainder.
        expect(updatedCompanions.owned[0].workCount).toBe(11);
        expect(updatedCompanions.owned[0].passiveLevelAccumulatorSeconds).toBe(150);
    });

    test('a user with no passive-perk companion equipped gets no second write', async () => {
        const user = {
            userId: 'u1', passiveAmount: 1000, bankStored: 0, totalEarnings: 0, potatoes: 0, starches: 0, workCount: 1,
            companions: { owned: [{ instanceId: 'sprout-a', id: 'sprout', workCount: 5 }], active: 'sprout-a' }
        };
        docClient.scan.mockReturnValue(resolved({ Items: [user] }));
        docClient.query.mockReturnValue(resolved({ Items: [] }));
        docClient.update.mockReturnValue(resolved({}));

        await dynamoHandler.passivePotatoHandler(288);

        // Just the bankStored/totalEarnings write plus the trailing economy stat write —
        // no companions write, since this user has nothing to level passively.
        expect(docClient.update).toHaveBeenCalledTimes(2);
    });
});

// Mercenary Leaderboard (2026-08-31) — live full-scan + sort, exact mirror of
// getSortedGuildsByLevelAndRaidCount's own shape. Filtered to mercenaryBountyWinCount > 0
// (not isMercenary === true) since /retire-mercenary leaves the win count untouched while
// flipping isMercenary to false — a retired champion must still show up on their own
// leaderboard.
describe('getSortedMercenariesByBountyWins', () => {
    test('sorts descending by mercenaryBountyWinCount', async () => {
        const users = [
            { userId: 'u1', username: 'Low', mercenaryBountyWinCount: 5, isMercenary: true },
            { userId: 'u2', username: 'High', mercenaryBountyWinCount: 50, isMercenary: true },
            { userId: 'u3', username: 'Mid', mercenaryBountyWinCount: 20, isMercenary: true },
        ];
        docClient.scan.mockReturnValue(resolved({ Items: users }));

        const sorted = await dynamoHandler.getSortedMercenariesByBountyWins();

        expect(sorted.map(u => u.userId)).toEqual(['u2', 'u3', 'u1']);
    });

    test('excludes users with mercenaryBountyWinCount 0 or unset (never a mercenary)', async () => {
        const users = [
            { userId: 'u1', username: 'NeverMerc', mercenaryBountyWinCount: 0, isMercenary: false },
            { userId: 'u2', username: 'NoFieldAtAll' },
            { userId: 'u3', username: 'RealMerc', mercenaryBountyWinCount: 3, isMercenary: true },
        ];
        docClient.scan.mockReturnValue(resolved({ Items: users }));

        const sorted = await dynamoHandler.getSortedMercenariesByBountyWins();

        expect(sorted.map(u => u.userId)).toEqual(['u3']);
    });

    // The whole reason for filtering on the win count rather than isMercenary — a retired
    // mercenary's win count is explicitly left untouched by /retire-mercenary.
    test('includes a retired mercenary (isMercenary: false) as long as their win count is still > 0', async () => {
        const users = [
            { userId: 'u1', username: 'Retired', mercenaryBountyWinCount: 40, isMercenary: false },
        ];
        docClient.scan.mockReturnValue(resolved({ Items: users }));

        const sorted = await dynamoHandler.getSortedMercenariesByBountyWins();

        expect(sorted.map(u => u.userId)).toEqual(['u1']);
    });
});
