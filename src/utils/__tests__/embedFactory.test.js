// Regression coverage for a bug found from a player report ("something seems wrong with
// poison potato displaying"): createPoisonPotatoEmbed's non-immune branch referenced an
// undeclared `hitContext` variable — never assigned anywhere in the function — which threw
// a ReferenceError. Since work.js's Poison Potato scenario calls
// workFactory.handlePoisonPotato (which persists the loss/gain to the DB) BEFORE building
// this embed, the DB write already went through by the time the embed crashed — the player
// silently ate a real potato loss/lockout and never saw why. Fixed by actually declaring
// hitContext, mirroring the immune branch's own escalationContext pattern.
jest.mock('../dynamoHandler');
jest.mock('../companionFactory');
jest.mock('../rebirthFactory');
jest.mock('../guildBuffFactory');
jest.mock('../raidFactory');
jest.mock('../mercenaryFactory');
jest.mock('../shopFactory');

const { EmbedFactory } = require('../embedFactory');
const embedFactory = new EmbedFactory();

const poisonMob = { name: 'Poison Potato', description: 'A rotten potato.', thumbnailUrl: 'https://example.com/poison.png' };

describe('createPoisonPotatoEmbed', () => {
    test('non-immune hit does not throw, and shows the hit-number/reduction context', () => {
        const result = {
            potatoesGained: -500,
            immune: false,
            mitigationInfo: {
                reduction: 0.15,
                lockoutSeconds: 3600,
                hitNumberThisWeek: 2,
                milestoneJustReached: false,
                rebatePercent: null,
                escalationMultiplier: null,
            },
        };

        let embed;
        expect(() => {
            embed = embedFactory.createPoisonPotatoEmbed('User', 42, result, poisonMob);
        }).not.toThrow();

        const cooldownField = embed.data.fields.find(f => f.name === 'Cooldown:');
        expect(cooldownField.value).toContain('hit #2 this week');
        expect(cooldownField.value).toContain('15% softer');
    });

    test('first hit of the week (no reduction yet) does not throw', () => {
        const result = {
            potatoesGained: -500,
            immune: false,
            mitigationInfo: {
                reduction: 0,
                lockoutSeconds: 3600,
                hitNumberThisWeek: 1,
                milestoneJustReached: false,
                rebatePercent: null,
                escalationMultiplier: null,
            },
        };

        let embed;
        expect(() => {
            embed = embedFactory.createPoisonPotatoEmbed('User', 42, result, poisonMob);
        }).not.toThrow();

        const cooldownField = embed.data.fields.find(f => f.name === 'Cooldown:');
        expect(cooldownField.value).toContain('hit #1 this week');
        expect(cooldownField.value).not.toContain('softer');
    });

    test('immune (Guinea Pig) hit still does not throw', () => {
        const result = {
            potatoesGained: 200,
            immune: true,
            mitigationInfo: {
                reduction: 0,
                lockoutSeconds: 0,
                hitNumberThisWeek: 3,
                milestoneJustReached: false,
                rebatePercent: 0.5,
                escalationMultiplier: 1.2,
            },
        };

        expect(() => {
            embedFactory.createPoisonPotatoEmbed('User', 42, result, poisonMob);
        }).not.toThrow();
    });

    test('immune hit shows the mob\'s descriptionImmune text instead of its normal description when both are present', () => {
        const mobWithImmuneText = { ...poisonMob, descriptionImmune: 'Your pet eats it first.' };
        const result = {
            potatoesGained: 200,
            immune: true,
            mitigationInfo: {
                reduction: 0,
                lockoutSeconds: 0,
                hitNumberThisWeek: 1,
                milestoneJustReached: false,
                rebatePercent: 0.5,
                escalationMultiplier: 1,
            },
        };

        const embed = embedFactory.createPoisonPotatoEmbed('User', 42, result, mobWithImmuneText);
        expect(embed.data.description).toBe('Your pet eats it first.');
    });

    test('non-immune hit always shows the normal description, even if descriptionImmune is present', () => {
        const mobWithImmuneText = { ...poisonMob, descriptionImmune: 'Your pet eats it first.' };
        const result = {
            potatoesGained: -500,
            immune: false,
            mitigationInfo: {
                reduction: 0,
                lockoutSeconds: 3600,
                hitNumberThisWeek: 1,
                milestoneJustReached: false,
                rebatePercent: null,
                escalationMultiplier: null,
            },
        };

        const embed = embedFactory.createPoisonPotatoEmbed('User', 42, result, mobWithImmuneText);
        expect(embed.data.description).toBe(mobWithImmuneText.description);
    });
});

