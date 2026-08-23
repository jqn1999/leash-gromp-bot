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
});
