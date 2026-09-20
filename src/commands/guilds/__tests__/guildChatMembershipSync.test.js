// Guild Chat Sync membership-sync hooks (systems/guilds.md, section 3) — join/kick/leave
// each need to add/remove the guild's chat access role in lockstep with memberList, or an
// ex-member keeps private-channel access (a real privacy bug, not cosmetic). Covers all
// three Guild-side hooks; becomeMercenaryMercChatSync.test.js covers the Merc Faction Hall's
// own 2 hooks.
jest.mock('../../../utils/dynamoHandler');

const dynamoHandler = require('../../../utils/dynamoHandler');
const { GuildRoles } = require('../../../utils/constants');

function fakeGuildMember(fetchable = true) {
    if (!fetchable) return null;
    return { roles: { add: jest.fn().mockResolvedValue(), remove: jest.fn().mockResolvedValue() } };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('join-guild grants the chat role on a successful join', () => {
    const { attemptJoinGuild, grantGuildChatRoleIfNeeded } = require('../joinGuild');

    function baseGuild(overrides = {}) {
        return {
            guildId: 'guild-1',
            guildName: 'Honest Workers',
            guildVersion: 1,
            memberCap: 5,
            memberList: [{ id: 'leader-1', role: GuildRoles.LEADER, username: 'Leader' }],
            inviteList: ['user-1'],
            guildChatRoleId: 'role-1',
            ...overrides,
        };
    }

    function baseUser(overrides = {}) {
        return { userId: 'user-1', username: 'Newbie', guildId: 0, isMercenary: false, guildMercenarySwitchTimer: 0, ...overrides };
    }

    test('attemptJoinGuild hands back guildChatRoleId on success, for the caller to act on', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild());
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);

        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');

        expect(result.ok).toBe(true);
        expect(result.guildChatRoleId).toBe('role-1');
    });

    test('a guild with no chat set up returns an undefined guildChatRoleId', async () => {
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild({ guildChatRoleId: null }));
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);

        const result = await attemptJoinGuild('user-1', 'Newbie', 'Newbie', 'Honest Workers');
        expect(result.guildChatRoleId).toBeFalsy();
    });

    test('grantGuildChatRoleIfNeeded adds the role to the newly-joined member', async () => {
        const guildMember = fakeGuildMember();
        const discordGuild = { members: { fetch: jest.fn().mockResolvedValue(guildMember) } };

        await grantGuildChatRoleIfNeeded(discordGuild, 'user-1', 'role-1');

        expect(discordGuild.members.fetch).toHaveBeenCalledWith('user-1');
        expect(guildMember.roles.add).toHaveBeenCalledWith('role-1');
    });

    test('grantGuildChatRoleIfNeeded is a silent no-op when there is no chat role to grant', async () => {
        const discordGuild = { members: { fetch: jest.fn() } };
        await grantGuildChatRoleIfNeeded(discordGuild, 'user-1', undefined);
        expect(discordGuild.members.fetch).not.toHaveBeenCalled();
    });

    test('grantGuildChatRoleIfNeeded is best-effort — a member who left the server is skipped, not thrown', async () => {
        const discordGuild = { members: { fetch: jest.fn().mockResolvedValue(null) } };
        await expect(grantGuildChatRoleIfNeeded(discordGuild, 'user-1', 'role-1')).resolves.toBeUndefined();
    });

    test('the /join-guild callback (named-guild path) grants the chat role after a successful join', async () => {
        const { callback } = require('../joinGuild');
        dynamoHandler.findGuildByName.mockResolvedValue(baseGuild());
        dynamoHandler.findUser.mockResolvedValue(baseUser());
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);

        const guildMember = fakeGuildMember();
        const interaction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'user-1', username: 'Newbie', displayName: 'Newbie' },
            guild: { members: { fetch: jest.fn().mockResolvedValue(guildMember) } },
            options: { get: (name) => (name === 'guild-name' ? { value: 'Honest Workers' } : undefined) },
        };

        await callback({}, interaction);

        expect(interaction.guild.members.fetch).toHaveBeenCalledWith('user-1');
        expect(guildMember.roles.add).toHaveBeenCalledWith('role-1');
    });
});