// buildCooldownSkipField (private, exercised via createWorkEmbed) now handles two sources
// for the same field: a companion id (string, original behavior) and Griseous's World Boss
// buff (an object, added 2026-08-29 — see dynamoHandler.calculateWorkTimerValue's own
// comment on why this reuses the existing field/parameter instead of a parallel one).
describe('buildCooldownSkipField (via createWorkEmbed)', () => {
    const mob = { name: 'Regular Potato', description: 'flavor text', thumbnailUrl: 'https://example.com/x.png' };

    test('a companion-triggered skip shows that companion\'s own flavor line', () => {
        const embed = embedFactory.createWorkEmbed('User', 10, 100, mob, 'fieldmouse');
        const field = embed.data.fields.find(f => f.name.includes('Fieldmouse'));
        expect(field).toBeDefined();
    });

    test('a World Boss buff-triggered skip shows a distinct blessing line naming the boss, not a companion', () => {
        const embed = embedFactory.createWorkEmbed('User', 10, 100, mob, { worldBuffBossName: 'Griseous, the Dragon Fruit' });
        const field = embed.data.fields.find(f => f.name.includes('Blessing'));
        expect(field).toBeDefined();
        expect(field.name).toContain('Griseous, the Dragon Fruit');
    });

    test('no skip at all adds neither field', () => {
        const embed = embedFactory.createWorkEmbed('User', 10, 100, mob, null);
        expect(embed.data.fields.find(f => f.name.includes('Blessing'))).toBeUndefined();
        expect(embed.data.fields.find(f => f.name.includes('Fieldmouse'))).toBeUndefined();
    });
});

// createWorldResultEmbed's server-wide buff announcement (systems/raids-and-world-events.md#server-wide-buff).
describe('createWorldResultEmbed world-buff announcement', () => {
    const mob = { name: 'Griseous, the Dragon Fruit', description: 'flavor text', thumbnailUrl: 'https://example.com/x.png' };

    test('a win with a granted buff announces it, including the numeric value', () => {
        const worldBuff = { bossName: mob.name, buffType: 'cooldownSkip', value: 0.05 };
        const embed = embedFactory.createWorldResultEmbed([], 0, mob, 0.5, 'Win!', 1, 500000, 5000000, worldBuff, true);
        const field = embed.data.fields.find(f => f.name.includes('Server-Wide Blessing'));
        expect(field).toBeDefined();
        expect(field.value).toContain('5%');
    });

    test('a win with a null worldBuff (defensive fallback — every boss grants one today) shows the explicit no-blessing line, not a missing field', () => {
        const embed = embedFactory.createWorldResultEmbed([], 0, mob, 0.5, 'Win!', 1, 500000, 5000000, null, true);
        const field = embed.data.fields.find(f => f.name.includes('Server-Wide Blessing'));
        expect(field).toBeDefined();
        expect(field.value).toContain('rests easy');
    });

    test('a loss never shows a buff-announcement field at all', () => {
        const embed = embedFactory.createWorldResultEmbed([], 0, mob, 0.5, 'Loss!', null, null, null, null, false);
        const field = embed.data.fields.find(f => f.name.includes('Server-Wide Blessing'));
        expect(field).toBeUndefined();
    });
});

// Mercenary Rank's Rival success bonus (2026-08-29) — surfaced explicitly on both the
// post-fight result embed and the pre-fight /notoriety preview, since the whole point was
// making rank's contribution to a Rival fight actually felt.
describe('createRivalConfrontationResultEmbed rank bonus display', () => {
    const rival = { name: 'Turnipbeard, the Rusted Ronin', winFlavor: 'You win.', loseFlavor: 'You lose.' };

    test('shows the Mercenary Rank Bonus field when rankSuccessBonus > 0', () => {
        const result = {
            scenario: 'hard', won: true, successChance: 0.30, rankSuccessBonus: 0.10, rival,
            rankInfo: { rank: 6, rewardMultiplier: 1.75 }, rewardAmount: 1000, penaltyAmount: 0, statBump: null,
        };
        const embed = embedFactory.createRivalConfrontationResultEmbed('User', result, 15);
        const field = embed.data.fields.find(f => f.name.includes('Mercenary Rank Bonus'));
        expect(field).toBeDefined();
        expect(field.value).toContain('+10%');
        expect(field.value).toContain('Rank 6');
    });

    test('omits the field entirely at Rank 1 (rankSuccessBonus is 0)', () => {
        const result = {
            scenario: 'easy', won: false, successChance: 0.45, rankSuccessBonus: 0, rival,
            rankInfo: { rank: 1, rewardMultiplier: 1.00 }, rewardAmount: 0, penaltyAmount: 500, statBump: null,
        };
        const embed = embedFactory.createRivalConfrontationResultEmbed('User', result, 0);
        expect(embed.data.fields.find(f => f.name.includes('Mercenary Rank Bonus'))).toBeUndefined();
    });

    test('Notoriety field shows the actual post-fight count, not a hardcoded "Reset to 0"', () => {
        const result = {
            scenario: 'hard', won: true, successChance: 0.30, rankSuccessBonus: 0.10, rival,
            rankInfo: { rank: 6, rewardMultiplier: 1.75 }, rewardAmount: 1000, penaltyAmount: 0, statBump: null,
        };
        // Confrontation subtracts the flat threshold rather than zeroing it out — any
        // overflow past the threshold carries into the next cycle (see confrontRival.js).
        const embed = embedFactory.createRivalConfrontationResultEmbed('User', result, 7);
        const field = embed.data.fields.find(f => f.name === 'Notoriety:');
        expect(field.value).not.toContain('Reset to 0');
        expect(field.value).toContain('7');
    });
});

