// Atomic stat-write helpers (2026-10-11, base-drift refactor — see .claude/roadmap.md's
// "Atomic stat writes" entry and systems/economy-and-work.md).
//
// Every stat a player grinds (workMultiplierAmount, passiveAmount, bankCapacity) is stored
// as three coupled numbers: the raw total, `sweetPotatoBuffs[stat]` (the permanent earned
// bonus) and `regrades[track].regradeAmount`. A player's "base shop tier" is DERIVED as
// raw - sweet - regrade (rebirthFactory.getBaseValue), so those three must always move
// together. They used to be written as absolute SETs computed from a snapshot read earlier
// in the command (raw = snapshot.raw + x, sweetPotatoBuffs = the whole stale object) — and
// DynamoDB has no version check on those writes, so two overlapping commands (a /regrade
// landing inside a /work chain's long read-to-write window, a Tower payout racing a shop
// buy, ...) silently overwrote each other's raw increment but not each other's sweet/
// regrade increment. Raw ended up short of sweet + regrade, base sat below its real shop
// tier, and healBaseDrift then demoted the player a whole tier.
//
// The fix is to never write an absolute value for any of the three: every grant is an
// atomic ADD of the same increment to each coupled field, in ONE UpdateItem call
// (dynamoHandler.buildUpdateExpression understands the dotted nested paths below).
// Increments commute, so any interleaving of any number of writers lands on the same
// total — the coupling invariant can no longer be broken by timing.

const REGRADE_KEY = {
    workMultiplierAmount: 'workMulti',
    passiveAmount: 'passiveAmount',
    bankCapacity: 'bankCapacity'
};

const TRACKED_STATS = Object.keys(REGRADE_KEY);

// A grant of `amount` to `statType` that also counts as a permanent earned bonus (Tower,
// raids, Sweet/Metal Potato, quests, bounty/heist grants, ...) — raw and sweet move together.
function statGrantAdds(statType, amount) {
    return {
        [statType]: amount,
        [`sweetPotatoBuffs.${statType}`]: amount
    };
}

// A successful regrade (or Ancient Potato's free regrade step) — raw and regradeAmount move
// together, sweet untouched. failStack resets via a SET on its own leaf path (not
// overlapping the ADD on regradeAmount, so both fit in one expression).
function regradeSuccessWrites(statType, increase) {
    const key = REGRADE_KEY[statType];
    return {
        adds: {
            [statType]: increase,
            [`regrades.${key}.regradeAmount`]: increase
        },
        sets: {
            [`regrades.${key}.failStack`]: 0
        }
    };
}

// A failed regrade attempt only grows failStack.
function regradeFailAdds(statType, failStackIncrease) {
    return { [`regrades.${REGRADE_KEY[statType]}.failStack`]: failStackIncrease };
}

// Sums any number of add-maps key by key (a /work chain accumulates one per link, a Tower
// payout builds one per reward type).
function mergeAdds(...addMaps) {
    const merged = {};
    for (const adds of addMaps) {
        for (const [key, amount] of Object.entries(adds || {})) {
            merged[key] = (merged[key] || 0) + amount;
        }
    }
    return merged;
}

function setAtPath(target, path, value) {
    const segments = path.split('.');
    let node = target;
    for (let i = 0; i < segments.length - 1; i++) {
        if (node[segments[i]] === undefined || node[segments[i]] === null) node[segments[i]] = {};
        node = node[segments[i]];
    }
    node[segments[segments.length - 1]] = value;
}

function getAtPath(target, path) {
    return path.split('.').reduce((node, segment) => (node === undefined || node === null ? undefined : node[segment]), target);
}

// Mirrors an add-map onto the in-memory userDetails object — the same increments the
// database write applies — so later code in the same command (embeds, once-per-chain
// checks, the next link of a /work chain) sees the real result without a re-fetch.
function applyAddsInMemory(userDetails, adds) {
    for (const [path, amount] of Object.entries(adds || {})) {
        setAtPath(userDetails, path, (getAtPath(userDetails, path) || 0) + amount);
    }
}

function applySetsInMemory(userDetails, sets) {
    for (const [path, value] of Object.entries(sets || {})) {
        setAtPath(userDetails, path, value);
    }
}

module.exports = {
    REGRADE_KEY,
    TRACKED_STATS,
    statGrantAdds,
    regradeSuccessWrites,
    regradeFailAdds,
    mergeAdds,
    applyAddsInMemory,
    applySetsInMemory
};
