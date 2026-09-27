const { ApplicationCommandOptionType } = require("discord.js");
const { getUserInteractionDetails, requireUserDetails, buildConfirmCancelRow, buildPaginationRow, runPaginatedReply } = require("../../utils/helperCommands")
const { shops, workRegradeTiers, passiveRegradeTiers, bankRegradeTiers } = require("../../utils/constants");
const dynamoHandler = require("../../utils/dynamoHandler");
const companionFactory = require("../../utils/companionFactory");
const { EmbedFactory } = require("../../utils/embedFactory");
const embedFactory = new EmbedFactory();

const TIERS_PAGE_SIZE = 6;
const CONFIRM_ID = 'regrade';

// One entry per `regrade-select` choice — the three tracks were previously three
// near-identical switch/case blocks (constants aside, they differed only in which
// userDetails field/shop/regrades key they read). Adding the confirm-preview step would
// have tripled that duplication instead of just adding it once, so this collects the
// per-track wiring into data and drives one shared code path below.
const TRACK_CONFIGS = {
    'work-multi': {
        tiers: workRegradeTiers,
        regradeKey: 'workMulti',
        shopId: 'workShop',
        label: 'Work Multiplier',
        unit: 'work multi',
        statField: 'workMultiplierAmount',
    },
    'passive-income': {
        tiers: passiveRegradeTiers,
        regradeKey: 'passiveAmount',
        shopId: 'passiveIncomeShop',
        label: 'Passive Amount',
        unit: 'potatoes',
        statField: 'passiveAmount',
    },
    'bank-capacity': {
        tiers: bankRegradeTiers,
        regradeKey: 'bankCapacity',
        shopId: 'bankShop',
        label: 'Bank Capacity',
        unit: 'potatoes',
        statField: 'bankCapacity',
    },
}

function doesUserHaveEnoughToPurchase(currentPotatoes, itemSelectedCost, interaction, userDisplayName) {
    if (currentPotatoes < itemSelectedCost) {
        interaction.editReply(`${userDisplayName} you do not have enough to regrade! You currently have ${currentPotatoes.toLocaleString()} potatoes and need ${(itemSelectedCost - currentPotatoes).toLocaleString()} more potatoes!`)
        return false;
    }
    return true
}

function hasRequiredBaseAmount(currentAmount, requiredBaseAmount, interaction, userDisplayName) {
    if (currentAmount < requiredBaseAmount) {
        interaction.editReply(`${userDisplayName} you need to have the maximum grade from the shop! Check your profile`)
        return false;
    }
    return true
}

// The highest tier whose own currentRegradeAmount has been reached or surpassed — not a
// strict `==` match. A player's regradeAmount should always land exactly on a real
// checkpoint by construction, but a strict match returns undefined the moment it doesn't
// (leftover pre-2026-09-26 drift from the old two-separate-writes bug, or any future bug of
// that same shape) — and checkEligibility immediately reads `.chance`/`.cost` off the
// result with no null check, which would crash the whole command rather than show a clean
// message. Falling back to the nearest lower tier degrades gracefully instead: the player
// sees whichever tier they've actually reached (or surpassed), not a thrown error.
function findCurrentRegradeTier(regradeTiers, currentRegradeAmount) {
    return [...regradeTiers].reverse().find((tier) => tier.currentRegradeAmount <= currentRegradeAmount) || regradeTiers[0];
}

function getBaseAmount(userDetails, config) {
    return Math.round(userDetails[config.statField] - userDetails.sweetPotatoBuffs[config.statField] - userDetails.regrades[config.regradeKey].regradeAmount);
}

function getRequiredBaseAmount(config) {
    const shop = shops.find((currentShop) => currentShop.shopId == config.shopId);
    return shop.items[shop.items.length - 1].amount;
}

// Read-only precondition check for showing the preview at all — does NOT touch potatoes
// or roll anything. Returns null (and has already replied with the usual error text) if
// either gate fails, or { currentTier, chanceOfSuccess, failStack } if the player is
// eligible to see (and, funds permitting, confirm) a regrade attempt.
function checkEligibility(userDetails, config, interaction, userDisplayName) {
    const currentTier = findCurrentRegradeTier(config.tiers, userDetails.regrades[config.regradeKey].regradeAmount);
    const requiredBaseAmount = getRequiredBaseAmount(config);
    const baseAmount = getBaseAmount(userDetails, config);

    if (!hasRequiredBaseAmount(baseAmount, requiredBaseAmount, interaction, userDisplayName)) return null;

    const regradeChanceBoostPercent = companionFactory.getActivePerkValue(userDetails, "regradeChanceBoostPercent");
    const failStack = userDetails.regrades[config.regradeKey].failStack;
    const chanceOfSuccess = currentTier.chance * (1 + regradeChanceBoostPercent) + failStack;
    return { currentTier, chanceOfSuccess, failStack };
}