// Mercenary Rank's cooldownReductionPercent (2026-08-29) — surfaced on the Bounty/Heist
// result embeds (only on a win, matching the "no discount on the loss side" precedent) and
// on the pre-attempt /bounty-board preview, same "make it felt" pattern as the Rival bonus
// display above.
describe('createBountyResultEmbed cooldown bonus display', () => {
    const scenario = { name: 'a rival gang', winFlavor: 'You win.', loseFlavor: 'You lose.', currency: 'potato' };

    test('shows the Mercenary Rank Cooldown Bonus field on a win at Rank 6', () => {
        const result = {
            tier: 5, mode: 'regular', won: true, successChance: 0.5, scenario,
            rankInfo: { rank: 6, rewardMultiplier: 1.75, cooldownReductionPercent: 0.30 },
            currency: 'potato', rewardAmount: 5000, penaltyAmount: 0, statReward: null,
        };
        const embed = embedFactory.createBountyResultEmbed('User', result);
        const field = embed.data.fields.find(f => f.name.includes('Mercenary Rank Cooldown Bonus'));
        expect(field).toBeDefined();
        expect(field.value).toContain('-30%');
        expect(field.value).toContain('Rank 6');
    });

    test('omits the field on a loss even at Rank 6', () => {
        const result = {
            tier: 5, mode: 'regular', won: false, successChance: 0.5, scenario,
            rankInfo: { rank: 6, rewardMultiplier: 1.75, cooldownReductionPercent: 0.30 },
            currency: 'potato', rewardAmount: 0, penaltyAmount: 1000, statReward: null,
        };
        const embed = embedFactory.createBountyResultEmbed('User', result);
        expect(embed.data.fields.find(f => f.name.includes('Mercenary Rank Cooldown Bonus'))).toBeUndefined();
    });

    test('omits the field on a win at Rank 1 (cooldownReductionPercent is 0)', () => {
        const result = {
            tier: 1, mode: 'baby', won: true, successChance: 0.9, scenario,
            rankInfo: { rank: 1, rewardMultiplier: 1.00, cooldownReductionPercent: 0 },
            currency: 'potato', rewardAmount: 100, penaltyAmount: 0, statReward: null,
        };
        const embed = embedFactory.createBountyResultEmbed('User', result);
        expect(embed.data.fields.find(f => f.name.includes('Mercenary Rank Cooldown Bonus'))).toBeUndefined();
    });
});

describe('createRobNpcResultEmbed cooldown bonus display', () => {
    const tier = { key: 'corner_store', label: 'Corner Store' };

    test('shows the Mercenary Rank Cooldown Bonus field on a win at Rank 6', () => {
        const result = {
            won: true, successChance: 0.8, amount: 5000,
            rankInfo: { rank: 6, rewardMultiplier: 1.75, cooldownReductionPercent: 0.30 },
            penaltyAmount: 0, statReward: null,
        };
        const embed = embedFactory.createRobNpcResultEmbed('User', result, tier);
        const field = embed.data.fields.find(f => f.name.includes('Mercenary Rank Cooldown Bonus'));
        expect(field).toBeDefined();
        expect(field.value).toContain('-30%');
        expect(field.value).toContain('Rank 6');
    });

    test('omits the field on a loss even at Rank 6', () => {
        const result = {
            won: false, successChance: 0.8, amount: 0,
            rankInfo: { rank: 6, rewardMultiplier: 1.75, cooldownReductionPercent: 0.30 },
            penaltyAmount: 2500, statReward: null,
        };
        const embed = embedFactory.createRobNpcResultEmbed('User', result, tier);
        expect(embed.data.fields.find(f => f.name.includes('Mercenary Rank Cooldown Bonus'))).toBeUndefined();
    });
});

describe('createBountyBoardEmbed cooldown bonus preview', () => {
    const weightedTiers = [{ tier: 1, weight: 1, successChance: 0.9, reward: 26000, penalty: -26000 }];

    test('shows the cooldown bonus in the rank line at Rank 6', () => {
        const rankInfo = { rank: 6, rewardMultiplier: 1.75, winsToNextRank: null, cooldownReductionPercent: 0.30 };
        const embed = embedFactory.createBountyBoardEmbed('User', rankInfo, weightedTiers, 0);
        expect(embed.data.description).toContain('-30% cooldown on a win');
    });

    test('omits the cooldown bonus text at Rank 1', () => {
        const rankInfo = { rank: 1, rewardMultiplier: 1.00, winsToNextRank: 15, cooldownReductionPercent: 0 };
        const embed = embedFactory.createBountyBoardEmbed('User', rankInfo, weightedTiers, 0);
        expect(embed.data.description).not.toContain('cooldown on a win');
    });
});

describe('createNotorietyEmbed Rival success bonus preview', () => {
    test('shows the per-scenario bonus for the current rank', () => {
        const rankInfo = { rank: 6, rewardMultiplier: 1.75, rivalSuccessBonus: { easy: 0.20, medium: 0.15, hard: 0.10 } };
        const embed = embedFactory.createNotorietyEmbed('User', 15, 20, rankInfo, true, 3);
        const field = embed.data.fields.find(f => f.name.includes('Rival Success Bonus'));
        expect(field).toBeDefined();
        expect(field.value).toBe('+20% Easy / +15% Medium / +10% Hard');
    });

    test('shows all-zero bonuses at Rank 1 rather than omitting the field', () => {
        const rankInfo = { rank: 1, rewardMultiplier: 1.00, rivalSuccessBonus: { easy: 0, medium: 0, hard: 0 } };
        const embed = embedFactory.createNotorietyEmbed('User', 0, 20, rankInfo, false, 0);
        const field = embed.data.fields.find(f => f.name.includes('Rival Success Bonus'));
        expect(field).toBeDefined();
        expect(field.value).toBe('+0% Easy / +0% Medium / +0% Hard');
    });
});

