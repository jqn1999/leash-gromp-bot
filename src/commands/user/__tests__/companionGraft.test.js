// Companion Grafting (2026-10-13, direct instruction): 3 copies of one Mythic + a 500M fee become
// 1 fresh copy of a DIFFERENT Mythic the player picks; favorited and ascended copies are never
// consumed. The factory is exercised directly (pure), and the command with a fake interaction.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const graft = require('../../../utils/companionGraftFactory');
const { CompanionGraft, CompanionRarity, Companions } = require('../../../utils/constants');
const command = require('../companionGraft');

function copy(id, instanceId, extra = {}) {
    return { instanceId, id, workCount: 0, ...extra };
}

function user(owned, overrides = {}) {
    return {
        userId: 'u1', username: 'User', potatoes: 2_000_000_000,
        companions: { owned, active: null, favorites: [null, null, null, null, null], ownedCount: 2, mythicOwnedCount: 1, ...overrides.companions },
        ...overrides.top,
    };
}

const THREE_MOCHI = [copy('mochi', 'm1', { workCount: 3725 }), copy('mochi', 'm2', { workCount: 50 }), copy('mochi', 'm3', { workCount: 0 })];

describe('validateGraftRequest', () => {
    test('picks the 3 LOWEST-level copies, leaving the best one when the player owns 4', () => {
        const owned = [...THREE_MOCHI, copy('mochi', 'm4', { workCount: 800 })];
        const v = graft.validateGraftRequest(user(owned), 'mochi', 'elder_rootbeard');
        expect(v.valid).toBe(true);
        expect(v.consumed.map(e => e.instanceId)).toEqual(['m3', 'm2', 'm4']);
    });

    test('target must be a different, graftable Mythic', () => {
        expect(graft.validateGraftRequest(user(THREE_MOCHI), 'mochi', 'mochi').error).toMatch(/different Mythic/);
        expect(graft.validateGraftRequest(user(THREE_MOCHI), 'mochi', 'sprout').error).toMatch(/not a Mythic/);
        expect(graft.validateGraftRequest(user(THREE_MOCHI), 'sprout', 'mochi').error).toMatch(/only graft Mythic/);
        expect(graft.validateGraftRequest(user(THREE_MOCHI), 'mochi', 'nonsense').error).toMatch(/not a Mythic/);
    });

    test('needs 3 usable copies and says why favorited / ascended / scavenging copies do not count', () => {
        const owned = [
            copy('mochi', 'm1'), copy('mochi', 'm2'),
            copy('mochi', 'm3'), copy('mochi', 'm4', { ascensionStars: 1 }), copy('mochi', 'm5', { ascensionFuel: 10 }), copy('mochi', 'm6'),
        ];
        const u = user(owned, { companions: { favorites: ['m3', null, null, null, null], scavenging: { instanceId: 'm6' } } });
        const v = graft.validateGraftRequest(u, 'mochi', 'elder_rootbeard');
        expect(v.valid).toBe(false);
        expect(v.error).toMatch(/needs 3 usable copies of Mochi.*only have 2/);
        expect(v.error).toMatch(/1 saved as favorite, 2 with Ascension progress, 1 out scavenging/);
    });

    test('needs the full potato fee', () => {
        const v = graft.validateGraftRequest(user(THREE_MOCHI, { top: { potatoes: CompanionGraft.POTATO_FEE - 1 } }), 'mochi', 'elder_rootbeard');
        expect(v.valid).toBe(false);
        expect(v.error).toMatch(/500,000,000 potatoes/);
    });

    test('works for any pair from the live roster, so a future third Mythic needs no code change', () => {
        const mythics = Companions.filter(c => c.rarity === CompanionRarity.MYTHIC && c.dropSource == null);
        expect(mythics.length).toBeGreaterThanOrEqual(2);
        for (const from of mythics) {
            for (const to of mythics.filter(m => m.id !== from.id)) {
                const owned = [1, 2, 3].map(i => copy(from.id, `${from.id}-${i}`));
                expect(graft.validateGraftRequest(user(owned), from.id, to.id).valid).toBe(true);
            }
        }
    });
});