// The actual spend+roll+write, unchanged in substance from the pre-confirm-step version
// of this command — only ever called once a Confirm click has re-validated eligibility
// against a fresh read.
//
// Batched into ONE dynamoHandler.updateUserFields call (2026-09-26 fix) — this used to be
// FOUR separate, sequential, unconditional single-field updateUserDatabase/addUserDatabase
// calls (potatoes, companions, regrades, then the stat field on success). Both of those
// helpers swallow DynamoDB errors via a bare .catch (console.debug only, never thrown), and
// nothing here checked their return values. If the "regrades" write landed but the stat
// field's write failed transiently right after, regradeAmount would show the increase while
// the raw stat never reflected it (or vice versa) — permanently desyncing base
// (statField - sweetPotatoBuffs - regradeAmount) from any real shop tier. This is the exact
// same anti-pattern class root-caused for enter-tower.js's processRewardPayouts on
// 2026-09-23 (see systems/tower.md), just never swept here — found while re-auditing every
// stat-granting path after that same desync recurred for a player whose account had
// already been manually corrected once (see roadmap.md's 2026-09-26 entry).
async function executeRegrade(userId, userDetails, config, currentTier, chanceOfSuccess, failStack, userDisplayName, userAvatar) {
    // Non-work-focused companion leveling (Elder Rootbeard's regradeChanceBoostPercent) —
    // the cost is a guaranteed sunk cost regardless of outcome, so this grant is
    // unconditional on success/fail too. Scales by this attempt's cost relative to this
    // TRACK's own cheapest tier. Restricted by PERK TYPE, not a specific companion id.
    const leveledCompanions = companionFactory.levelActiveCompanion(
        userDetails.companions,
        companionFactory.getRegradeWorkCountGrant(currentTier.cost, config.tiers[0].cost),
        null,
        "regradeChanceBoostPercent"
    );
    const companionXpGained = companionFactory.getAppliedCompanionXpGain(userDetails.companions, leveledCompanions);
    const companionName = companionFactory.getActiveCompanion(userDetails)?.name || null;

    const userRegrades = userDetails.regrades;
    const setFields = { companions: leveledCompanions, regrades: userRegrades };

    let newAmount = userDetails[config.statField];
    let increase = 0;
    if (Math.random() < chanceOfSuccess) {
        increase = currentTier.increase;
        userRegrades[config.regradeKey].regradeAmount += increase;
        userRegrades[config.regradeKey].failStack = 0;
        newAmount = userDetails[config.statField] + increase;
        setFields[config.statField] = newAmount;
    } else {
        userRegrades[config.regradeKey].failStack += currentTier.failStackIncrease;
    }

    await dynamoHandler.updateUserFields(userId, setFields, { potatoes: -currentTier.cost });

    return embedFactory.createRegradeEmbed(userDisplayName, userId, userAvatar, userDetails.potatoes - currentTier.cost, config.label, newAmount, increase, chanceOfSuccess, failStack, -currentTier.cost, companionXpGained, companionName);
}

// tier N's own 1-based rung on the FULL ladder (not per-page) + whether the player's own
// regradeAmount currently sits there — used by createRegradeTiersPageEmbed to mark "you
// are here" regardless of which page that tier lands on.
function buildTierRows(config, currentRegradeAmount) {
    return config.tiers.map((tier, i) => ({ tier, index: i + 1, isCurrent: tier.currentRegradeAmount === currentRegradeAmount }));
}

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks.length > 0 ? chunks : [[]];
}

