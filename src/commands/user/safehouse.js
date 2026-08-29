const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bank } = require("../../utils/constants");
const safehouseFactory = require("../../utils/safehouseFactory");
const mercenaryFactory = require("../../utils/mercenaryFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

// Main Safehouse (slot 0, the personal bank displayed as a Safehouse for mercenaries) gets
// its own name in every user-facing message instead of the generic "Safehouse #0".
function houseLabel(slotNumber) {
    return slotNumber === safehouseFactory.MAIN_SAFEHOUSE_SLOT ? 'Main Safehouse' : `Safehouse #${slotNumber}`;
}

function buildAmountPickerRow(action) {
    const actionLabel = action === 'deposit' ? 'Deposit' : 'Withdraw';
    const buttons = [25, 50, 100].map(pct => new ButtonBuilder()
        .setCustomId(`safehouse_pct_${pct}`)
        .setLabel(pct === 100 ? `${actionLabel} All` : `${pct}%`)
        .setStyle(pct === 100 ? ButtonStyle.Primary : ButtonStyle.Secondary));
    buttons.push(new ButtonBuilder().setCustomId('safehouse_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger));
    return new ActionRowBuilder().addComponents(buttons);
}

module.exports = {
    name: "safehouse",
    description: "Mercenary-exclusive: buy and manage safehouses, extra compartmentalized bank capacity",
    devOnly: false,
    deleted: false,
    options: [
        {
            name: 'action',
            description: 'Which action to take with your safehouses',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                { name: 'list', value: 'list' },
                { name: 'buy', value: 'buy' },
                { name: 'deposit', value: 'deposit' },
                { name: 'withdraw', value: 'withdraw' },
            ]
        },
        {
            name: 'house',
            description: '0 = Main Safehouse (your personal bank), or a safehouse number — omit to auto-spread across all of them',
            required: false,
            type: ApplicationCommandOptionType.Number,
        },
        {
            name: 'amount',
            description: 'Amount of potatoes: all | (amount) — omit to pick a quick percentage instead',
            required: false,
            type: ApplicationCommandOptionType.String,
        }
    ],
    callback: async (client, interaction) => {
        await interaction.deferReply();
        const action = interaction.options.get('action')?.value;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        // list/withdraw stay available even after /retire-mercenary — a mercenary's own
        // money is never trapped by giving up the mercenary track, same "no progress lost"
        // promise /retire-mercenary itself already makes. Only buy/deposit (growing what's
        // stashed) require currently being a mercenary.
        if ((action === 'buy' || action === 'deposit') && !userDetails.isMercenary) {
            interaction.editReply(`${userDisplayName}, safehouses are mercenary-exclusive — run /become-mercenary first.`);
            return;
        }

        if (action === 'list') {
            // getAllOwnedHouses, not getOwnedSlots — Main Safehouse belongs in this list
            // too (prepended first), same pooled view deposit/withdraw already use.
            const ownedHouses = safehouseFactory.getAllOwnedHouses(userDetails);
            const nextSlotInfo = safehouseFactory.getNextPurchasableSlot(userDetails);
            const rankInfo = mercenaryFactory.getMercenaryRankInfo(userDetails.mercenaryBountyWinCount);
            const embed = embedFactory.createSafehouseListEmbed(userDisplayName, userId, userAvatar, ownedHouses, nextSlotInfo, rankInfo, userDetails);
            interaction.editReply({ embeds: [embed] });
            return;
        }

        if (action === 'buy') {
            const result = safehouseFactory.buyNextSlot(userDetails);
            if (!result.ok) {
                interaction.editReply(`${userDisplayName}, ${result.reason}`);
                return;
            }

            await dynamoHandler.updateUserFields(userId, { potatoes: result.potatoes, safehouses: result.safehouses });
            interaction.editReply(`${userDisplayName}, you bought Safehouse #${result.slot.slot} for ${result.slot.cost.toLocaleString()} potatoes! It holds up to ${result.slot.capacity.toLocaleString()} potatoes — use \`/safehouse deposit\` to start stashing (leave \`house\` blank to spread it around automatically).`);
            return;
        }

        // deposit / withdraw share everything from here. `house` is optional — omitting it
        // is the smooth/default path: deposits get randomly spread across every owned,
        // not-full house (safehouseFactory.splitDepositRandomly) and withdrawals drain
        // whichever owned houses have balance (autoWithdrawAllocation), so a player never
        // HAS to think about which specific house they're using unless they want to.
        // getAllOwnedHouses, not getOwnedSlots — a mercenary can deposit/withdraw through
        // Main Safehouse (their personal bank) even before ever buying a numbered slot.
        const ownedHouses = safehouseFactory.getAllOwnedHouses(userDetails);
        if (ownedHouses.length === 0) {
            interaction.editReply(`${userDisplayName}, you don't own any safehouses yet — run \`/safehouse buy\` first.`);
            return;
        }

        const rawHouse = interaction.options.get('house')?.value;
        const slotNumber = rawHouse === undefined ? null : Math.floor(rawHouse);
        let record = null;
        if (slotNumber !== null) {
            record = ownedHouses.find(s => s.slot === slotNumber);
            if (!record) {
                interaction.editReply(`${userDisplayName}, you don't own ${houseLabel(slotNumber)}. Run \`/safehouse list\` to see what you own, or leave \`house\` blank to spread it across what you do own.`);
                return;
            }
        }

        let userPotatoes = userDetails.potatoes;
        const totalStored = safehouseFactory.getTotalStored(userDetails);
        const totalCapacity = safehouseFactory.getTotalCapacity(userDetails);
        // "Headroom"/"available" scope to the one picked house when given, otherwise the
        // combined total across every owned house. Can be Infinity when the picked house
        // (or Main Safehouse within the combined total) has its bank-capacity regrade fully
        // maxed — every downstream comparison here already treats Infinity as a normal,
        // never-binding upper bound with no special-casing needed.
        const depositHeadroom = record ? (safehouseFactory.getSlotDefinition(slotNumber, userDetails).capacity - record.balance) : safehouseFactory.getTotalRemainingSpace(userDetails);
        const withdrawAvailable = record ? record.balance : totalStored;

        let netAmount = interaction.options.get('amount')?.value;

        // No amount typed — offer a quick percentage picker instead of forcing a re-run
        // with a typed number, same UX /bank already offers.
        if (!netAmount) {
            if (action === 'deposit' && userPotatoes < 1) {
                interaction.editReply(`${userDisplayName}, you don't have any potatoes to deposit.`);
                return;
            }
            if (action === 'withdraw' && withdrawAvailable < 1) {
                interaction.editReply(record
                    ? `${userDisplayName}, you don't have any potatoes in ${houseLabel(slotNumber)} to withdraw.`
                    : `${userDisplayName}, you don't have any potatoes in any safehouse to withdraw.`);
                return;
            }
            if (action === 'deposit' && depositHeadroom <= 0) {
                interaction.editReply(record
                    ? `${userDisplayName}, ${houseLabel(slotNumber)} is already full!`
                    : `${userDisplayName}, all of your safehouses are already full!`);
                return;
            }

            const pickerEmbed = embedFactory.createSafehouseAmountPickerEmbed(userDisplayName, userId, userAvatar, action, slotNumber, userPotatoes, record?.balance ?? 0, totalStored, totalCapacity, userDetails);
            const reply = await interaction.editReply({ embeds: [pickerEmbed], components: [buildAmountPickerRow(action)] });

            const collectorFilter = i => i.user.id === interaction.user.id;
            const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

            if (!confirmation) {
                await reply.edit({ content: `${userDisplayName}, safehouse action timed out — nothing happened.`, embeds: [], components: [] }).catch(() => {});
                return;
            }
            if (confirmation.customId === 'safehouse_cancel') {
                await confirmation.update({ content: `${userDisplayName}, safehouse action cancelled.`, embeds: [], components: [] }).catch(() => {});
                return;
            }

            await confirmation.deferUpdate();
            const pct = Number(confirmation.customId.replace('safehouse_pct_', ''));
            netAmount = pct === 100 ? 'all' : String(Math.floor((action === 'deposit' ? userPotatoes : withdrawAvailable) * pct / 100));
        }

        let totalAmount;
        if (action === 'deposit') {
            if (depositHeadroom <= 0) {
                interaction.editReply(record
                    ? `${userDisplayName}, ${houseLabel(slotNumber)} is already full!`
                    : `${userDisplayName}, all of your safehouses are already full!`);
                return;
            }

            if (netAmount.toLowerCase() == 'all') {
                totalAmount = userPotatoes;
                if (totalAmount <= Bank.TAX_BASE) {
                    interaction.editReply(`${userDisplayName}, you don't have enough potatoes to deposit — depositing has a base fee of ${Bank.TAX_BASE.toLocaleString()} potatoes. You have ${userPotatoes.toLocaleString()} potatoes.`);
                    return;
                }
                netAmount = Math.round((totalAmount - Bank.TAX_BASE) / (1 + Bank.TAX_PERCENT));
                if (netAmount >= depositHeadroom) {
                    netAmount = depositHeadroom;
                }
                totalAmount = netAmount + safehouseFactory.calculateDepositTax(netAmount);
            } else {
                netAmount = Math.floor(Number(netAmount));
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to deposit. Try again!`);
                    return;
                }
                totalAmount = netAmount + safehouseFactory.calculateDepositTax(netAmount);
                if (netAmount > depositHeadroom) {
                    interaction.editReply(record
                        ? `${userDisplayName}, ${houseLabel(slotNumber)} only has ${depositHeadroom.toLocaleString()} potatoes of space remaining.`
                        : `${userDisplayName}, your safehouses only have ${depositHeadroom.toLocaleString()} potatoes of space remaining combined.`);
                    return;
                }
            }

            if (netAmount < 1) {
                interaction.editReply(`${userDisplayName}, you can only deposit positive amounts! You have ${userPotatoes.toLocaleString()} potatoes.`);
                return;
            }
            if (totalAmount > userPotatoes) {
                interaction.editReply(`${userDisplayName}, you don't have enough potatoes to deposit ${netAmount.toLocaleString()}! Total required (with fee) is ${totalAmount.toLocaleString()}. You have ${userPotatoes.toLocaleString()} potatoes.`);
                return;
            }

            const allocations = record
                ? [{ slot: slotNumber, amount: netAmount }]
                : safehouseFactory.splitDepositRandomly(userDetails, netAmount);

            userPotatoes -= totalAmount;
            const feeAmount = totalAmount - netAmount;
            // { safehouses, bankStored } — bankStored is only present when `allocations`
            // touched Main Safehouse (slot 0). Must be OMITTED from the update payload
            // entirely when undefined, not just set to undefined — updateUserFields'
            // buildUpdateExpression iterates Object.keys() and would hand DynamoDB a
            // literal undefined AttributeValue otherwise.
            const { safehouses: updatedSafehouses, bankStored: updatedBankStored } = safehouseFactory.applyMultiDeposit(userDetails, allocations);
            const updateFields = { potatoes: userPotatoes, safehouses: updatedSafehouses };
            if (updatedBankStored !== undefined) {
                updateFields.bankStored = updatedBankStored;
            }
            await dynamoHandler.addUserDatabase(client.user.id, 'potatoes', feeAmount);
            await dynamoHandler.updateUserFields(userId, updateFields);

            // Full userDetails (not just the changed fields) so getTotalStored's own
            // isMercenary/bankStored gating for Main Safehouse still has what it needs.
            const postWriteUserDetails = { ...userDetails, safehouses: updatedSafehouses, bankStored: updatedBankStored ?? userDetails.bankStored };
            const newTotalStored = safehouseFactory.getTotalStored(postWriteUserDetails);
            const embed = embedFactory.createSafehouseEmbed(userDisplayName, userId, userAvatar, 'deposit', allocations, feeAmount, userPotatoes, newTotalStored, totalCapacity);
            interaction.editReply({ content: '', embeds: [embed], components: [] });
        } else {
            if (netAmount.toLowerCase() == 'all') {
                netAmount = withdrawAvailable;
            } else {
                netAmount = Math.floor(Number(netAmount));
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to withdraw. Try again!`);
                    return;
                }
                if (netAmount > withdrawAvailable) {
                    interaction.editReply(record
                        ? `${userDisplayName}, ${houseLabel(slotNumber)} only has ${withdrawAvailable.toLocaleString()} potatoes stored.`
                        : `${userDisplayName}, your safehouses only have ${withdrawAvailable.toLocaleString()} potatoes stored combined.`);
                    return;
                }
            }

            if (netAmount < 1) {
                interaction.editReply(`${userDisplayName}, you can only withdraw positive amounts!`);
                return;
            }

            const allocations = record
                ? [{ slot: slotNumber, amount: netAmount }]
                : safehouseFactory.autoWithdrawAllocation(userDetails, netAmount);

            userPotatoes += netAmount;
            // Same { safehouses, bankStored } split-write shape as the deposit branch above.
            const { safehouses: updatedSafehouses, bankStored: updatedBankStored } = safehouseFactory.applyMultiWithdraw(userDetails, allocations);
            const updateFields = { potatoes: userPotatoes, safehouses: updatedSafehouses };
            if (updatedBankStored !== undefined) {
                updateFields.bankStored = updatedBankStored;
            }
            await dynamoHandler.updateUserFields(userId, updateFields);

            const postWriteUserDetails = { ...userDetails, safehouses: updatedSafehouses, bankStored: updatedBankStored ?? userDetails.bankStored };
            const newTotalStored = safehouseFactory.getTotalStored(postWriteUserDetails);
            const embed = embedFactory.createSafehouseEmbed(userDisplayName, userId, userAvatar, 'withdraw', allocations, 0, userPotatoes, newTotalStored, totalCapacity);
            interaction.editReply({ content: '', embeds: [embed], components: [] });
        }
    }
}