describe('kick removes the chat role from the kicked member', () => {
    const { callback } = require('../kick');

    function guildFixture(overrides = {}) {
        return {
            guildId: 'g1',
            guildName: 'Honest Workers',
            guildVersion: 1,
            memberList: [
                { id: 'leader-1', username: 'Leader', role: GuildRoles.LEADER },
                { id: 'target-1', username: 'Target', role: GuildRoles.MEMBER },
            ],
            guildChatRoleId: 'role-1',
            ...overrides,
        };
    }

    beforeEach(() => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'leader-1', username: 'Leader', guildId: 'g1' });
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
    });

    test('removes the target member\'s chat role after a successful kick', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const guildMember = fakeGuildMember();
        const interaction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'leader-1', username: 'Leader', displayName: 'Leader' },
            guild: { members: { fetch: jest.fn().mockResolvedValue(guildMember) } },
            options: { get: (name) => (name === 'user' ? { value: 'target-1' } : undefined) },
        };

        await callback({}, interaction);

        expect(interaction.guild.members.fetch).toHaveBeenCalledWith('target-1');
        expect(guildMember.roles.remove).toHaveBeenCalledWith('role-1');
    });

    test('a guild with no chat role set up never touches Discord roles at all', async () => {
        const guild = guildFixture({ guildChatRoleId: null });
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const membersFetch = jest.fn();
        const interaction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'leader-1', username: 'Leader', displayName: 'Leader' },
            guild: { members: { fetch: membersFetch } },
            options: { get: (name) => (name === 'user' ? { value: 'target-1' } : undefined) },
        };

        await callback({}, interaction);

        expect(membersFetch).not.toHaveBeenCalled();
    });

    test('a kicked member who already left the server is skipped, not a hard failure', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const interaction = {
            deferReply: jest.fn().mockResolvedValue(),
            editReply: jest.fn().mockResolvedValue(),
            user: { id: 'leader-1', username: 'Leader', displayName: 'Leader' },
            guild: { members: { fetch: jest.fn().mockResolvedValue(null) } },
            options: { get: (name) => (name === 'user' ? { value: 'target-1' } : undefined) },
        };

        await callback({}, interaction);

        expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('kicked'));
    });
});

describe('leave removes the leaving member\'s own chat role', () => {
    const { callback } = require('../leave');

    function guildFixture(overrides = {}) {
        return {
            guildId: 'g1',
            guildName: 'Honest Workers',
            guildVersion: 1,
            memberList: [
                { id: 'leader-1', username: 'Leader', role: GuildRoles.LEADER },
                { id: 'member-1', username: 'Member', role: GuildRoles.MEMBER },
            ],
            guildChatRoleId: 'role-1',
            ...overrides,
        };
    }

    beforeEach(() => {
        dynamoHandler.findUser.mockResolvedValue({ userId: 'member-1', username: 'Member', guildId: 'g1' });
        dynamoHandler.updateUserFields.mockResolvedValue({});
        dynamoHandler.updateGuildFieldsWithLock.mockResolvedValue(true);
    });

    test('removes the leaving member\'s chat role after the confirm step lands', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const guildMember = fakeGuildMember();
        const confirmation = { deferUpdate: jest.fn().mockResolvedValue(), customId: 'leave_guild_confirm' };
        const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(confirmation) };
        const interaction = {
            deferReply: jest.fn().mockResolvedValue(reply),
            editReply: jest.fn().mockResolvedValue(reply),
            followUp: jest.fn().mockResolvedValue(),
            user: { id: 'member-1', username: 'Member', displayName: 'Member', avatar: 'hash' },
            guild: { members: { fetch: jest.fn().mockResolvedValue(guildMember) } },
        };

        await callback({}, interaction);

        expect(interaction.guild.members.fetch).toHaveBeenCalledWith('member-1');
        expect(guildMember.roles.remove).toHaveBeenCalledWith('role-1');
    });

    test('a cancelled leave never touches Discord roles', async () => {
        const guild = guildFixture();
        dynamoHandler.findGuildById.mockResolvedValue(guild);
        const confirmation = { customId: 'leave_guild_cancel', update: jest.fn().mockResolvedValue() };
        const reply = { awaitMessageComponent: jest.fn().mockResolvedValue(confirmation) };
        const membersFetch = jest.fn();
        const interaction = {
            deferReply: jest.fn().mockResolvedValue(reply),
            editReply: jest.fn().mockResolvedValue(reply),
            user: { id: 'member-1', username: 'Member', displayName: 'Member', avatar: 'hash' },
            guild: { members: { fetch: membersFetch } },
        };

        await callback({}, interaction);

        expect(membersFetch).not.toHaveBeenCalled();
    });
});
