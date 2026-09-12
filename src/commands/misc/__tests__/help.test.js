// Content-accuracy audit pass (2026-09-10) rewrote most of HelpTopics' static content to
// cite real numbers straight off constants.js instead of vague, numberless flavor text, and
// added 6 new topics (cinderroot, spud-keep, safehouses, heist, poison-mimic, tower) split out
// of/alongside the existing ones. These tests lock down the two hard Discord constraints the
// design was scoped against (<=25 slash-command choices, each embed description <=4096 chars)
// so a future balance pass that keeps growing a topic's content can't silently break /help.
const { HelpTopics } = require('../../../utils/constants');
const { EmbedFactory } = require('../../../utils/embedFactory');

const embedFactory = new EmbedFactory();

describe('HelpTopics data shape', () => {
    test('stays at or under Discord\'s 25-choice cap for the /help topic option', () => {
        expect(HelpTopics.length).toBeLessThanOrEqual(25);
    });

    test('every topic has a unique id', () => {
        const ids = HelpTopics.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('every topic carrying static content stays under the 4096-char embed description cap', () => {
        for (const topic of HelpTopics) {
            if (topic.content == null) continue; // companions/commands are generated live
            expect(topic.content.length).toBeLessThanOrEqual(4096);
        }
    });

    test('companions and commands remain dynamic (no stale static content checked in)', () => {
        const companions = HelpTopics.find(t => t.id === 'companions');
        const commands = HelpTopics.find(t => t.id === 'commands');
        expect(companions.content).toBeUndefined();
        expect(commands.content).toBeUndefined();
    });

    test('every other topic has real static content', () => {
        for (const topic of HelpTopics) {
            if (topic.id === 'companions' || topic.id === 'commands') continue;
            expect(typeof topic.content).toBe('string');
            expect(topic.content.length).toBeGreaterThan(0);
        }
    });
});

describe('createHelpOverviewEmbed', () => {
    test('the generated topic list (grows with topic count) stays under the 4096-char cap', () => {
        const embed = embedFactory.createHelpOverviewEmbed();
        expect(embed.data.description.length).toBeLessThanOrEqual(4096);
    });

    test('lists every non-overview topic by label/id/description', () => {
        const embed = embedFactory.createHelpOverviewEmbed();
        for (const topic of HelpTopics) {
            if (topic.id === 'overview') continue;
            expect(embed.data.description).toContain(topic.label);
            expect(embed.data.description).toContain(`\`${topic.id}\``);
        }
    });
});

describe('createHelpTopicEmbed renders every static topic without throwing', () => {
    const staticTopicIds = HelpTopics
        .filter(t => t.id !== 'companions' && t.id !== 'commands')
        .map(t => t.id);

    test.each(staticTopicIds)('topic:%s', (topicId) => {
        let embed;
        expect(() => {
            embed = embedFactory.createHelpTopicEmbed(topicId);
        }).not.toThrow();
        expect(embed.data.description.length).toBeLessThanOrEqual(4096);
    });
});

describe('spot-check the new 2026-09-10 topics cite real numbers, not vibes', () => {
    function contentFor(id) {
        return HelpTopics.find(t => t.id === id).content;
    }

    test('heist cites the current RobNpc.TIERS payout caps', () => {
        const content = contentFor('heist');
        // All four caps scaled x0.4580 on 2026-09-12 (fifth retune pass, paired with the
        // Elite/Legendary reward buff) — was 5,000/10,000/20,000/45,000.
        expect(content).toContain('2,500');
        expect(content).toContain('4,500');
        expect(content).toContain('9,000');
        expect(content).toContain('20,500');
    });

    test('spud-keep cites the current pot redirect percent and attacker bonus base', () => {
        const content = contentFor('spud-keep');
        expect(content).toContain('75%');
        expect(content).toContain('+6%');
    });

    test('safehouses cites the current Safehouse.SLOTS table\'s final tier', () => {
        const content = contentFor('safehouses');
        expect(content).toContain('400,000,000');
        expect(content).toContain('250,000,000');
    });

    test('cinderroot cites the current back-loaded GuildCompanionScaling ceiling', () => {
        const content = contentFor('cinderroot');
        expect(content).toContain('20%');
        expect(content).toContain('+30%');
    });

    test('tower cites the current 95% Elite success cap', () => {
        const content = contentFor('tower');
        expect(content).toContain('95%');
    });

    test('poison-mimic cites the current MimicSlaying kill chance', () => {
        const content = contentFor('poison-mimic');
        expect(content).toContain('5%');
    });
});