describe('resolveGraft', () => {
    test('removes exactly the 3 consumed copies, adds one level-1 copy of the target, keeps everything else', () => {
        const sprout = copy('sprout', 's1', { workCount: 12 });
        const u = user([...THREE_MOCHI, copy('mochi', 'm4', { workCount: 800 }), sprout], { companions: { scavenging: { instanceId: 's1' } } });
        const v = graft.validateGraftRequest(u, 'mochi', 'elder_rootbeard');
        const { companions, isNew, newInstanceId } = graft.resolveGraft(u, v);

        // m1 is the highest-level Mythic (Lv. 10), so it is the one that survives.
        expect(companions.owned.filter(e => e.id === 'mochi').map(e => e.instanceId)).toEqual(['m1']);
        expect(companions.owned.map(e => e.id).sort()).toEqual(['elder_rootbeard', 'mochi', 'sprout']);
        const fresh = companions.owned.find(e => e.instanceId === newInstanceId);
        expect(fresh).toMatchObject({ id: 'elder_rootbeard', workCount: 0 });
        expect(isNew).toBe(true);
        expect(companions.scavenging).toEqual({ instanceId: 's1' });
        expect(companions.mythicOwnedCount).toBe(2);
        expect(companions.ownedCount).toBe(3);
    });

    test('a target the player already owns is a duplicate instance, not a new type (counters unchanged)', () => {
        const u = user([...THREE_MOCHI, copy('elder_rootbeard', 'e1', { workCount: 100 })]);
        const { companions, isNew } = graft.resolveGraft(u, graft.validateGraftRequest(u, 'mochi', 'elder_rootbeard'));
        expect(isNew).toBe(false);
        expect(companions.owned.filter(e => e.id === 'elder_rootbeard')).toHaveLength(2);
        expect(companions.mythicOwnedCount).toBe(1);
    });

    test('unequips a consumed active copy but leaves an unrelated active companion alone', () => {
        const u = user(THREE_MOCHI, { companions: { active: 'm2' } });
        expect(graft.resolveGraft(u, graft.validateGraftRequest(u, 'mochi', 'elder_rootbeard')).companions.active).toBeNull();
        const u2 = user([...THREE_MOCHI, copy('sprout', 's1')], { companions: { active: 's1' } });
        expect(graft.resolveGraft(u2, graft.validateGraftRequest(u2, 'mochi', 'elder_rootbeard')).companions.active).toBe('s1');
    });
});

describe('/companion-graft command', () => {
    function fakeInteraction({ from = 'mochi', to = 'elder_rootbeard', click = 'confirm' } = {}) {
        const replyObj = {
            edit: jest.fn().mockResolvedValue(),
            awaitMessageComponent: jest.fn().mockImplementation(async () => click === 'timeout' ? null
                : ({ customId: `companion_graft_${click}`, deferUpdate: jest.fn().mockResolvedValue(), update: jest.fn().mockResolvedValue() })),
        };
        return {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(replyObj),
            user: { id: 'u1', username: 'User', displayName: 'User' },
            options: { get: (name) => ({ value: name === 'from' ? from : to }) },
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        dynamoHandler.updateUserFields.mockResolvedValue();
    });

    test('confirmed graft writes the new companions object and the fee as an ADD, nothing else', async () => {
        dynamoHandler.findUser.mockResolvedValue(user(THREE_MOCHI));
        const interaction = fakeInteraction();
        await command.callback({}, interaction);

        expect(dynamoHandler.updateUserFields).toHaveBeenCalledTimes(1);
        const [userId, setFields, addFields] = dynamoHandler.updateUserFields.mock.calls[0];
        expect(userId).toBe('u1');
        expect(Object.keys(setFields)).toEqual(['companions']);
        expect(setFields.companions.owned).toHaveLength(1);
        expect(setFields.companions.owned[0].id).toBe('elder_rootbeard');
        expect(addFields).toEqual({ potatoes: -CompanionGraft.POTATO_FEE });
        const finalContent = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].content;
        expect(finalContent).toMatch(/Grafting Rite is complete/);
    });

    test('cancel and timeout write nothing', async () => {
        for (const click of ['cancel', 'timeout']) {
            dynamoHandler.findUser.mockResolvedValue(user(THREE_MOCHI));
            await command.callback({}, fakeInteraction({ click }));
        }
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
    });

    test('a copy favorited during the confirm prompt aborts the write', async () => {
        dynamoHandler.findUser
            .mockResolvedValueOnce(user(THREE_MOCHI))
            .mockResolvedValueOnce(user(THREE_MOCHI, { companions: { favorites: ['m2', null, null, null, null] } }));
        const interaction = fakeInteraction();
        await command.callback({}, interaction);
        expect(dynamoHandler.updateUserFields).not.toHaveBeenCalled();
        const finalContent = interaction.editReply.mock.calls[interaction.editReply.mock.calls.length - 1][0].content;
        expect(finalContent).toMatch(/needs 3 usable copies/);
    });

    test('autocomplete: "to" excludes the chosen "from"; "from" lists owned Mythics with usable counts', async () => {
        dynamoHandler.findUser.mockResolvedValue(user(THREE_MOCHI));
        const respond = jest.fn();
        await command.autocomplete({}, {
            user: { id: 'u1', username: 'User' },
            options: { getFocused: () => ({ name: 'to', value: '' }), get: () => ({ value: 'mochi' }) },
            respond,
        });
        expect(respond.mock.calls[0][0].map(c => c.value)).toEqual(['elder_rootbeard']);

        const respondFrom = jest.fn();
        await command.autocomplete({}, {
            user: { id: 'u1', username: 'User' },
            options: { getFocused: () => ({ name: 'from', value: '' }), get: () => undefined },
            respond: respondFrom,
        });
        expect(respondFrom.mock.calls[0][0]).toEqual([{ name: 'Mochi, the Undying Stray (3 usable copies)', value: 'mochi' }]);
    });
});
