const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const companionModule = require("./companion");

// 5 fixed favorite slots (1-5), stored as userDetails.companions.favorites[slot-1] —
// instanceId | null per slot, since a companion id alone can't identify a specific owned
// copy (2026-08-25's instance rework). Two distinct actions live behind one command,
// picked by whether `companion` was given:
// - WITH `companion`: saves that owned instance into the slot. Pure bookkeeping, no equip
//   — a player organizing all 5 slots shouldn't have their currently-active companion
//   swapped out on every single slot they fill in.
// - WITHOUT `companion`: quick-equips whatever's already saved in that slot, delegating to
//   companion.js's own exported attemptEquip (ownership/scavenging checks, the
//   already-active-toggles-off behavior, Max-Level flavor) rather than reimplementing any
//   of that here.
// No embed, plain text only (direct instruction).
module.exports = {
    name: "companion-favorite",
    description: "Save up to 5 favorite companions by slot, or quick-equip one already saved",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'slot',
            description: 'Favorite slot (1-5)',
            required: true,
            type: ApplicationCommandOptionType.Integer,
            choices: [1, 2, 3, 4, 5].map(n => ({ name: `${n}`, value: n }))
        },
        {
            name: 'companion',
            description: 'Which owned companion to save into this slot — omit to quick-equip whatever is already saved there',
            required: false,
            type: ApplicationCommandOptionType.String,
            autocomplete: true
        }
    ],
    // Every owned instance is a valid pick, regardless of rarity or whether it's currently
    // out scavenging — favoriting is just a bookmark, not an equip, so a transient
    // scavenging state shouldn't block saving one to a slot.
    autocomplete: async (client, interaction) => {
        const focused = (interaction.options.getFocused() || '').toLowerCase();
        const userId = interaction.user.id;
        const username = interaction.user.username;

        const userDetails = await dynamoHandler.findUser(userId, username);
        if (!userDetails) {
            await interaction.respond([]);
            return;
        }

        const choices = (userDetails.companions?.owned ?? [])
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
        await interaction.deferReply({ ephemeral: true });
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const slot = interaction.options.get('slot')?.value;
        const instanceId = interaction.options.get('companion')?.value;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const favorites = userDetails.companions?.favorites ?? [null, null, null, null, null];

        if (instanceId) {
            const ownedEntry = companionFactory.getOwnedEntry(userDetails, instanceId);
            if (!ownedEntry) {
                interaction.editReply(`${userDisplayName}, you don't own that companion.`);
                return;
            }
            const companion = companionFactory.getCompanionById(ownedEntry.id);
            const newFavorites = [...favorites];
            newFavorites[slot - 1] = instanceId;
            await dynamoHandler.updateUserFields(userId, {
                companions: { ...userDetails.companions, favorites: newFavorites }
            });
            interaction.editReply(`${userDisplayName}, saved ${companion.name} to favorite slot ${slot}.`);
            return;
        }

        const savedInstanceId = favorites[slot - 1];
        if (!savedInstanceId) {
            interaction.editReply(`${userDisplayName}, favorite slot ${slot} is empty — run \`/companion-favorite\` again with a companion to save one there first.`);
            return;
        }

        const result = await companionModule.attemptEquip(userId, username, savedInstanceId);
        interaction.editReply(`${userDisplayName}, ${result.message}`);
    }
}
