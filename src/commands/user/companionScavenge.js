const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, convertSecondstoMinutes } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");

module.exports = {
    name: "companion-scavenge",
    description: "Send an owned, unequipped companion out scavenging for workCount and starches",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'companion',
            description: 'Which companion to send scavenging (must not be your active companion)',
            required: true,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    // Same reasoning as companionSell.js/companionSellNpc.js's autocomplete — a static
    // `choices` list showed every companion in the roster to every player regardless of
    // ownership. Since 2026-08-25's instance rework, one choice per independently-leveled
    // owned instance (value = instanceId), excluding whichever instance is currently
    // equipped (the callback below rejects the active instance too — this just keeps it
    // off the suggestion list in the first place). Not filtered on "already scavenging",
    // since that's a global one-slot check independent of which instance is picked, not a
    // per-instance eligibility check the way owning/equipping is.
    autocomplete: async (client, interaction) => {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const userId = interaction.user.id;
        const username = interaction.user.username;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            await interaction.respond([]);
            return;
        }

        const activeInstanceId = userDetails.companions?.active ?? null;
        const choices = (userDetails.companions?.owned ?? [])
            .filter(entry => entry.instanceId !== activeInstanceId)
            .map(entry => ({ entry, companion: companionFactory.getCompanionById(entry.id) }))
            .filter(({ companion }) => companion && companion.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(({ entry, companion }) => ({
                name: `${companion.name} (Lv. ${companionFactory.getCompanionLevel(entry.workCount)})`,
                value: entry.instanceId
            }));

        await interaction.respond(choices);
    },
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const instanceId = interaction.options.get('companion')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const ownedEntry = companionFactory.getOwnedEntry(userDetails, instanceId);
        if (!ownedEntry) {
            interaction.editReply(`${userDisplayName}, you don't own that companion.`);
            return;
        }
        const companion = companionFactory.getCompanionById(ownedEntry.id);
        if (!companion) {
            interaction.editReply(`${userDisplayName}, that's not a real companion.`);
            return;
        }
        if (userDetails.companions?.active === instanceId) {
            interaction.editReply(`${userDisplayName}, ${companion.name} is your active companion — equip a different one first (or leave it equipped) before sending it scavenging.`);
            return;
        }
        const existingScavenge = userDetails.companions?.scavenging;
        if (existingScavenge) {
            const scavengingEntry = companionFactory.getOwnedEntry(userDetails, existingScavenge.instanceId);
            const scavengingCompanion = scavengingEntry ? companionFactory.getCompanionById(scavengingEntry.id) : null;
            const scavengingName = scavengingCompanion?.name ?? 'A companion';
            if (existingScavenge.returnsAt <= Date.now()) {
                interaction.editReply(`${userDisplayName}, ${scavengingName} is already out scavenging and is ready to come home — run /companion-scavenge-collect first!`);
            } else {
                const remainingSeconds = Math.max(0, Math.ceil((existingScavenge.returnsAt - Date.now()) / 1000));
                interaction.editReply(`${userDisplayName}, ${scavengingName} is already out scavenging — it returns in ${convertSecondstoMinutes(remainingSeconds)}. Only one companion can scavenge at a time.`);
            }
            return;
        }

        // Plain unconditional write, deliberately not race-guarded — same low/no-stakes
        // race /companion's equip button already tolerates. A raced double-dispatch just means
        // whichever write lands last persists; no reward can be double-granted and no
        // companion is ever orphaned by it. See dynamoHandler.resolveScavenge's own
        // comment for the guarded collect/cancel writes this deliberately does NOT need.
        const scavenging = companionFactory.buildScavengeDispatch(companion, instanceId, ownedEntry.workCount);
        // lastUsedAt (2026-08-30, direct instruction — recently-used companions sort earlier
        // in /companion's list) — stamped on the dispatched instance itself, mirroring
        // companionFactory.levelActiveCompanion's own stamp for /work and every other
        // training path. Scavenging never routes through that function (a scavenging
        // instance can't be the active one, so it never levels via a normal grant), so this
        // is the one place that needs its own explicit stamp.
        const updatedOwned = userDetails.companions.owned.map(o =>
            o.instanceId === instanceId ? { ...o, lastUsedAt: Date.now() } : o
        );
        await dynamoHandler.updateUserFields(userId, {
            companions: { ...userDetails.companions, owned: updatedOwned, scavenging }
        });

        interaction.editReply(`${userDisplayName}, ${companion.name} heads out scavenging! It'll be back in ${convertSecondstoMinutes(Math.ceil((scavenging.returnsAt - Date.now()) / 1000))} — run /companion-scavenge-collect once it's returned.`);
    }
}
