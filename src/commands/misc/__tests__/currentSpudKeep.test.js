// Power contribution per player on /current-spud-keep's roster page (2026-09-27, direct
// instruction: "include how much power each player is adding to the total for their guild
// / to mercs"). flattenRoster merges entrant.roster ({id, username}, guild.memberList's own
// shape) with entrant.breakdown.memberContributions (raidFactory's own per-member
// breakdown, keyed off the full userDetails object under `.member`) — these tests lock in
// that the id/userId matching actually works, since a silent mismatch would just make every
// contribution show as null rather than throw.
const { flattenRoster } = require('../currentSpudKeep');

function contributionEntry(userId, power, weight) {
    return { member: { userId }, power, weight, contribution: power * weight };
}

test('matches each roster member to their own memberContributions entry by id/userId', () => {
    const entrants = [
        {
            type: 'guild', name: 'Guild A',
            roster: [{ id: 'u1', username: 'Alice' }, { id: 'u2', username: 'Bob' }],
            breakdown: { memberContributions: [contributionEntry('u1', 100, 1.0), contributionEntry('u2', 40, 0.5)] },
        },
    ];

    const rows = flattenRoster(entrants);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ username: 'Alice', entrantName: 'Guild A', entrantType: 'guild' });
    expect(rows[0].contribution).toEqual(contributionEntry('u1', 100, 1.0));
    expect(rows[1].contribution).toEqual(contributionEntry('u2', 40, 0.5));
});

test('flattens across multiple entrants (guild + Merc Faction) into one player-level list', () => {
    const entrants = [
        {
            type: 'guild', name: 'Guild A',
            roster: [{ id: 'u1', username: 'Alice' }],
            breakdown: { memberContributions: [contributionEntry('u1', 100, 1.0)] },
        },
        {
            type: 'mercenary', name: 'The Merc Faction',
            roster: [{ id: 'u2', username: 'Bob' }],
            breakdown: { memberContributions: [contributionEntry('u2', 50, 1.0)] },
        },
    ];

    const rows = flattenRoster(entrants);

    expect(rows.map(r => r.username)).toEqual(['Alice', 'Bob']);
    expect(rows[0].entrantType).toBe('guild');
    expect(rows[1].entrantType).toBe('mercenary');
});

test('a roster member missing from memberContributions gets a null contribution, not a crash', () => {
    const entrants = [
        {
            type: 'guild', name: 'Guild A',
            roster: [{ id: 'u1', username: 'Alice' }],
            breakdown: { memberContributions: [] }, // e.g. a lookup failure dropped this member from scoring
        },
    ];

    const rows = flattenRoster(entrants);

    expect(rows[0].contribution).toBeNull();
});

test('an entrant with no memberContributions field at all (defensive) does not crash', () => {
    const entrants = [
        { type: 'guild', name: 'Guild A', roster: [{ id: 'u1', username: 'Alice' }], breakdown: {} },
    ];

    expect(() => flattenRoster(entrants)).not.toThrow();
    expect(flattenRoster(entrants)[0].contribution).toBeNull();
});

test('an empty entrants list produces an empty flat list', () => {
    expect(flattenRoster([])).toEqual([]);
});

// Ordered by each member's own power contribution, descending (direct instruction,
// 2026-09-27: "order spud keep players in each guild and in merc list in order of power
// they're contributing"). roster is deliberately weakest-first here, so a passing test can
// only be explained by an explicit sort, never by roster's own stored order.
test('sorts each entrant\'s roster by contribution descending, regardless of roster order', () => {
    const entrants = [
        {
            type: 'guild', name: 'Guild A',
            roster: [{ id: 'weak', username: 'Weak' }, { id: 'strong', username: 'Strong' }, { id: 'mid', username: 'Mid' }],
            breakdown: {
                memberContributions: [
                    contributionEntry('weak', 10, 1.0),
                    contributionEntry('strong', 1000, 1.0),
                    contributionEntry('mid', 500, 1.0),
                ],
            },
        },
    ];

    const rows = flattenRoster(entrants);

    expect(rows.map(r => r.username)).toEqual(['Strong', 'Mid', 'Weak']);
});

test('a roster member missing from memberContributions sorts to the back, not to an arbitrary spot', () => {
    const entrants = [
        {
            type: 'guild', name: 'Guild A',
            roster: [{ id: 'missing', username: 'Missing' }, { id: 'strong', username: 'Strong' }],
            breakdown: { memberContributions: [contributionEntry('strong', 1000, 1.0)] },
        },
    ];

    const rows = flattenRoster(entrants);

    expect(rows.map(r => r.username)).toEqual(['Strong', 'Missing']);
});