// Starch.SELL_TAX_PERCENT (2026-08-30) — shown explicitly on a sell, omitted on a buy
// (buyStarch.js's own call site never passes taxAmount, defaulting to 0).
describe('createBuyOrSellStarchEmbed Kingdom Tax display', () => {
    test('shows the Kingdom Tax field when taxAmount is nonzero', () => {
        const embed = embedFactory.createBuyOrSellStarchEmbed('User', 'u1', null, 100000, 50, 'sell', 100, 950, 90250, 4750);
        const field = embed.data.fields.find(f => f.name.includes('Kingdom Tax'));
        expect(field).toBeDefined();
        expect(field.value).toContain('4,750');
        expect(field.value).toContain('5%');
    });

    test('omits the Kingdom Tax field on a buy (no taxAmount passed)', () => {
        const embed = embedFactory.createBuyOrSellStarchEmbed('User', 'u1', null, 100000, 50, 'buy', 100, 950, 95000);
        expect(embed.data.fields.find(f => f.name.includes('Kingdom Tax'))).toBeUndefined();
    });
});

// /current-spud-keep pagination (2026-08-30) — mirrors /current-world-raid's own
// Previous/Next shape rather than a hard-capped "+N more" line, since this command is
// checked live/repeatedly and a busy server's entrant list can run past one embed's worth.
describe('createSpudKeepStatusEmbed pagination', () => {
    function basePreview(entrants) {
        return {
            currentBuff: null,
            spudKeep: { potPotatoes: 0, lastResolvedAt: null },
            entrants,
            attackerBonusPercent: 0,
            consecutiveHoldCycles: 0,
        };
    }

    test('shows the full entrant list and no page line when called without pagination params', () => {
        const entrants = [{ type: 'guild', name: 'Guild A', isHolder: false, chancePercent: 0.5, roster: [] }];
        const embed = embedFactory.createSpudKeepStatusEmbed(basePreview(entrants));
        expect(embed.data.description).not.toContain('Page');
        expect(embed.data.fields.some(f => f.name.includes('Guild A'))).toBe(true);
    });

    test('shows only the given page slice and a Page X / Y line when paginated', () => {
        const fullList = [
            { type: 'guild', name: 'Guild A', isHolder: false, chancePercent: 0.5, roster: [] },
            { type: 'guild', name: 'Guild B', isHolder: false, chancePercent: 0.5, roster: [] },
        ];
        const pageSlice = [fullList[1]]; // simulates page 2 of 2 (Guild B only)
        const embed = embedFactory.createSpudKeepStatusEmbed(basePreview(fullList), pageSlice, 1, 2);

        expect(embed.data.description).toContain('Page 2 / 2');
        expect(embed.data.fields.some(f => f.name.includes('Guild B'))).toBe(true);
        expect(embed.data.fields.some(f => f.name.includes('Guild A'))).toBe(false);
    });
});

// Holder buff compounding display (2026-08-31) — shows the LIVE current value (already
// computed off consecutiveHoldCycles at grant time), not the flat base constant.
describe('createSpudKeepStatusEmbed Holder Buffs field', () => {
    test('shows the base range when unclaimed (no live buff to read a current value from)', () => {
        const preview = { currentBuff: null, cooldownBuff: null, spudKeep: {}, entrants: [], attackerBonusPercent: 0, consecutiveHoldCycles: 0 };
        const embed = embedFactory.createSpudKeepStatusEmbed(preview);
        const field = embed.data.fields.find(f => f.name === 'Holder Buffs:');
        expect(field.value).toContain('+8%');
        expect(field.value).toContain('-8%');
        expect(field.value).toContain('40%');
    });

    test('shows the CURRENT compounded value while held, not the flat base', () => {
        const preview = {
            currentBuff: { holderType: 'guild', holderName: 'Guild A', expiresAt: Date.now() + 100000, value: 0.32 },
            cooldownBuff: { value: 0.24 },
            spudKeep: {},
            entrants: [],
            attackerBonusPercent: 0,
            consecutiveHoldCycles: 3,
        };
        const embed = embedFactory.createSpudKeepStatusEmbed(preview);
        const field = embed.data.fields.find(f => f.name === 'Holder Buffs:');
        expect(field.value).toContain('+32%');
        expect(field.value).toContain('-24%');
        expect(field.value).not.toContain('+8%');
    });
});