module.exports = {
    name: "regrade",
    description: "Regrades your gear in the selected category",
    devOnly: false,
    options: [
        {
            name: 'regrade-select',
            description: 'Which attribute you want to upgrade',
            type: ApplicationCommandOptionType.String,
            required: true,
            choices: [
                {
                    name: 'work-multi',
                    value: 'work-multi'
                },
                {
                    name: 'passive-income',
                    value: 'passive-income'
                },
                {
                    name: 'bank-capacity',
                    value: 'bank-capacity'
                }
            ]
        },
        {
            name: 'view-tiers',
            description: 'View the full regrade tier ladder for this attribute instead of regrading',
            type: ApplicationCommandOptionType.Boolean,
            required: false,
        }
    ],
    deleted: false,
    callback: async (client, interaction) => {
        await interaction.deferReply();
        let regradeSelect = interaction.options.get('regrade-select')?.value;
        const viewTiers = interaction.options.get('view-tiers')?.value ?? false;
        const [userId, username, userDisplayName] = getUserInteractionDetails(interaction);
        const userAvatar = interaction.user.avatar;

        const userDetails = await requireUserDetails(interaction, userId, username, userDisplayName);
        if (!userDetails) return;

        const config = TRACK_CONFIGS[regradeSelect];

        if (viewTiers) {
            const currentRegradeAmount = userDetails.regrades[config.regradeKey].regradeAmount;
            const rows = buildTierRows(config, currentRegradeAmount);
            const pages = chunkArray(rows, TIERS_PAGE_SIZE);
            const renderPage = (idx) => embedFactory.createRegradeTiersPageEmbed(config.label, pages[idx], idx, pages.length, config.unit);

            const embed = renderPage(0);
            const components = pages.length > 1 ? [buildPaginationRow('regrade_tiers', 0, pages.length)] : [];
            const reply = await interaction.editReply({ embeds: [embed], components });

            await runPaginatedReply(reply, interaction, 'regrade_tiers', pages.length, renderPage);
            return;
        }

        const eligibility = checkEligibility(userDetails, config, interaction, userDisplayName);
        if (!eligibility) return;
        const { currentTier, chanceOfSuccess, failStack } = eligibility;
        const baseAmount = getBaseAmount(userDetails, config);
        // The preview's "Current" field (direct instruction, 2026-09-27: show base + regrades,
        // not just base) — baseAmount alone is the shop-tier checkpoint used for the
        // eligibility gate above, but that's not what a player thinks of as their "current"
        // stat: it strips out regrade progress they've already earned. Deliberately still
        // excludes sweetPotatoBuffs (Bonus) — that bucket comes from unrelated sources (Tower,
        // World Boss, etc.), not shop/regrade grinding, so it stays out of this command's own
        // number the same way baseAmount already did.
        const currentStatAmount = baseAmount + userDetails.regrades[config.regradeKey].regradeAmount;

        const previewEmbed = embedFactory.createRegradePreviewEmbed(userDisplayName, userId, userAvatar, userDetails.potatoes, config.label, currentStatAmount, currentTier.cost, currentTier.increase, chanceOfSuccess, failStack);
        const canAffordNow = userDetails.potatoes >= currentTier.cost;
        const components = canAffordNow ? [buildConfirmCancelRow(CONFIRM_ID, 'Regrade')] : [];
        const reply = await interaction.editReply({ embeds: [previewEmbed], components });
        if (!canAffordNow) return;

        const collectorFilter = i => i.user.id === interaction.user.id;
        const clicked = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 }).catch(() => null);
        if (!clicked || clicked.customId === `${CONFIRM_ID}_cancel`) {
            await reply.edit({ components: [] }).catch(() => {});
            return;
        }
        await clicked.deferUpdate();

        // Re-validated against a FRESH read rather than the userDetails the preview was
        // built from — the confirm button can sit on screen for up to 60s, long enough
        // for potatoes/regradeAmount to have genuinely moved in the meantime.
        const freshUserDetails = await dynamoHandler.findUser(userId, username);
        if (!freshUserDetails) {
            await reply.edit({ components: [] }).catch(() => {});
            return;
        }
        const freshEligibility = checkEligibility(freshUserDetails, config, interaction, userDisplayName);
        if (!freshEligibility) return;
        if (!doesUserHaveEnoughToPurchase(freshUserDetails.potatoes, freshEligibility.currentTier.cost, interaction, userDisplayName)) return;

        const embed = await executeRegrade(userId, freshUserDetails, config, freshEligibility.currentTier, freshEligibility.chanceOfSuccess, freshEligibility.failStack, userDisplayName, userAvatar);
        await interaction.editReply({ embeds: [embed], components: [] });
    }
}
