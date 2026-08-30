const { ApplicationCommandOptionType, ButtonBuilder, ActionRowBuilder, ButtonStyle } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails } = require("../../utils/helperCommands")
const dynamoHandler = require("../../utils/dynamoHandler");
const { Bank, REGRADE_CAPS } = require("../../utils/constants");
const companionFactory = require("../../utils/companionFactory");
const rebirthFactory = require("../../utils/rebirthFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();
const spudKeepFactory = require("../../utils/spudKeepFactory");

function calculateTax(amount){
    return Bank.TAX_BASE + Math.floor(amount*Bank.TAX_PERCENT)
}

// Pulled out so the confirm-button flow can recompute this off a freshly re-fetched
// userDetails right before applying the transaction (see the picker branch below) instead
// of only ever computing it once, before the up-to-30-second wait for a button click.
function computeBankFigures(userDetails) {
    const userPotatoes = userDetails.potatoes;
    const userBankStored = userDetails.bankStored;
    const isBankCapacityMaxed = userDetails.regrades.bankCapacity.regradeAmount >= REGRADE_CAPS.bankCapacity;
    const bankCapacityPercent = companionFactory.getActivePerkValue(userDetails, "bankCapacityPercent");
    const rebirthPercent = rebirthFactory.getLiveRebirthPercent(userDetails);
    const userBankCapacity = isBankCapacityMaxed
        ? Infinity
        : Math.round(userDetails.bankCapacity * (1 + bankCapacityPercent + rebirthPercent));
    const remainingBankSpace = userBankCapacity - userBankStored;
    return { userPotatoes, userBankStored, userBankCapacity, remainingBankSpace };
}

function buildAmountPickerRow(action) {
    const actionLabel = action === 'deposit' ? 'Deposit' : 'Withdraw';
    const buttons = [25, 50, 100].map(pct => new ButtonBuilder()
        .setCustomId(`bank_pct_${pct}`)
        .setLabel(pct === 100 ? `${actionLabel} All` : `${pct}%`)
        .setStyle(pct === 100 ? ButtonStyle.Primary : ButtonStyle.Secondary));
    buttons.push(new ButtonBuilder().setCustomId('bank_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger));
    return new ActionRowBuilder().addComponents(buttons);
}

module.exports = {
    name: "bank",
    description: "Allows a member to deposit or withdraw potatoes to/from their bank",
    devOnly: false,
    // testOnly: false,
    deleted: false,
    options: [
        {
            name: 'action',
            description: 'Which action to take with your bank',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'deposit',
                    value: 'deposit'
                },
                {
                    name: 'withdraw',
                    value: 'withdraw'
                }
            ]
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
        // The whole point of fully regrading bank capacity is "never have to worry
        // about overflow again" — any finite number eventually gets bumped into by a
        // dedicated-enough player in an economy where rebirth stacking has no ceiling
        // (see Rebirth's own comment in constants.js), so once a player has actually
        // earned that milestone, capacity becomes genuinely unlimited rather than just
        // a very large number. REGRADE_CAPS.bankCapacity stays a real finite threshold
        // for bookkeeping purposes (rebirth eligibility, the fort_knox achievement) —
        // this only changes what happens once a player has cleared it.
        let { userPotatoes, userBankStored, userBankCapacity, remainingBankSpace } = computeBankFigures(userDetails);
        const bankHasCapacity = remainingBankSpace > 0;
        if (!bankHasCapacity && action == 'deposit') {
            interaction.editReply(`${userDisplayName}, you do not have anymore space in your bank! Upgrade your bank capacity to store more potatoes`);
            return;
        }

        let netAmount = interaction.options.get('amount')?.value;

        // No amount typed — offer a quick percentage picker instead of forcing a re-run
        // with a typed number.
        if (!netAmount) {
            if (action === 'deposit' && userPotatoes < 1) {
                interaction.editReply(`${userDisplayName}, you don't have any potatoes to deposit.`);
                return;
            }
            if (action === 'withdraw' && userBankStored < 1) {
                interaction.editReply(`${userDisplayName}, you don't have any potatoes to withdraw.`);
                return;
            }

            const pickerEmbed = embedFactory.createBankAmountPickerEmbed(userDisplayName, userId, userAvatar, action, userPotatoes, userBankStored, userBankCapacity);
            const reply = await interaction.editReply({ embeds: [pickerEmbed], components: [buildAmountPickerRow(action)] });

            const collectorFilter = i => i.user.id === interaction.user.id;
            const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

            if (!confirmation) {
                await reply.edit({ content: `${userDisplayName}, bank action timed out — nothing happened.`, embeds: [], components: [] }).catch(() => {});
                return;
            }
            if (confirmation.customId === 'bank_cancel') {
                await confirmation.update({ content: `${userDisplayName}, bank action cancelled.`, embeds: [], components: [] }).catch(() => {});
                return;
            }

            await confirmation.deferUpdate();

            // Re-fetch and recompute — up to 30 seconds passed while the picker sat
            // waiting on a button click, and this account's potatoes/bankStored/regrade
            // progress could have moved in that window (a /work, another /bank action from
            // a second interaction, etc.). Without this, the eventual deposit/withdraw
            // below would compute its amount off the stale pre-picker snapshot and then
            // WRITE that stale-derived total/bankStored back, silently overwriting whatever
            // actually happened in between — same "don't trust what was captured when the
            // page was first rendered" discipline companionSell.js/rebirth.js/shop.js
            // already use for their own confirm-button flows.
            const freshUserDetails = await dynamoHandler.findUser(userId, username);
            if (!freshUserDetails) {
                await interaction.editReply({ content: `${userDisplayName}, something went wrong re-checking your balance — please try again.`, embeds: [], components: [] });
                return;
            }
            userDetails = freshUserDetails;
            ({ userPotatoes, userBankStored, userBankCapacity, remainingBankSpace } = computeBankFigures(userDetails));

            const pct = Number(confirmation.customId.replace('bank_pct_', ''));
            netAmount = pct === 100 ? 'all' : String(Math.floor((action === 'deposit' ? userPotatoes : userBankStored) * pct / 100));
        }

        let totalAmount;
        if (action == 'deposit') {
            if (netAmount.toLowerCase() == 'all') {
                totalAmount = userPotatoes;
                if (totalAmount <= Bank.TAX_BASE) {
                    interaction.editReply(`${userDisplayName}, you do not have enough potatoes to deposit due to the base fee of ${Bank.TAX_BASE.toLocaleString()} potatoes! You have ${userPotatoes.toLocaleString()} potatoes left.`);
                    return;
                }
                netAmount = Math.round((totalAmount - Bank.TAX_BASE)/(1+Bank.TAX_PERCENT));
                if (netAmount >= remainingBankSpace) {
                    netAmount = remainingBankSpace;
                    totalAmount = netAmount + calculateTax(netAmount);
                }
            } else {
                netAmount = Math.floor(Number(netAmount));
                totalAmount = netAmount + calculateTax(netAmount);
                if (netAmount > remainingBankSpace) {
                    interaction.editReply(`${userDisplayName}, you do not have enough bank space to deposit ${netAmount.toLocaleString()}. You have ${remainingBankSpace.toLocaleString()} remaining.`);
                    return;
                }
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to store. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = netAmount >= 1;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only deposit positive amounts! You have ${userPotatoes.toLocaleString()} potatoes left.`);
                return;
            }

            const isAmountLessThanOrEqualUserAmount = totalAmount <= userPotatoes;
            if (!isAmountLessThanOrEqualUserAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough potatoes to deposit ${netAmount.toLocaleString()} potatoes! Total amount required is ${totalAmount.toLocaleString()} potatoes. You have ${userPotatoes.toLocaleString()} potatoes left.`);
                return;
            }
            userPotatoes -= totalAmount;
            userBankStored += netAmount;
            const adminUserShare = totalAmount - netAmount;
            // Spud Keep (systems/spud-keep.md) — while a holder is live, a share of this
            // tax is redirected to the accruing pot instead of the house account; a
            // no-op (100% to the house, byte-identical to before) whenever no holder is live.
            const { houseAmount, potAmount } = await spudKeepFactory.splitTaxForSpudKeepPot(adminUserShare);
            await dynamoHandler.addUserDatabase(client.user.id, 'potatoes', houseAmount);
            await spudKeepFactory.creditSpudKeepPot(potAmount);
            await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
            await dynamoHandler.updateUserDatabase(userId, "bankStored", userBankStored);

            const embed = embedFactory.createBankEmbed(userDisplayName, userId, userAvatar, 'deposit', netAmount, adminUserShare, userPotatoes, userBankStored, userBankCapacity);
            interaction.editReply({ content: '', embeds: [embed], components: [] });
        } else if (action == 'withdraw') {
            if (userBankStored == 0) {
                interaction.editReply(`${userDisplayName}, you do not have any potatoes to withdraw.`);
                return;
            } else if (netAmount.toLowerCase() == 'all') {
                netAmount = userBankStored;
            } else {
                netAmount = Math.floor(Number(netAmount));
                if (netAmount > userBankStored) {
                    interaction.editReply(`${userDisplayName}, you do not have ${netAmount.toLocaleString()} potatoes to withdraw. You have ${userBankStored.toLocaleString()} potatoes stored. Withdraw 'all' or give a valid amount.`);
                    return;
                }
                if (isNaN(netAmount)) {
                    interaction.editReply(`${userDisplayName}, something went wrong with your amount to withdraw. Try again!`);
                    return;
                }
            }

            const isAmountGreaterThanZero = netAmount >= 1;
            if (!isAmountGreaterThanZero) {
                interaction.editReply(`${userDisplayName}, you can only withdraw positive amounts! You have ${userBankStored.toLocaleString()} potatoes stored.`);
                return;
            }

            const isAmountLessThanOrEqualBankStoredAmount = netAmount <= userBankStored;
            if (!isAmountLessThanOrEqualBankStoredAmount) {
                interaction.editReply(`${userDisplayName}, you do not have enough stored to withdraw ${netAmount.toLocaleString()} potatoes! You have ${userBankStored.toLocaleString()} potatoes stored.`);
                return;
            }
            userPotatoes += netAmount;
            userBankStored -= netAmount;
            await dynamoHandler.updateUserDatabase(userId, "potatoes", userPotatoes);
            await dynamoHandler.updateUserDatabase(userId, "bankStored", userBankStored);

            const embed = embedFactory.createBankEmbed(userDisplayName, userId, userAvatar, 'withdraw', netAmount, 0, userPotatoes, userBankStored, userBankCapacity);
            interaction.editReply({ content: '', embeds: [embed], components: [] });
        }
    }
}
