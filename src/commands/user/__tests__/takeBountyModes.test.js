// /take-bounty's mode choices (2026-10-12, direct instruction: "split up 1-4 = regular 5-8 = elite
// 9-12 = legendary", mirroring Guild Raid's own Regular/Elite/Legendary): the slash command now
// offers Regular / Elite / Legendary / Baby / Stat, and a result for each mode lands in its own band.
jest.mock('../../../utils/dynamoHandler');

const takeBounty = require('../takeBounty');
const mercenaryFactory = require('../../../utils/mercenaryFactory');

describe('/take-bounty mode option', () => {
    const modeOption = takeBounty.options.find(o => o.name === 'mode');

    test('offers Regular, Elite, Legendary, Baby and Stat, Regular first', () => {
        expect(modeOption.choices).toEqual([
            { name: 'Regular Bounty', value: 'regular' },
            { name: 'Elite Bounty', value: 'elite' },
            { name: 'Legendary Bounty', value: 'legendary' },
            { name: 'Baby Bounty', value: 'baby' },
            { name: 'Stat Bounty', value: 'stat' },
        ]);
    });

    test('every ladder choice resolves inside its own band; baby is Tier 1', async () => {
        const user = { workMultiplierAmount: 400, mercenaryBountyWinCount: 0, rebirthCount: 0, companions: { owned: [], active: null, ownedCount: 0, mythicOwnedCount: 0 }, guildId: 0 };
        const spy = jest.spyOn(Math, 'random').mockReturnValue(0.5);
        try {
            const bands = { regular: [1, 4], elite: [5, 8], legendary: [9, 12], baby: [1, 1] };
            for (const [mode, [lo, hi]] of Object.entries(bands)) {
                const { tier } = await mercenaryFactory.resolveBountyAttempt(user, mode);
                expect(tier).toBeGreaterThanOrEqual(lo);
                expect(tier).toBeLessThanOrEqual(hi);
            }
        } finally {
            spy.mockRestore();
        }
    });
});