// Player-level roster listing (2026-08-31, direct instruction: "add a way to see players
// enrolled in the spud keep battle in the page 2 and onwards") — entrant fields only ever
// show a roster COUNT per guild/Merc Faction, never the actual usernames.
describe('createSpudKeepRosterEmbed', () => {
    function basePreview() {
        return {
            currentBuff: null,
            entrants: [
                { type: 'guild', name: 'Guild A', roster: [{ id: '1', username: 'Alice' }, { id: '2', username: 'Bob' }] },
                { type: 'mercenary', name: 'The Merc Faction', roster: [{ id: '3', username: 'Carol' }] },
            ],
            consecutiveHoldCycles: 0,
        };
    }

    test('lists each player with which entrant they belong to', () => {
        const preview = basePreview();
        const pageRows = [
            { username: 'Alice', entrantName: 'Guild A', entrantType: 'guild' },
            { username: 'Bob', entrantName: 'Guild A', entrantType: 'guild' },
            { username: 'Carol', entrantName: 'The Merc Faction', entrantType: 'mercenary' },
        ];
        const embed = embedFactory.createSpudKeepRosterEmbed(preview, pageRows, 0, 1);
        const field = embed.data.fields.find(f => f.name.includes('Enrolled Players'));
        expect(field.name).toContain('3 total');
        expect(field.value).toContain('Alice — 🏰 Guild A');
        expect(field.value).toContain('Bob — 🏰 Guild A');
        expect(field.value).toContain('Carol — ⚔️ The Merc Faction');
    });

    test('shows a Page X / Y line when paginated, and only that page\'s rows', () => {
        const preview = basePreview();
        const pageRows = [{ username: 'Carol', entrantName: 'The Merc Faction', entrantType: 'mercenary' }];
        const embed = embedFactory.createSpudKeepRosterEmbed(preview, pageRows, 1, 2);
        expect(embed.data.description).toContain('Page 2 / 2');
        const field = embed.data.fields.find(f => f.name.includes('Enrolled Players'));
        expect(field.value).toContain('Carol');
        expect(field.value).not.toContain('Alice');
    });

    test('shows a fallback line when the page has no rows (empty cycle)', () => {
        const embed = embedFactory.createSpudKeepRosterEmbed({ currentBuff: null, entrants: [], consecutiveHoldCycles: 0 }, [], 0, 1);
        const field = embed.data.fields.find(f => f.name.includes('Enrolled Players'));
        expect(field.value).toContain('No players enrolled');
    });
});

// Per-player pot payout breakdown (2026-08-30, direct instruction: "a per player amount
// line", plus the switch from an even split to a workMultiplierAmount-weighted one).
describe('createSpudKeepResultEmbed payout breakdown', () => {
    function baseResult(overrides = {}) {
        return {
            winner: { type: 'guild', id: 'g1', name: 'Guild A' },
            holderChanged: false,
            consecutiveHoldCycles: 1,
            expiresAt: Date.now() + 100000,
            passiveBuffValue: 0.06,
            cooldownBuffValue: 0.08,
            attackerBonusPercent: 0.06,
            entrants: [],
            potPotatoesPaid: 0,
            potForfeited: false,
            outgoingHolderName: null,
            payoutShares: [],
            ...overrides,
        };
    }

    test('lists each player and their own share, sorted by amount descending', () => {
        const result = baseResult({
            potPotatoesPaid: 1000, outgoingHolderName: 'Guild A',
            payoutShares: [{ id: 'a', username: 'Alice', amount: 250 }, { id: 'b', username: 'Bob', amount: 750 }]
        });
        const embed = embedFactory.createSpudKeepResultEmbed(result);
        const field = embed.data.fields.find(f => f.name.includes('Payout Breakdown'));
        expect(field).toBeDefined();
        expect(field.value.indexOf('Bob')).toBeLessThan(field.value.indexOf('Alice'));
        expect(field.value).toContain('Bob: 750 potatoes');
        expect(field.value).toContain('Alice: 250 potatoes');
    });

    test('omits the breakdown field entirely when nothing was paid out', () => {
        const embed = embedFactory.createSpudKeepResultEmbed(baseResult());
        expect(embed.data.fields.find(f => f.name.includes('Payout Breakdown'))).toBeUndefined();
    });

    // Pagination follow-up (2026-08-30, direct instruction: "show 5 players and paginate
    // if more than 5 players") — 5/page instead of the old char-limit truncation.
    test('shows only 5 players per page and no "Page X / Y" suffix when 5 or fewer total', () => {
        const payoutShares = Array.from({ length: 5 }, (_, i) => ({ id: `u${i}`, username: `Player${i}`, amount: 100 - i }));
        const result = baseResult({ potPotatoesPaid: 1000, outgoingHolderName: 'Guild A', payoutShares });
        const embed = embedFactory.createSpudKeepResultEmbed(result);
        const field = embed.data.fields.find(f => f.name.includes('Payout Breakdown'));
        expect(field.name).not.toContain('Page');
        expect(field.value.split('\n').length).toBe(5);
    });

    test('paginates a roster over 5 players — page 0 shows the top 5, later pages the rest, with a Page X / Y label', () => {
        const payoutShares = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, username: `Player${i}`, amount: 100 - i }));
        const result = baseResult({ potPotatoesPaid: 1000, outgoingHolderName: 'Guild A', payoutShares });

        const page0 = embedFactory.createSpudKeepResultEmbed(result, 0);
        const field0 = page0.data.fields.find(f => f.name.includes('Payout Breakdown'));
        expect(field0.name).toContain('Page 1 / 3');
        expect(field0.value.split('\n').length).toBe(5);
        expect(field0.value).toContain('Player0');
        expect(field0.value).not.toContain('Player5');

        const page2 = embedFactory.createSpudKeepResultEmbed(result, 2);
        const field2 = page2.data.fields.find(f => f.name.includes('Payout Breakdown'));
        expect(field2.name).toContain('Page 3 / 3');
        expect(field2.value.split('\n').length).toBe(2); // 12 shares, 5+5+2
        expect(field2.value).toContain('Player10');
        expect(field2.value).toContain('Player11');
    });

    test('getSpudKeepPayoutPageCount matches the field\'s own paging math, and is 1 for a skipped cycle', () => {
        const payoutShares = Array.from({ length: 12 }, (_, i) => ({ id: `u${i}`, username: `Player${i}`, amount: 1 }));
        expect(embedFactory.getSpudKeepPayoutPageCount({ payoutShares })).toBe(3);
        expect(embedFactory.getSpudKeepPayoutPageCount({ payoutShares: [] })).toBe(1);
        expect(embedFactory.getSpudKeepPayoutPageCount({ payoutShares: undefined })).toBe(1);
    });
});

