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

    test('a win with no buff (Brassica) shows the explicit no-blessing line, not a missing field', () => {
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
