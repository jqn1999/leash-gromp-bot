// /work-odds (2026-09-28, direct instruction: "add a command that shows a user ephemerally
// via embed their /work command's full list of encounters and the % chance of each") —
// mirrors performWork's own odds pipeline exactly (Prospector widening -> festival odds
// override), so these tests lock in that the shown odds can never drift from what a real
// /work call would actually roll against.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { EmbedFactory } = require('../../../utils/embedFactory');
const { callback } = require('../workOdds');

function fakeInteraction() {
    return {
        deferReply: jest.fn().mockResolvedValue(),
        editReply: jest.fn().mockResolvedValue(),
        user: { id: 'user-1', username: 'User', displayName: 'User' },
    };
}

function baseUser(overrides = {}) {
    return {
        userId: 'user-1', username: 'User',
        companions: { owned: [], active: null },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    dynamoHandler.getActiveFestival.mockResolvedValue(null);
});

test('no Prospector, no live festival: 11 scenarios shown, no boost notes, percentages sum to ~100%', async () => {
    dynamoHandler.findUser.mockResolvedValue(baseUser());
    const spy = jest.spyOn(EmbedFactory.prototype, 'createWorkOddsEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const [, odds, boostNotes] = spy.mock.calls[0];
    expect(odds).toHaveLength(11);
    expect(odds.map(o => o.label)).toEqual(expect.arrayContaining([
        'Golden Potato', 'Poison Potato', 'Large Potato', 'Metal Potato', 'Sweet Potato',
        'Wandering Companion', 'Taro Trader', 'Ancient Potato', 'Mimic Potato', 'Golden Yam', 'Regular Work',
    ]));
    const totalPercent = odds.reduce((sum, o) => sum + parseFloat(o.percentText), 0);
    expect(totalPercent).toBeCloseTo(100, 1);
    expect(boostNotes).toEqual([]);
    spy.mockRestore();
});

test('Prospector equipped: widens Poison/Large/Mimic, leaves Taro Trader untouched, and adds a boost note', async () => {
    const withoutProspector = baseUser();
    const withProspector = baseUser({ companions: { owned: [{ instanceId: 'p-1', id: 'prospector', workCount: 0 }], active: 'p-1' } });

    dynamoHandler.findUser.mockResolvedValueOnce(withoutProspector);
    const spy = jest.spyOn(EmbedFactory.prototype, 'createWorkOddsEmbed').mockReturnValue({});
    await callback({}, fakeInteraction());
    const [, baselineOdds] = spy.mock.calls[0];
    const baselinePoison = parseFloat(baselineOdds.find(o => o.label === 'Poison Potato').percentText);
    const baselineTaro = parseFloat(baselineOdds.find(o => o.label === 'Taro Trader').percentText);

    spy.mockClear();
    dynamoHandler.findUser.mockResolvedValueOnce(withProspector);
    await callback({}, fakeInteraction());
    const [, boostedOdds, boostNotes] = spy.mock.calls[0];
    const boostedPoison = parseFloat(boostedOdds.find(o => o.label === 'Poison Potato').percentText);
    const boostedTaro = parseFloat(boostedOdds.find(o => o.label === 'Taro Trader').percentText);

    expect(boostedPoison).toBeGreaterThan(baselinePoison);
    expect(boostedTaro).toBeCloseTo(baselineTaro, 3); // no longer widened (removed 2026-09-28)
    expect(boostNotes.some(n => n.includes('Prospector'))).toBe(true);
    spy.mockRestore();
});

// 2026-09-28, direct instruction: Companion widens PROSPECTOR_COMPANION_SCENARIO_MULTIPLIER
// (1.5x) more than Poison/Large/Mimic's shared base value.
test('Prospector equipped: Companion widens by 1.5x as much (proportionally) as Poison/Large/Mimic', async () => {
    const withoutProspector = baseUser();
    const withProspector = baseUser({ companions: { owned: [{ instanceId: 'p-1', id: 'prospector', workCount: 0 }], active: 'p-1' } });

    dynamoHandler.findUser.mockResolvedValueOnce(withoutProspector);
    const spy = jest.spyOn(EmbedFactory.prototype, 'createWorkOddsEmbed').mockReturnValue({});
    await callback({}, fakeInteraction());
    const [, baselineOdds] = spy.mock.calls[0];
    const baselinePoison = parseFloat(baselineOdds.find(o => o.label === 'Poison Potato').percentText);
    const baselineCompanion = parseFloat(baselineOdds.find(o => o.label === 'Wandering Companion').percentText);

    spy.mockClear();
    dynamoHandler.findUser.mockResolvedValueOnce(withProspector);
    await callback({}, fakeInteraction());
    const [, boostedOdds] = spy.mock.calls[0];
    const boostedPoison = parseFloat(boostedOdds.find(o => o.label === 'Poison Potato').percentText);
    const boostedCompanion = parseFloat(boostedOdds.find(o => o.label === 'Wandering Companion').percentText);

    const poisonGrowth = boostedPoison / baselinePoison;
    const companionGrowth = boostedCompanion / baselineCompanion;
    // Not an exact 1.5x on the final percentages (each scenario's own widening also shifts
    // by however much widened BEFORE it in roll order, same as every other
    // getEffectiveScenarioChances test in workFactory.test.js) — just confirms Companion's
    // own growth is meaningfully larger than Poison's, not identical.
    expect(companionGrowth).toBeGreaterThan(poisonGrowth);
    spy.mockRestore();
});

test('a live festival with an oddsOverride widens the matching scenario further and adds a boost note naming it', async () => {
    dynamoHandler.getActiveFestival.mockResolvedValue({
        festivalId: 'frost_fair',
        endsAt: Date.now() + 100000,
        oddsOverride: { scenario: 'poison', multiplier: 1.5 },
    });
    dynamoHandler.findUser.mockResolvedValue(baseUser());
    const spy = jest.spyOn(EmbedFactory.prototype, 'createWorkOddsEmbed').mockReturnValue({});

    await callback({}, fakeInteraction());

    const [, odds, boostNotes] = spy.mock.calls[0];
    const poison = odds.find(o => o.label === 'Poison Potato');
    // Base Poison width is 1.0% (workScenarios' own POISON slice) -> 1.5x = 1.5%.
    expect(parseFloat(poison.percentText)).toBeCloseTo(1.5, 1);
    expect(boostNotes.some(n => n.includes('Poison Potato') && n.includes('+50%'))).toBe(true);
    spy.mockRestore();
});