describe('createSpudKeepCollectEmbed', () => {
    test('shows the collected amount', () => {
        const embed = embedFactory.createSpudKeepCollectEmbed('User', 12345);
        expect(embed.data.description).toContain('12,345');
    });
});

// Mercenary Leaderboard (2026-08-31) — mirrors createGuildLeaderboardEmbed's own per-entry
// shape (medal rank label, name, a derived readout, a count). mercenaryFactory is
// jest-mocked at the top of this file, so getMercenaryRankInfo's return is stubbed here.
describe('createMercenaryLeaderboardEmbed', () => {
    const mercenaryFactory = require('../mercenaryFactory');

    beforeEach(() => {
        mercenaryFactory.getMercenaryRankInfo.mockImplementation((wins) => ({
            rank: wins >= 50 ? 3 : 1,
            rewardMultiplier: wins >= 50 ? 1.35 : 1.00,
            rivalSuccessBonus: { easy: 0, medium: 0, hard: 0 },
            cooldownReductionPercent: 0,
            winsToNextRank: null,
        }));
    });

    const mercs = [
        { userId: 'u1', username: 'TopMerc', mercenaryBountyWinCount: 60, isMercenary: true },
        { userId: 'u2', username: 'MidMerc', mercenaryBountyWinCount: 20, isMercenary: true },
    ];

    test('shows a medal-ranked entry per mercenary with their win count', () => {
        const embed = embedFactory.createMercenaryLeaderboardEmbed(mercs, -1);
        const first = embed.data.fields[0];
        expect(first.name).toContain('🥇');
        expect(first.name).toContain('TopMerc');
        expect(first.value).toContain('60');
        expect(first.value).toContain('Rank 3');
    });

    test('tags a retired mercenary (isMercenary: false) with "(Retired)"', () => {
        const retiredMercs = [{ userId: 'u1', username: 'OldChamp', mercenaryBountyWinCount: 40, isMercenary: false }];
        const embed = embedFactory.createMercenaryLeaderboardEmbed(retiredMercs, -1);
        expect(embed.data.fields[0].name).toContain('(Retired)');
    });

    test('does not tag an active mercenary with "(Retired)"', () => {
        const embed = embedFactory.createMercenaryLeaderboardEmbed(mercs, -1);
        expect(embed.data.fields[0].name).not.toContain('(Retired)');
    });

    test('shows a "You haven\'t won a bounty yet" fallback when userIndex is the -1 sentinel (caller not in the sorted list)', () => {
        const embed = embedFactory.createMercenaryLeaderboardEmbed(mercs, -1);
        const fallback = embed.data.fields.find(f => f.name === 'Your Rank');
        expect(fallback).toBeDefined();
        expect(fallback.value).toContain("haven't won a bounty yet");
    });

    test('marks the caller with "(You)" and skips the fallback when they ARE in the sorted list', () => {
        const embed = embedFactory.createMercenaryLeaderboardEmbed(mercs, 1);
        expect(embed.data.fields.find(f => f.name === 'Your Rank')).toBeUndefined();
        expect(embed.data.fields[1].name).toContain('(You)');
    });
});

