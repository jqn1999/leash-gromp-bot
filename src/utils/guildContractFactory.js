const dynamoHandler = require("../utils/dynamoHandler");
const { getStatValue } = require("../utils/achievementFactory");
const { GuildContracts, GuildContract, GuildHistory } = require("../utils/constants");

// "Week" boundaries computed in EST, matching every other day/week-based reset in this
// game (Tower, daily streak, Quests' own weekly rotation, the 4am cron itself).
function getDateStringEST(date) {
    return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function isMondayEST(date) {
    return date.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long' }) === 'Monday';
}

// Sums each tracked member's own delta (current stat value minus their snapshotted
// baseline) into one guild-wide live total. Only members who actually have a baseline
// entry are summed — a member who joined the guild mid-week (after the snapshot was
// taken) has no baseline and simply doesn't contribute until the next rotation, the
// same "snapshot at rotation time" boundary the roadmap called for. Mirrors
// startRaid.js/currentRaid.js's Promise.all(guild.raidList.map(m => findUser(m.id,
// m.username))) member-list aggregation pattern, with the same Number.isFinite(...) ? ... : 0
// guard so one malformed/unlookupable member record can't poison the whole guild's
// progress with NaN (see architecture/data-model.md).
// Per-member breakdown of live delta-from-baseline, the same lookup computeLiveMemberSum
// needs — extracted so a per-member leaderboard (getMemberBreakdown) and the aggregate
// sum can share one fetch instead of two.
async function computeMemberDeltas(guild, memberBaselines, statPath) {
    const trackedMembers = guild.memberList.filter(member => memberBaselines[member.id] !== undefined);
    if (trackedMembers.length === 0) return [];

    const memberDetails = await Promise.all(trackedMembers.map(member => dynamoHandler.findUser(member.id, member.username)));

    return trackedMembers.map((member, index) => {
        const details = memberDetails[index];
        const currentValue = details ? getStatValue(details, statPath) : undefined;
        const numericCurrent = Number.isFinite(currentValue) ? currentValue : 0;
        const baseline = Number.isFinite(memberBaselines[member.id]) ? memberBaselines[member.id] : 0;
        return { id: member.id, username: member.username, delta: Math.max(0, numericCurrent - baseline) };
    });
}

async function computeLiveMemberSum(guild, memberBaselines, statPath) {
    const deltas = await computeMemberDeltas(guild, memberBaselines, statPath);
    return deltas.reduce((sum, member) => sum + member.delta, 0);
}

class GuildContractFactory {
    // Refreshes the active Guild Contract, but only on Mondays — same weekly-only
    // cadence as Quests' own weekly set (isMondayEST), since this is a weekly guild
    // objective sharing the same daily 4am cron Quests/Tower already use. Any other day
    // of the week this is a no-op that just returns the still-active contract.
    async rotateContract() {
        const now = new Date();
        const today = getDateStringEST(now);

        if (!isMondayEST(now)) {
            const current = await dynamoHandler.getActiveGuildContract();
            return { activeContract: current, rotated: false };
        }

        const template = GuildContracts[Math.floor(Math.random() * GuildContracts.length)];
        const activeContract = { templateId: template.id, rotationDate: today };
        await dynamoHandler.setActiveGuildContract(activeContract);
        return { activeContract, rotated: true };
    }

    // Checks the given guild's aggregate progress against the currently-active
    // contract, snapshotting a fresh per-member baseline the first time this guild is
    // checked against the current rotation (mirroring questFactory's stale-snapshot
    // safety: a guild's stored guildContract.rotationDate from an older rotation of the
    // same template id is detected and replaced rather than reused, so a stale
    // completed: true from a prior week can't silently skip the new rotation).
    //
    // actingUserDetails/actingPreviousUserDetails identify the guild member whose /work
    // call triggered this check (if any) and their pre-action state — used exactly like
    // questFactory's previousUserDetails, so that when a fresh baseline is established
    // for THIS member specifically, the action that revealed it still counts as
    // progress instead of being silently absorbed into the baseline. Every other
    // tracked member's baseline uses their current (live) value, since there's no
    // "pre-action" state available for someone who isn't the one currently acting —
    // this leaves a small, accepted race window on baseline establishment only (not on
    // completion, which is guarded by a DynamoDB ConditionExpression below): if two
    // different members' /work calls both land while a guild's baseline is still
    // unestablished, whichever call's write lands last wins, and the other's single
    // action might not count. Completion itself can't double-grant this way.
    async checkAndClaimContract(guild, actingUserDetails = null, actingPreviousUserDetails = null) {
        const activeContract = await dynamoHandler.getActiveGuildContract();
        if (!activeContract) return { completedNow: false };

        const template = GuildContracts.find(contract => contract.id === activeContract.templateId);
        if (!template) return { completedNow: false };

        let contractState = guild.guildContract;
        let stateChanged = false;

        if (!contractState || contractState.rotationDate !== activeContract.rotationDate) {
            const memberDetails = await Promise.all(guild.memberList.map(member => dynamoHandler.findUser(member.id, member.username)));
            const memberBaselines = {};
            guild.memberList.forEach((member, index) => {
                const details = memberDetails[index];
                let startValue;
                if (actingUserDetails && actingPreviousUserDetails && member.id === actingUserDetails.userId) {
                    startValue = getStatValue(actingPreviousUserDetails, template.statPath) || 0;
                } else {
                    startValue = details ? (getStatValue(details, template.statPath) || 0) : 0;
                }
                memberBaselines[member.id] = startValue;
            });

            contractState = {
                templateId: template.id,
                rotationDate: activeContract.rotationDate,
                memberBaselines,
                frozenContribution: 0,
                completed: false
            };
            stateChanged = true;
        }

        if (contractState.completed) {
            if (stateChanged) await dynamoHandler.updateGuildDatabase(guild.guildId, 'guildContract', contractState);
            return { completedNow: false, template, progress: template.threshold, threshold: template.threshold };
        }

        const liveSum = await computeLiveMemberSum(guild, contractState.memberBaselines, template.statPath);
        const frozenContribution = Number.isFinite(contractState.frozenContribution) ? contractState.frozenContribution : 0;
        const progress = frozenContribution + liveSum;

        if (progress >= template.threshold) {
            const currentBankCapacity = Number.isFinite(guild.bankCapacity) ? guild.bankCapacity : 0;
            const newBankCapacity = currentBankCapacity + GuildContract.BANK_CAPACITY_REWARD;
            // bankCapacityBonus tracks this reward separately from the base guildShops
            // ladder value folded into bankCapacity (see getDefaultGuildFields) — so
            // guildBuy.js's tier lookup can tell "shop-purchased base" apart from
            // "contract bonus" and the bonus survives the guild's next shop purchase
            // instead of being overwritten by it.
            const currentBankCapacityBonus = Number.isFinite(guild.bankCapacityBonus) ? guild.bankCapacityBonus : 0;
            const newBankCapacityBonus = currentBankCapacityBonus + GuildContract.BANK_CAPACITY_REWARD;
            const updatedContractState = { ...contractState, completed: true };

            const won = await dynamoHandler.completeGuildContract(guild.guildId, newBankCapacity, newBankCapacityBonus, updatedContractState);
            if (won) {
                // Only the single winner of the completion race reaches here, so this
                // append can't double-write — no lock needed, unlike the memberList
                // writes elsewhere in guilds.md's concurrency section.
                const historyEntry = {
                    templateName: template.name,
                    rotationDate: contractState.rotationDate,
                    completedAt: Date.now(),
                    reward: GuildContract.BANK_CAPACITY_REWARD
                };
                const existingHistory = Array.isArray(guild.contractHistory) ? guild.contractHistory : [];
                const newHistory = [...existingHistory, historyEntry].slice(-GuildHistory.MAX_ENTRIES);
                await dynamoHandler.updateGuildDatabase(guild.guildId, 'contractHistory', newHistory);

                return { completedNow: true, template, progress, threshold: template.threshold, bankCapacityReward: GuildContract.BANK_CAPACITY_REWARD };
            }
            // Lost the race to another concurrent completion — another call already
            // applied the reward, so don't double-announce or double-grant.
            return { completedNow: false, template, progress, threshold: template.threshold };
        }

        if (stateChanged) {
            await dynamoHandler.updateGuildDatabase(guild.guildId, 'guildContract', contractState);
        }
        return { completedNow: false, template, progress, threshold: template.threshold };
    }

    // Read-only progress for display in /guild-contract — never establishes a baseline
    // or persists anything, same "viewing never snapshots/claims" contract /quests
    // holds for users. If this guild has no baseline yet for the current rotation,
    // progress is reported as 0 rather than computing one, since there's nothing
    // snapshotted yet to measure a delta against.
    async getProgress(guild) {
        const activeContract = await dynamoHandler.getActiveGuildContract();
        if (!activeContract) return null;

        const template = GuildContracts.find(contract => contract.id === activeContract.templateId);
        if (!template) return null;

        const contractState = guild.guildContract;
        const hasFreshBaseline = Boolean(contractState && contractState.rotationDate === activeContract.rotationDate);
        if (!hasFreshBaseline) {
            return { template, progress: 0, threshold: template.threshold, isCompleted: false, rotationDate: activeContract.rotationDate };
        }

        const liveSum = await computeLiveMemberSum(guild, contractState.memberBaselines, template.statPath);
        const frozenContribution = Number.isFinite(contractState.frozenContribution) ? contractState.frozenContribution : 0;
        const progress = Math.min(frozenContribution + liveSum, template.threshold);

        return {
            template,
            progress,
            threshold: template.threshold,
            isCompleted: Boolean(contractState.completed),
            rotationDate: contractState.rotationDate
        };
    }

    // Per-member live contribution toward the active contract, sorted highest-first, for
    // a leaderboard in /guild-contract. Read-only, same as getProgress — never
    // establishes a baseline or persists anything. Returns an empty breakdown (not an
    // error) if this guild has no fresh baseline yet, mirroring getProgress's "show 0"
    // behavior rather than computing a delta against nothing.
    async getMemberBreakdown(guild) {
        const activeContract = await dynamoHandler.getActiveGuildContract();
        if (!activeContract) return null;

        const template = GuildContracts.find(contract => contract.id === activeContract.templateId);
        if (!template) return null;

        const contractState = guild.guildContract;
        const hasFreshBaseline = Boolean(contractState && contractState.rotationDate === activeContract.rotationDate);
        if (!hasFreshBaseline) {
            return { template, breakdown: [] };
        }

        const breakdown = await computeMemberDeltas(guild, contractState.memberBaselines, template.statPath);
        breakdown.sort((a, b) => b.delta - a.delta);
        return { template, breakdown };
    }

    // Called from leave.js/kick.js right before a member is removed from
    // guild.memberList. Folds their delta-at-departure into the guild's permanent
    // frozenContribution bucket so their pre-departure progress isn't retroactively
    // removed from the aggregate, but also doesn't keep silently growing off their
    // lifetime workCount after they've left (workCount never resets and isn't
    // guild-scoped, so without this their post-departure /work elsewhere — including in
    // a brand new guild — would otherwise go on counting toward this guild's contract
    // forever). A no-op if there's no active contract, no fresh baseline for this guild
    // yet, the contract's already completed, or the departing member was never part of
    // this rotation's snapshot to begin with (e.g. they joined after the snapshot).
    async freezeDepartureContribution(guild, departingUserId, departingUserDetails) {
        const activeContract = await dynamoHandler.getActiveGuildContract();
        if (!activeContract) return null;

        const contractState = guild.guildContract;
        if (!contractState || contractState.rotationDate !== activeContract.rotationDate) return null;
        if (contractState.completed) return null;

        const baseline = contractState.memberBaselines[departingUserId];
        if (baseline === undefined) return null;

        const template = GuildContracts.find(contract => contract.id === contractState.templateId);
        if (!template) return null;

        const currentValue = departingUserDetails ? getStatValue(departingUserDetails, template.statPath) : undefined;
        const numericCurrent = Number.isFinite(currentValue) ? currentValue : baseline;
        const delta = Math.max(0, numericCurrent - baseline);

        const frozenContribution = Number.isFinite(contractState.frozenContribution) ? contractState.frozenContribution : 0;
        const updatedContractState = { ...contractState, frozenContribution: frozenContribution + delta };

        await dynamoHandler.updateGuildDatabase(guild.guildId, 'guildContract', updatedContractState);
        return updatedContractState;
    }
}

module.exports = {
    GuildContractFactory
}
