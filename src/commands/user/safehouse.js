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

// Pulled out so the confirm-button flow can recompute all of this off a freshly re-fetched
// userDetails right before applying the transaction, not just once before the up-to-30-
// second wait for a button click (see the picker branch below).
function computeSafehouseFigures(userDetails, slotNumber) {
    const ownedHouses = safehouseFactory.getAllOwnedHouses(userDetails);
    const record = slotNumber !== null ? (ownedHouses.find(s => s.slot === slotNumber) ?? null) : null;
    const userPotatoes = userDetails.potatoes;
    const totalStored = safehouseFactory.getTotalStored(userDetails);
    const totalCapacity = safehouseFactory.getTotalCapacity(userDetails);
    const depositHeadroom = record ? (safehouseFactory.getSlotDefinition(slotNumber, userDetails).capacity - record.balance) : safehouseFactory.getTotalRemainingSpace(userDetails);
    const withdrawAvailable = record ? record.balance : totalStored;
    return { ownedHouses, record, userPotatoes, totalStored, totalCapacity, depositHeadroom, withdrawAvailable };
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
            description: '0 = Main Safehouse (personal bank), or a house number — omit to auto-spread across all',
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

        let userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
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
        const rawHouse = interaction.options.get('house')?.value;
        const slotNumber = rawHouse === undefined ? null : Math.floor(rawHouse);

        // getAllOwnedHouses (via computeSafehouseFigures), not getOwnedSlots — a mercenary
        // can deposit/withdraw through Main Safehouse (their personal bank) even before
        // ever buying a numbered slot. Can be Infinity for depositHeadroom/totalCapacity
        // when the relevant house's bank-capacity regrade is fully maxed — every downstream
        // comparison already treats Infinity as a normal, never-binding upper bound with no
        // special-casing needed.
        let { ownedHouses, record, userPotatoes, totalStored, totalCapacity, depositHeadroom, withdrawAvailable } = computeSafehouseFigures(userDetails, slotNumber);
        if (ownedHouses.length === 0) {
            interaction.editReply(`${userDisplayName}, you don't own any safehouses yet — run \`/safehouse buy\` first.`);
            return;
        }
        if (slotNumber !== null && !record) {
            interaction.editReply(`${userDisplayName}, you don't own ${houseLabel(slotNumber)}. Run \`/safehouse list\` to see what you own, or leave \`house\` blank to spread it across what you do own.`);
            return;
        }

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

            // Re-fetch and recompute — up to 30 seconds passed while the picker sat
            // waiting on a button click, and this account's potatoes/safehouses/bankStored
            // could have moved in that window (another deposit/withdraw, a bounty win, a
            // rob, etc.). Without this, the eventual deposit/withdraw below would compute
            // its amount off the stale pre-picker snapshot and then WRITE that
            // stale-derived total back, silently overwriting whatever actually happened in
            // between — same discipline bank.js/companionSell.js/rebirth.js/shop.js already
            // use for their own confirm-button flows.
            const freshUserDetails = await dynamoHandler.findUser(userId, username);
            if (!freshUserDetails) {
                await interaction.editReply({ content: `${userDisplayName}, something went wrong re-checking your balances — please try again.`, embeds: [], components: [] });
                return;
            }
            userDetails = freshUserDetails;
            ({ ownedHouses, record, userPotatoes, totalStored, totalCapacity, depositHeadroom, withdrawAvailable } = computeSafehouseFigures(userDetails, slotNumber));
            if (slotNumber !== null && !record) {
                await interaction.editReply({ content: `${userDisplayName}, you don't own ${houseLabel(slotNumber)} anymore — please try again.`, embeds: [], components: [] });
                return;
            }

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