// Raid Result Embed Shows Next-Raid Cooldown (2026-08-31) — nextRaidAvailableAt is a new
// trailing optional param, default null (same "default to old behavior" precedent
// raidRewardMultiplier/sacrificeOffer already set) — shown unconditionally (win or loss)
// as a Discord relative timestamp when provided.
describe('createRaidEmbed next-raid cooldown field', () => {
    const raidList = [{ id: 'u1', username: 'Raider' }];
    const mob = { name: 'Test Mob', description: 'flavor', thumbnailUrl: 'https://example.com/x.png' };

    test('shows the Next Raid Available field as a Discord relative timestamp when provided', () => {
        const nextRaidAvailableAt = Date.now() + 1_548_000;
        const embed = embedFactory.createRaidEmbed('Guild', raidList, 5, 1000, null, mob, 0.5, 'Win!', null, null, null, nextRaidAvailableAt);
        const field = embed.data.fields.find(f => f.name.includes('Next Raid Available'));
        expect(field).toBeDefined();
        expect(field.value).toBe(`<t:${Math.floor(nextRaidAvailableAt / 1000)}:R>`);
    });

    test('omits the field entirely when nextRaidAvailableAt is not passed (defaults to null)', () => {
        const embed = embedFactory.createRaidEmbed('Guild', raidList, 5, 1000, null, mob, 0.5, 'Win!');
        expect(embed.data.fields.find(f => f.name.includes('Next Raid Available'))).toBeUndefined();
    });

    test('still shows the field on a loss — the cooldown reset is unconditional on win/loss', () => {
        const nextRaidAvailableAt = Date.now() + 1_548_000;
        const embed = embedFactory.createRaidEmbed('Guild', raidList, 5, -500, null, mob, 0.5, 'Loss!', null, null, null, nextRaidAvailableAt);
        expect(embed.data.fields.find(f => f.name.includes('Next Raid Available'))).toBeDefined();
    });
});

// Companion "Work Count" -> "XP" Rename + Show XP Gained in Result Embeds (2026-08-31).
// Part 2: the 5 non-/work commands get a real distinct "Companion XP" field, gated on
// companionXpGained > 0 (a no-op restriction/nothing-equipped grant shows nothing).
describe('companion XP display gating on companion equipped', () => {
    const bountyScenario = { name: 'a rival gang', winFlavor: 'You win.', loseFlavor: 'You lose.', currency: 'potato' };
    function baseBountyResult(overrides = {}) {
        return {
            tier: 1, mode: 'regular', won: true, successChance: 0.5, scenario: bountyScenario,
            rankInfo: { rank: 1, rewardMultiplier: 1.00, cooldownReductionPercent: 0 },
            currency: 'potato', rewardAmount: 1000, penaltyAmount: 0, statReward: null,
            ...overrides,
        };
    }

    test('createBountyResultEmbed shows the Companion XP field when a companion actually trained', () => {
        const embed = embedFactory.createBountyResultEmbed('User', baseBountyResult(), null, 1000, 0, 5, 'Yukon');
        const field = embed.data.fields.find(f => f.name.includes('Companion XP'));
        expect(field).toBeDefined();
        expect(field.value).toContain('+5 XP');
        expect(field.value).toContain('Yukon');
    });

    test('createBountyResultEmbed omits the Companion XP field when nothing was equipped (companionXpGained 0, default)', () => {
        const embed = embedFactory.createBountyResultEmbed('User', baseBountyResult());
        expect(embed.data.fields.find(f => f.name.includes('Companion XP'))).toBeUndefined();
    });

    test('createRobNpcResultEmbed shows the Companion XP field only when companionXpGained > 0', () => {
        const tier = { key: 'corner_store', label: 'Corner Store' };
        const result = { won: true, successChance: 0.8, amount: 5000, rankInfo: { rank: 1, rewardMultiplier: 1.00, cooldownReductionPercent: 0 }, penaltyAmount: 0, statReward: null };

        const withXp = embedFactory.createRobNpcResultEmbed('User', result, tier, 3, 'Barn Owl');
        expect(withXp.data.fields.find(f => f.name.includes('Companion XP'))).toBeDefined();

        const withoutXp = embedFactory.createRobNpcResultEmbed('User', result, tier);
        expect(withoutXp.data.fields.find(f => f.name.includes('Companion XP'))).toBeUndefined();
    });

    // /work is the structural exception — folded into the existing "Work Count:" field's
    // value string rather than a new field, since this grant is always exactly +1 whenever
    // any companion is equipped at all on the bot's highest-traffic embed.
    describe('createWorkEmbed (folded into the existing Work Count field, no new field)', () => {
        const mob = { name: 'Regular Potato', description: 'flavor text', thumbnailUrl: 'https://example.com/x.png' };

        test('folds "+N XP: Name" into the Work Count field value when a companion is equipped', () => {
            const embed = embedFactory.createWorkEmbed('User', 142, 100, mob, null, 1, 'Sprout');
            const field = embed.data.fields.find(f => f.name === 'Work Count:');
            expect(field.value).toBe('142 (+1 XP: Sprout)');
        });

        test('shows the plain count with no suffix when nothing is equipped (companionXpGained 0, default)', () => {
            const embed = embedFactory.createWorkEmbed('User', 142, 100, mob);
            const field = embed.data.fields.find(f => f.name === 'Work Count:');
            expect(field.value).toBe('142');
        });

        test('never adds a second, standalone "Companion XP" field on /work\'s own embed', () => {
            const embed = embedFactory.createWorkEmbed('User', 142, 100, mob, null, 1, 'Sprout');
            expect(embed.data.fields.find(f => f.name.includes('Companion XP'))).toBeUndefined();
        });
    });
});

// Golden/dirt pocket icons no longer reuse goldenPotato/largePotato's own /work-encounter
// art (2026-08-31, direct instruction: "the pictures are very confusing to players" —
// those images already read as the Golden/Large Potato /work jackpots to players, not as
// roulette's golden/dirt COLOR concept). rotten is unaffected — poisonPotato's icon was
// never flagged as confusing.
describe('createPotatoRouletteEmbed pocket icons', () => {
    test('golden and dirt no longer use goldenPotato/largePotato\'s own /work-encounter art', () => {
        const { goldenPotato, largePotato } = require('../constants');
        const goldenEmbed = embedFactory.createPotatoRouletteEmbed('golden', 'golden', 1, 0, 0, 1000, 100);
        const dirtEmbed = embedFactory.createPotatoRouletteEmbed('dirt', 'dirt', 0, 1, 0, 1000, 100);
        expect(goldenEmbed.data.thumbnail.url).not.toBe(goldenPotato.thumbnailUrl);
        expect(dirtEmbed.data.thumbnail.url).not.toBe(largePotato.thumbnailUrl);
    });

    test('golden and dirt share the same fallback icon (no dedicated art yet)', () => {
        const goldenEmbed = embedFactory.createPotatoRouletteEmbed('golden', 'golden', 1, 0, 0, 1000, 100);
        const dirtEmbed = embedFactory.createPotatoRouletteEmbed('dirt', 'dirt', 0, 1, 0, 1000, 100);
        expect(goldenEmbed.data.thumbnail.url).toBe(dirtEmbed.data.thumbnail.url);
    });

    test('rotten keeps poisonPotato\'s icon, unaffected by the golden/dirt swap', () => {
        const { poisonPotato } = require('../constants');
        const rottenEmbed = embedFactory.createPotatoRouletteEmbed('rotten', 'rotten', 0, 0, 1, 1000, 1700);
        expect(rottenEmbed.data.thumbnail.url).toBe(poisonPotato.thumbnailUrl);
    });
});

// World Boss's server-wide buff (2026-09-04, direct instruction) — previously granted by
// worldFactory.js's startWorldBoss and shown exactly once in the kill announcement embed,
// with no way for a player to check afterward whether one was still live. createUserEmbed
// (/profile) and createUserStatsEmbed (/user-stats) now both append a status line built
// off dynamoHandler.getActiveWorldBuff(), omitted entirely once the buff has expired.
describe('World Boss buff status line (createUserEmbed / createUserStatsEmbed)', () => {
    function baseUserDetails(overrides = {}) {
        return {
            rebirthCount: 0,
            companions: { ownedCount: 0 },
            guildId: 0,
            isMercenary: false,
            potatoes: 0,
            bankStored: 0,
            starches: 0,
            workMultiplierAmount: 1,
            passiveAmount: 0,
            bankCapacity: 50000,
            maxStarches: 250,
            workCount: 0,
            loginStreak: 0,
            records: {},
            totalEarnings: 0,
            totalLosses: 0,
            sweetPotatoBuffs: { workMultiplierAmount: 0, passiveAmount: 0, bankCapacity: 0 },
            regrades: {
                workMulti: { regradeAmount: 0, failStack: 0 },
                passiveAmount: { regradeAmount: 0, failStack: 0 },
                bankCapacity: { regradeAmount: 0, failStack: 0 }
            },
            ...overrides
        };
    }

    const dynamoHandler = require('../dynamoHandler');

    beforeEach(() => {
        const rebirthFactory = require('../rebirthFactory');
        const companionFactory = require('../companionFactory');
        rebirthFactory.getLiveRebirthPercent.mockReturnValue(0);
        companionFactory.getActivePerkValue.mockReturnValue(0);
        companionFactory.getActiveCompanion.mockReturnValue(null);
    });

    test('createUserEmbed shows a status line for a live buff, with the correct amount', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({
            bossName: 'Brassica', buffType: 'passiveBoost', value: 0.15, expiresAt: Date.now() + 3600 * 1000
        });

        const embed = await embedFactory.createUserEmbed('user-1', 'Player', 'hash', baseUserDetails(), 0);

        const field = embed.data.fields.find(f => f.name.includes("Brassica's Blessing"));
        expect(field).toBeDefined();
        expect(field.value).toContain('+15% passive income for everyone');
    });

    test('createUserStatsEmbed shows the same status line for a live buff', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({
            bossName: 'Brassica', buffType: 'workMulti', value: 0.1, expiresAt: Date.now() + 3600 * 1000
        });

        const embed = await embedFactory.createUserStatsEmbed('user-1', 'Player', 'hash', baseUserDetails());

        const field = embed.data.fields.find(f => f.name.includes("Brassica's Blessing"));
        expect(field).toBeDefined();
        expect(field.value).toContain('+10% work multiplier for everyone');
    });

    test('omits the field entirely once the buff has expired — never a stale/0% line', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue({
            bossName: 'Brassica', buffType: 'passiveBoost', value: 0.15, expiresAt: Date.now() - 1000
        });

        const embed = await embedFactory.createUserEmbed('user-1', 'Player', 'hash', baseUserDetails(), 0);

        expect(embed.data.fields.find(f => f.name.includes('Blessing'))).toBeUndefined();
    });

    test('omits the field entirely when no World Boss has ever been killed', async () => {
        dynamoHandler.getActiveWorldBuff.mockResolvedValue(undefined);

        const embed = await embedFactory.createUserStatsEmbed('user-1', 'Player', 'hash', baseUserDetails());

        expect(embed.data.fields.find(f => f.name.includes('Blessing'))).toBeUndefined();
    });
});
