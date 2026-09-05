const dynamoHandler = require("../utils/dynamoHandler");
const tC = require("./towerConstants.js");
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder} = require("discord.js");

// getUsers()-style external/partial data guard (dynamoHandler.js's/spudKeepFactory.js's own
// toNumber precedent) — a mis-authored future ENCOUNTERS/TRANSACTIONS/REWARDS entry missing a
// `value` must not propagate NaN into a stored run total.
function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

class towerFactory{

    constructor(_interaction, _username, multi, autoContinue = false) {
        this.floor = 0
        this.run = Object.assign({}, tC.RUN)
        this.run[tC.PAYOUT.ELITE_KILL] = new Array()
        this.username = _username
        this.interaction = _interaction
        this.multi = multi
        // Reward VALUE scaling (2026-08-31) — computed once, here, from the same one-time
        // this.multi snapshot execElite's success-chance formula already relies on never
        // changing mid-run. See tower.md's "Tower Revamp: Reward Value Scaling" section.
        this.scalingFactor = Math.pow(scalingFactor(this.multi), tC.SCALING_EXPONENT)
        this.difficulty = tC.TOWER_ELITE_DIFFICULTY_INITIAL
        this.died = false
        // Persistent account-level toggle (see /tower-settings) — skips the dedicated
        // Continue/Leave screen after a non-Elite floor, see createFloorEmbed/resolveNext.
        this.autoContinue = autoContinue
        // Set once, up front, by chooseRiskPolicy() before the floor loop begins.
        this.policy = null
        // The previous floor's result text, prefaced onto the next floor's own embed when
        // autoContinue is on and its dedicated result screen was skipped. See resolveNext.
        this.lastResultText = null
        // Per-run REWARD variety cap (2026-09-04, direct instruction) — without this, a single
        // deep run can roll the same REWARDS entry (e.g. Golden Ginger) over and over, each hit
        // stacking another PERMANENT passive income/bank capacity grant with no bound. Tracks
        // which REWARDS entries (by name) this run has already offered; execNormalFloor's REWARD
        // branch excludes them from the pool until every entry has come up once, then resets so
        // a very long run doesn't run out of REWARD content. Shared by both the interactive and
        // fastForwardToNextElite's silent path, since both funnel through execNormalFloor on the
        // same instance.
        this.usedRewards = new Set()
    }

    async startRun(){
        await this.chooseRiskPolicy()
        let floor_type = "COMBAT"
        var cont = true
        while(cont){
            this.floor++
            // console.log(this.run, this.username)
            if(this.floor % 10 == 0){
                // EVERY TEN: THROW ELITE ASK FOR CONTINUE THEN RAISE DIFFICULTY
                cont = await this.execElite(this.difficulty)
                this.difficulty *= tC.TOWER_ELITE_DIFFICULTY_RATIO
                floor_type = getFloor()
                continue;
            }

            cont = await this.execNormalFloor(floor_type)
            floor_type = getFloor()
        }
        return [this.run, this.floor, this.died]
    }

    // One extra click added to every run, up front, before any floor is ever generated — sets
    // this.policy so FAST_FORWARD can be unconditionally included in every floor's button row
    // from floor 1 onward (no "is a policy set yet" branching needed anywhere else).
    async chooseRiskPolicy(){
        const embed = new EmbedBuilder()
            .setTitle(`Tater Tower: ${this.username}`)
            .setDescription(`Before you climb, choose how the tower resolves choices for you whenever you Fast Forward past non-Elite floors:\n\n**Play it safe** — never take a needless loss, never voluntarily seek out an extra Elite fight.\n**Go for it** — always take the bigger swing, and seek out bonus Elite fights whenever the chance arises.\n\nThis only affects Fast Forward — floors you click through yourself are entirely up to you.`)
            .setColor("Gold")
            .setTimestamp(Date.now())
            .setFooter({text: `Tater Tower: ${this.username}`});

        const row = new ActionRowBuilder().addComponents(tC.SAFE_POLICY, tC.GREEDY_POLICY)
        const reply = await this.interaction.editReply({
            embeds: [embed],
            components: [row],
        });

        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        // Timed out -> defaults to SAFE, matching every other collector's safest-default
        // convention in this file.
        if(!confirmation){
            await this.interaction.editReply({ components: [] }).catch(() => {});
            this.policy = tC.POLICY.SAFE
            return
        }
        await confirmation.update({content: '', components: []})
        this.policy = confirmation.customId === 'policy_greedy' ? tC.POLICY.GREEDY : tC.POLICY.SAFE
    }

    async execNormalFloor(floor_type, silent = false, policy = null){
        let fl
        let type
        let color
        switch(floor_type){
            case "COMBAT":
                fl = tC.COMBATS[Math.floor(Math.random() * tC.COMBATS.length)]
                type = "COMBAT"
                color = "Orange"
                break
            case "ENCOUNTER":
                fl = tC.ENCOUNTERS[Math.floor(Math.random() * tC.ENCOUNTERS.length)]
                type = "ENCOUNTER"
                color = "Yellow"
                break
            case "TRANSACTION":
                fl = tC.TRANSACTIONS[Math.floor(Math.random() * tC.TRANSACTIONS.length)]
                type = `TRANSACTION (${this.run[tC.PAYOUT.POTATOES].toLocaleString()} potatoes)`
                color = "Blue"
                break
            case "REWARD": {
                let pool = tC.REWARDS.filter(r => !this.usedRewards.has(r.name))
                if(pool.length === 0){
                    this.usedRewards.clear()
                    pool = tC.REWARDS
                }
                fl = pool[Math.floor(Math.random() * pool.length)]
                this.usedRewards.add(fl.name)
                type = "REWARD"
                color = "Purple"
                break
            }
        }

        let description = fl.description
        if(floor_type === "REWARD" && fl.kill_elite == true){
            let nextElite = (Math.floor(this.floor / 10) + 1) * 10
            description = fl.description + `${nextElite}` + fl.description2
        }

        let index
        if(silent){
            index = pickChoiceIndex(fl, policy)
        }else{
            index = await this.createFloorEmbed(fl, type, color, description)
            if(index === 'leave'){
                // The player left before choosing this floor's own outcome at all — same
                // ending createNextEmbed's LEAVE branch produces today.
                return false
            }
            if(index === 'fast_forward'){
                return await this.runFastForward(floor_type, fl, color)
            }
        }

        if(floor_type === "TRANSACTION"){
            return this.updateTransaction(fl, index, color, silent)
        }
        return this.updateValue(fl, index, color, silent)
    }

    // Handles a "Fast Forward" click: folds the floor that was clicked on into the same silent
    // batch every subsequent floor goes through (rather than resolving it click-by-click first),
    // then hands off to fastForwardToNextElite() for everything after it. Fully owns the whole
    // fast-forward chain end to end and returns the same plain continue/leave boolean
    // execNormalFloor always returns, so startRun's own loop needs zero special-casing.
    //
    // The summary embed is ONLY ever shown in the one case where nothing has displayed a
    // terminal screen yet — reaching the pending forced Elite with no mid-chain detour. Both
    // "triggeredElite" cases (immediate or mid-chain) mean execElite has ALREADY run for real
    // and shown its own final embed (win/death/decline) via a real Discord round-trip; calling
    // createFastForwardSummaryEmbed afterward would silently overwrite that screen with the
    // aggregate summary before the player ever sees it — most importantly hiding a death.
    async runFastForward(floor_type, fl, color){
        const summary = emptyFastForwardSummary()
        const index = pickChoiceIndex(fl, this.policy)
        const firstOutcome = floor_type === "TRANSACTION"
            ? await this.updateTransaction(fl, index, color, true)
            : await this.updateValue(fl, index, color, true)
        applyOutcomeToSummary(summary, firstOutcome)

        if(firstOutcome && firstOutcome.triggeredElite){
            // Already fully resolved and displayed by execElite — nothing left to show.
            return firstOutcome.cont
        }

        const ffResult = await this.fastForwardToNextElite()
        mergeFastForwardSummaries(summary, ffResult.summary)

        if(ffResult.stoppedMidChain){
            // Same as above — a mid-chain Elite already ran for real and shown its own
            // terminal embed inside fastForwardToNextElite's own loop.
            return ffResult.cont
        }

        // Reached the pending forced Elite with nothing else in the way — show what the
        // batch gained, THEN run the real fight, whose own embed becomes the true final screen.
        await this.createFastForwardSummaryEmbed(summary)
        const cont = await this.execElite(this.difficulty)
        this.difficulty *= tC.TOWER_ELITE_DIFFICULTY_RATIO
        return cont
    }

    // The actual batch loop — auto-resolves every COMBAT/ENCOUNTER/TRANSACTION/REWARD floor
    // between here and the next forced Elite (or an earlier mid-chain Elite triggered by a
    // greedy Wandering Woods/Wizard Lime pick), making zero Discord round-trips along the way.
    async fastForwardToNextElite() {
        const summary = emptyFastForwardSummary()
        let floor_type = getFloor()
        while (this.floor % 10 !== 0) {
            this.floor++
            if (this.floor % 10 === 0) break   // reached the next forced Elite floor — stop, caller runs it for real
            const outcome = await this.execNormalFloor(floor_type, true, this.policy)
            applyOutcomeToSummary(summary, outcome)
            if (outcome && outcome.triggeredElite) {
                // A mid-chain Elite already ran for real by the time control gets back
                // here — stop the loop, don't roll another floor after it.
                return { summary, cont: outcome.cont, stoppedMidChain: true }
            }
            floor_type = getFloor()
        }
        return { summary, cont: null, stoppedMidChain: false }   // cont: null means "caller still
                                                                   // needs to run the forced Elite"
    }

    async execElite(difficulty){
        let fl = pickElite(Math.floor(this.floor / 10))
        let success = (this.multi + this.run[tC.MODIFIER.WORK_MULTIPLIER]) / (difficulty * fl.difficulty)
        if(success > tC.ELITE_SUCCESS_CAP){
            success = tC.ELITE_SUCCESS_CAP
        }
        let fight = await this.createEliteEmbed(fl, success)

        if(!fight){
            this.floor--
            return false
        }
        if (Math.random() < success){
            // Elite fight rewards were deliberately never routed through decayValue (floor-
            // depth decay explicitly exempts them, since Elites already carry their own risk
            // throttle via the difficulty curve) — but that exemption is about floor DEPTH,
            // a different axis than player POWER, so scaleReward still applies here.
            this.run[tC.PAYOUT.POTATOES] += this.scaleReward(tC.PAYOUT.POTATOES, fl.choices[0].value)
            // handle reward payouts
            this.checkElitePayout()
            return this.createNextEmbed(fl, fl.choices[0].result, "Green")
        }
        this.run[tC.PAYOUT.WORK_MULTIPLIER] = 0
        this.run[tC.PAYOUT.PASSIVE_INCOME] = 0
        this.run[tC.PAYOUT.BANK_CAPACITY] = 0
        this.died = true
        return this.createDeathEmbed(fl.lose)

    }

    // A per-run diminishing multiplier on non-Elite floor payouts past a floor threshold — see
    // tower.md's "Reward safeguard" section. Never decays MODIFIER.WORK_MULTIPLIER (a temporary
    // in-run survival tool, not economy-facing income); never touches a TRANSACTION's price or
    // an Elite fight's own reward (callers simply never route those through here).
    decayValue(outcomeIndex, rawValue){
        const value = toNumber(rawValue)
        if(outcomeIndex === tC.MODIFIER.WORK_MULTIPLIER){
            return value
        }
        const floorsPastGrace = Math.max(0, this.floor - tC.TOWER_REWARD_GRACE_FLOOR)
        const decayMultiplier = Math.pow(tC.TOWER_REWARD_DECAY_RATIO, floorsPastGrace)
        return value * decayMultiplier
    }

    // Reward VALUE scaling (2026-08-31) — a different axis than decayValue above (that one
    // decays by floor DEPTH; this one scales by player POWER, via this.scalingFactor, which
    // is derived once at construction time from this.multi). A reward's raw value is
    // multiplied by this.scalingFactor only when its outcome index is one of the three
    // "economy-facing" currencies (see tower.md part 2) — PAYOUT.WORK_MULTIPLIER and
    // MODIFIER.WORK_MULTIPLIER both pass through completely unscaled (and unrounded —
    // work multiplier is legitimately fractional, e.g. Traveling Turnip's flat 0.2).
    //
    // Rounded here (2026-08-31, bug fix) — this.scalingFactor is essentially never an
    // integer, and decayValue above already isn't either past floor 100 (0.95^n). Every
    // PAYOUT.POTATOES/PASSIVE_INCOME/BANK_CAPACITY addition in this file funnels through
    // this one function, so rounding here is the single point that guarantees a player's
    // actual currency balance (potatoes/passiveAmount/bankCapacity are real money, not a
    // display-only stat) never lands on a fractional value — was previously left fractional
    // and credited straight to the DB (e.g. a live run crediting 692,258.284 passive income).
    scaleReward(outcomeIndex, rawValue){
        if(!tC.SCALED_PAYOUT_TYPES.has(outcomeIndex)){
            return rawValue
        }
        return Math.round(rawValue * this.scalingFactor)
    }

    // Per-run maximum gain cap (2026-09-04, direct instruction) — the single point every
    // WORK_MULTIPLIER/PASSIVE_INCOME/BANK_CAPACITY credit in this file funnels through (the
    // immediate REWARD/TRANSACTION branch in updateValue/updateTransaction, and King Kiwi's
    // deferred payout in checkElitePayout). Once this.run[type] would exceed
    // tC.TOWER_RUN_CAPS[type], only the remaining room is credited to that type; for
    // PASSIVE_INCOME/BANK_CAPACITY the leftover converts 1:1 into POTATOES instead of being
    // lost outright (both are already potato-denominated — a bank capacity/passive income
    // amount IS a count of potatoes, just held in a different bucket — so this isn't an
    // invented exchange rate). WORK_MULTIPLIER has no natural potato equivalent, so its
    // overflow is simply not granted; the 10x cap is generous enough (real runs top out well
    // under 2x, see tower.md) that this almost never engages. PAYOUT.POTATOES itself has no
    // entry in TOWER_RUN_CAPS and is credited in full, uncapped, same as before. Returns the
    // amount actually applied to `type` (not the raw pre-cap amount) so callers that report a
    // per-floor delta (updateValue/updateTransaction's silent outcome, read by the Fast
    // Forward summary embed) can't claim more than what actually landed in this.run[type] —
    // the same "displayed number must match what's credited" principle the REWARD wording
    // fix above applies to. The potatoes overflow itself isn't threaded back through that
    // return value — it would only under-report the summary's potatoes delta in the same rare
    // case a cap engages, a much smaller and more forgivable gap than over-promising.
    creditRunPayout(type, amount){
        const cap = tC.TOWER_RUN_CAPS[type]
        if(cap === undefined){
            this.run[type] += amount
            return amount
        }
        const room = Math.max(0, cap - this.run[type])
        const applied = Math.min(amount, room)
        this.run[type] += applied
        const overflow = amount - applied
        if(overflow > 0 && (type === tC.PAYOUT.PASSIVE_INCOME || type === tC.PAYOUT.BANK_CAPACITY)){
            this.run[tC.PAYOUT.POTATOES] += overflow
        }
        return applied
    }

    // Shared by every non-Elite resolution branch that would otherwise always show a dedicated
    // Continue/Leave screen. When autoContinue is on (and we're not already inside a silent
    // fast-forward batch, which never calls this at all), skips that screen and lets the next
    // floor's own createFloorEmbed be the only screen shown, prefacing this floor's result text
    // onto it so nothing about what just happened is lost.
    async resolveNext(fl, resultText, color){
        if(this.autoContinue){
            this.lastResultText = resultText
            return true
        }
        return this.createNextEmbed(fl, resultText, color)
    }

    async updateValue(fl, index, color = "Green", silent = false){
        const choice = fl.choices[index]
        switch(choice.outcome){
            case tC.CHOICES.EXIT:
                if(silent){
                    return { name: fl.name, resultText: choice.result, outcome: null, amount: 0 }
                }
                return this.resolveNext(fl, choice.result, color)
            case tC.CHOICES.ELITE:
                if(silent){
                    // The one place silent does NOT suppress a real Discord round-trip —
                    // execElite always stops for a genuine Fight/Leave decision. Only the
                    // flavor-only "prepare for combat" interstitial is skipped.
                    const cont = await this.execElite(this.difficulty)
                    return { name: fl.name, resultText: choice.result, outcome: null, amount: 0, triggeredElite: true, cont }
                }
                await this.createEliteEncounter(fl, choice.result)
                return this.execElite(this.difficulty)
            case tC.PAYOUT.ELITE_KILL: {
                let nextElite = (Math.floor(this.floor / 10) + 1) * 10
                // Decayed once, at the floor the promise is made — checkElitePayout itself
                // needs zero changes, it just adds whatever number is already in the queue.
                let amount = this.scaleReward(choice.type, this.decayValue(choice.type, choice.value))
                let elite_kill = [nextElite, choice.type, amount]
                this.run[tC.PAYOUT.ELITE_KILL].push(elite_kill)
                if(silent){
                    return { name: fl.name, resultText: choice.result, outcome: null, amount: 0, notableText: `${fl.name} promised a bonus at floor ${nextElite}: ${choice.name}` }
                }
                return this.resolveNext(fl, choice.result, color)
            }
            default: {
                let value = this.scaleReward(choice.outcome, this.decayValue(choice.outcome, choice.value))
                let applied = this.creditRunPayout(choice.outcome, value)
                if(silent){
                    return { name: fl.name, resultText: choice.result, outcome: choice.outcome, amount: applied }
                }
                return this.resolveNext(fl, choice.result, color)
            }
        }
    }

    async updateTransaction(fl, index, color = "Green", silent = false){
        const choice = fl.choices[index]
        let poor = this.run[tC.PAYOUT.POTATOES] < choice.price
        if(choice.outcome == tC.CHOICES.EXIT){
            if(silent){
                return { name: fl.name, resultText: choice.result, outcome: null, amount: 0 }
            }
            return this.resolveNext(fl, choice.result, color)
        }else if(choice.outcome==tC.CHOICES.ELITE ){
            if(silent){
                const cont = await this.execElite(this.difficulty)
                return { name: fl.name, resultText: choice.result, outcome: null, amount: 0, triggeredElite: true, cont }
            }
            await this.createEliteEncounter(fl, choice.result)
            return this.execElite(this.difficulty)
        }
        // check if enough money
        if(poor){
            if(fl.poor_outcome == tC.CHOICES.ELITE){
                if(silent){
                    const cont = await this.execElite(this.difficulty)
                    return { name: fl.name, resultText: fl.poor, outcome: null, amount: 0, triggeredElite: true, cont }
                }
                await this.createEliteEncounter(fl, fl.poor)
                return this.execElite(this.difficulty)
            }
            if(silent){
                return { name: fl.name, resultText: fl.poor, outcome: null, amount: 0 }
            }
            return this.resolveNext(fl, fl.poor, color)
        }

        // update outcome + value then subtract price — only the value bought decays/scales,
        // never the price itself (see tower.md's reward-safeguard scope and the reward-value-
        // scaling section's identical scope decision for the same field).
        let value = this.scaleReward(choice.outcome, this.decayValue(choice.outcome, choice.value))
        let applied = this.creditRunPayout(choice.outcome, value)
        this.run[tC.PAYOUT.POTATOES]-= choice.price
        if(silent){
            return { name: fl.name, resultText: choice.result, outcome: choice.outcome, amount: applied, pricePaid: choice.price, notableText: `Bought "${fl.name}" for ${choice.price.toLocaleString()} potatoes` }
        }
        return this.resolveNext(fl, choice.result, color)
    }

    async checkElitePayout(){
        let remove_index = []
        for(const [i, payout] of this.run[tC.PAYOUT.ELITE_KILL].entries()){
            // console.log(i)
            // console.log(payout)
            if(this.floor == payout[tC.REWARD_PAYOUT.FLOOR]){
                this.creditRunPayout(payout[tC.REWARD_PAYOUT.TYPE], payout[tC.REWARD_PAYOUT.AMOUNT])
                remove_index.push(i)
            }
        }

        // console.log(remove_index)
        for(let i = remove_index.length - 1; i >= 0; i--){
            this.run[tC.PAYOUT.ELITE_KILL].splice(remove_index[i], 1)
        }
    }

    async createFloorEmbed(fl, type, color, description){
        let fullDescription = description
        if(this.lastResultText){
            fullDescription = `${this.lastResultText}\n\n---\n\n${description}`
            this.lastResultText = null
        }

        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}: ${type}\n${fl.name}`)
            .setDescription(fullDescription)
            .setColor(color)
            .setTimestamp(Date.now())
            .setThumbnail(fl.thumbnailUrl)
            .setFooter({text: `Tater Tower: ${this.username}`});

        const buttons = fl.choices.map((choice) =>{
            return new ButtonBuilder()
                .setCustomId(choice.name)
                .setLabel(choice.name)
                .setStyle(ButtonStyle.Primary)
        });

        // FAST_FORWARD is unconditionally present from floor 1 onward (this.policy is always
        // set by chooseRiskPolicy() before this is ever called); LEAVE only shows up when the
        // player has opted into auto-continue. Worst case (King Kiwi's 3 choices + both extras)
        // is 5 buttons, exactly Discord's per-row cap.
        const rowComponents = [...buttons, tC.FAST_FORWARD, ...(this.autoContinue ? [tC.LEAVE] : [])]
        const row = new ActionRowBuilder().addComponents(rowComponents)
        const reply = await this.interaction.editReply({
            embeds: [embed],
            components: [row],
        });

        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        // A timed-out/unresponsive click defaults to the floor's first listed choice
        // rather than hanging the run forever or throwing on the next editReply once the
        // interaction token has gone stale.
        if(!confirmation){
            await this.interaction.editReply({ components: [] }).catch(() => {});
            return 0
        }
        if(confirmation.customId === 'fast_forward'){
            await confirmation.update({content: '', components: []})
            return 'fast_forward'
        }
        if(confirmation.customId === 'leave'){
            await confirmation.update({content: '', components: []})
            return 'leave'
        }
        for (var i in fl.choices){
            if(confirmation.customId == fl.choices[i].name){
                await confirmation.update({content: '', components: []})
                return i
            }
        }
    }

    async createNextEmbed(fl, description, color = 'Green'){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}: ${fl.name}\n${this.username}: ${(this.multi + this.run[tC.MODIFIER.WORK_MULTIPLIER]).toFixed(2)}x (${this.run[tC.MODIFIER.WORK_MULTIPLIER].toFixed(2)}x)`)
            .setDescription(`${description}`)
            .setColor(color)
            .setTimestamp(Date.now())
            .setThumbnail("https://cdn.discordapp.com/avatars/1187560268172116029/2286d2a5add64363312e6cb49ee23763.png")
            .setFooter({text: `Tater Tower: ${this.username}`})
            .addFields(
                {
                    name: "Potatoes:",
                    value: `${this.run[tC.PAYOUT.POTATOES].toLocaleString()}`,
                    inline: false,
                },
                {
                    name: "Work Multiplier:",
                    value: `${this.run[tC.PAYOUT.WORK_MULTIPLIER].toFixed(2)}x`,
                    inline: false,
                },
                {
                    name: "Passive Income:",
                    value: `${this.run[tC.PAYOUT.PASSIVE_INCOME].toLocaleString()}`,
                    inline: false,
                },
                {
                    name: "Bank Capacity:",
                    value: `${this.run[tC.PAYOUT.BANK_CAPACITY].toLocaleString()}`,
                    inline: false,
                }
            );

        const row = new ActionRowBuilder().addComponents(tC.CONT, tC.LEAVE)
        const reply = await this.interaction.editReply({
            embeds: [embed],
            components: [row],
        });

        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        // A timed-out/unresponsive click is treated as LEAVE — banks whatever's already
        // accumulated rather than losing it to an expired interaction token further down
        // the run (Discord's webhook token is only good for ~15 minutes total; safest
        // default is to stop here, not silently hang or throw).
        if(!confirmation){
            await this.interaction.editReply({ components: [] }).catch(() => {});
            return false
        }
        if(confirmation.customId == "continue"){
            await confirmation.update({content: '', components: []})
            return true
        }else if(confirmation.customId == "leave"){
            await confirmation.update({content: '', components: []})
            return false
        }
    }

    async createEliteEmbed(fl, success){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}: ELITE\n${fl.name}: ${(this.multi + this.run[tC.MODIFIER.WORK_MULTIPLIER]).toFixed(2)}x (${this.run[tC.MODIFIER.WORK_MULTIPLIER].toFixed(2)}x)`)
            .setDescription(fl.description + `\n\nSuccess Chance: ${(success*100).toFixed(2)}%`)
            .setColor("Red")
            .setTimestamp(Date.now())
            .setThumbnail(fl.thumbnailUrl)
            .setFooter({text: `Tater Tower: ${this.username}`});

        const row = new ActionRowBuilder().addComponents(tC.FIGHT, tC.LEAVE)
        const reply = await this.interaction.editReply({
            embeds: [embed],
            components: [row],
        });

        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        // Timed out -> declines the fight, same as an explicit Leave (never risk a run
        // dying to an unresponsive click).
        if(!confirmation){
            await this.interaction.editReply({ components: [] }).catch(() => {});
            return false
        }
        if(confirmation.customId == "fight"){
            await confirmation.update({content: '', components: []})
            return true
        }else if(confirmation.customId == "leave"){
            await confirmation.update({content: '', components: []})
            return false
        }
    }

    async createEliteEncounter(fl, description){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}\n${fl.name}: ${(this.multi + this.run[tC.MODIFIER.WORK_MULTIPLIER]).toFixed(2)}x (${this.run[tC.MODIFIER.WORK_MULTIPLIER].toFixed(2)}x)`)
            .setDescription(description)
            .setColor('Red')
            .setTimestamp(Date.now())
            .setThumbnail(fl.thumbnailUrl)
            .setFooter({text: `Tater Tower: ${this.username}`});

        const row = new ActionRowBuilder().addComponents(tC.CONT)
        const reply = await this.interaction.editReply({
            embeds: [embed],
            components: [row],
        });

        const collectorFilter = i => i.user.id === this.interaction.user.id;
        const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 30_000 }).catch(() => null);

        // Only one button exists here (forced continuation into an Elite fight already
        // committed to) — a timeout just proceeds the same as clicking it.
        if(!confirmation){
            await this.interaction.editReply({ components: [] }).catch(() => {});
            return true
        }
        if(confirmation.customId == "continue"){
            await confirmation.update({content: '', components: []})
            return true
        }
    }

    // No collector here — purely informational, matches createDeathEmbed's no-click
    // precedent. Always aggregated totals, never a per-floor line list, so a single embed's
    // 6,000-character/25-field limits are never at risk regardless of chain length.
    async createFastForwardSummaryEmbed(summary){
        const floorLabel = summary.floorsResolved === 1 ? 'floor' : 'floors'
        let description = `You fast forward through ${summary.floorsResolved.toLocaleString()} ${floorLabel}.`
        if(summary.notable.length > 0){
            description += `\n\n${summary.notable.map(n => `• ${n}`).join('\n')}`
        }

        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}: Fast Forward Summary`)
            .setDescription(description)
            .setColor('Blue')
            .setTimestamp(Date.now())
            .setFooter({text: `Tater Tower: ${this.username}`})
            .addFields(
                { name: "Potatoes:", value: `${summary.potatoes.toLocaleString()}`, inline: false },
                { name: "Work Multiplier:", value: `${summary.workMultiplier.toFixed(2)}x`, inline: false },
                { name: "Passive Income:", value: `${summary.passiveIncome.toLocaleString()}`, inline: false },
                { name: "Bank Capacity:", value: `${summary.bankCapacity.toLocaleString()}`, inline: false },
                { name: "Temp Work Modifier (this run only):", value: `${summary.modifier.toFixed(2)}x`, inline: false },
            );

        await this.interaction.editReply({
            embeds: [embed],
            components: [],
        });
    }

    // No collector here — the single LEAVE button was decorative (startRun() returns
    // false regardless of what's clicked, since there's only one option), so this used to
    // cost the player a real button click for a decision that was never actually theirs to
    // make. Just shows the death embed and ends the run immediately.
    async createDeathEmbed(description){
        const embed = new EmbedBuilder()
            .setTitle(`FLOOR ${this.floor.toLocaleString()}`)
            .setDescription(`${description}\n\n`)
            .setColor("NotQuiteBlack")
            .setTimestamp(Date.now())
            .setThumbnail("https://cdn.discordapp.com/attachments/1146091052781011026/1207183304286277685/skull.png?ex=65deb810&is=65cc4310&hm=51a9b329d50a101665716d8fb73b35b95a172b3de732e4f7f9e69f31d5c41980&")
            .setFooter({text: `Tater Tower: ${this.username}`});

        await this.interaction.editReply({
            embeds: [embed],
            components: [],
        });

        this.floor--
        return false
    }
}

// Off-by-one fix (2026-08-31): `random` is uniform over [0, 18) (18 integer values), but
// `<=` against cumulative weights [9,12,15,18] gave COMBAT 10/18 values (0-9, 55.6%,
// intended 9/18=50%) and REWARD only 2/18 (16-17, 11.1%, intended 3/18≈16.7%) — a strict
// `<` makes every band exactly its intended width (COMBAT 0-8, ENCOUNTER 9-11,
// TRANSACTION 12-14, REWARD 15-17 — 9/3/3/3 of 18), matching the cumulative-chance
// convention every other weighted roll in this codebase already uses (e.g.
// spudKeepFactory.rollLottery's `roll < cumulative`).
function getFloor() {
    var random = Math.floor(Math.random() * tC.FLOOR_WEIGHTS[tC.FLOOR_WEIGHTS.length - 1]);
    for (var i = 0; i < tC.FLOOR_WEIGHTS.length; i++)
        if (random < tC.FLOOR_WEIGHTS[i])
            break;
    return tC.FLOOR_TYPES[i];
}

// Elite content banding (2026-08-31) — tier is a pure content-selection tag, never a balance
// input (elite.difficulty stays flat ~10.0 everywhere, difficulty scaling comes entirely from
// this.difficulty(N)). N = how many forced Elites deep the run is (1st, 2nd, 3rd...).
function getEliteTier(N) {
    for (const band of tC.ELITE_TIER_BANDS) {
        if (N <= band.maxN) return band.tier
    }
}

function pickElite(N) {
    const tier = getEliteTier(N)
    let candidates = tC.ELITES.filter(e => e.tier === tier)
    if (candidates.length === 0) {
        // Band not authored yet — reuse whatever the deepest authored band is, forever,
        // rather than requiring content up front for bands nobody's reached.
        const maxTier = Math.max(...tC.ELITES.map(e => e.tier))
        candidates = tC.ELITES.filter(e => e.tier === maxTier)
    }
    return candidates[Math.floor(Math.random() * candidates.length)]
}

// Per-entry-type auto-pick table for fast-forward's silent resolution — every current
// ENCOUNTERS/TRANSACTIONS/REWARDS entry is a pure, deterministic-by-index lookup (no
// Math.random() inside the outcome itself), so a policy never needs to "gamble" on an
// in-choice coinflip that doesn't exist; it only ever picks between two already-known
// values. See tower.md's fast-forward table for the full per-entry rationale. Keyed by
// `fl.name` rather than inferred structurally, since a couple of entries (King Kiwi, The
// Wizard Lime) have outcomes that a generic "highest value" comparison would get wrong
// (comparing raw numbers across different outcome types, e.g. potatoes vs. a multiplier
// point, isn't meaningful) — the table is the source of truth for current content, the
// generic fallback below is a best-effort for anything authored later that isn't added here.
const AUTO_PICK_TABLE = {
    "Wandering Woods": (fl, policy) => fl.choices.findIndex(c => c.outcome === (policy === tC.POLICY.GREEDY ? tC.CHOICES.ELITE : tC.CHOICES.EXIT)),
    "Sales Spinach": (fl, policy) => fl.choices.findIndex(c => c.outcome === (policy === tC.POLICY.GREEDY ? tC.MODIFIER.WORK_MULTIPLIER : tC.CHOICES.EXIT)),
    "The Wizard Lime": (fl, policy) => fl.choices.findIndex(c => c.outcome === (policy === tC.POLICY.GREEDY ? tC.CHOICES.ELITE : tC.PAYOUT.POTATOES)),
    "The Traveling Turnip": (fl, policy) => fl.choices.findIndex(c => c.outcome === (policy === tC.POLICY.GREEDY ? tC.PAYOUT.WORK_MULTIPLIER : tC.CHOICES.EXIT)),
    "The Baron's Beet": (fl, policy) => fl.choices.findIndex(c => c.outcome === (policy === tC.POLICY.GREEDY ? tC.PAYOUT.BANK_CAPACITY : tC.CHOICES.EXIT)),
    "Fairy Fig": (fl, policy) => fl.choices.findIndex(c => c.outcome === (policy === tC.POLICY.GREEDY ? tC.MODIFIER.WORK_MULTIPLIER : tC.PAYOUT.POTATOES)),
    "King Kiwi": () => 0,   // all three choices carry identical risk — no axis to diverge on.
    "Golden Ginger": () => 0,   // both choices are risk-free permanent grants (200,000 passive
                                 // income vs. 1.5 million bank capacity) — per explicit direction,
                                 // always take passive income (index 0) rather than letting the
                                 // generic fallback's raw-value comparison always pick bank
                                 // capacity for having the bigger number.
}

function pickChoiceIndex(fl, policy) {
    const handler = AUTO_PICK_TABLE[fl.name]
    if (handler) {
        const index = handler(fl, policy)
        if (index >= 0) return index
    }
    return pickChoiceIndexDefault(fl, policy)
}

// General default rule (see tower.md's "Constraint on future content"): SAFE picks whichever
// choice is CHOICES.EXIT or otherwise non-negative, and never a choice whose outcome ===
// CHOICES.ELITE if a non-ELITE choice exists on the same floor; GREEDY picks CHOICES.ELITE if
// offered, otherwise the higher-value choice (ties broken toward a persistent PAYOUT.* outcome
// over a temporary MODIFIER.WORK_MULTIPLIER one). Verified against every current COMBATS/
// ENCOUNTERS entry not listed in AUTO_PICK_TABLE above (Baby Broccoli/Malevolent Pineapple/
// Blighted Broccoli/Ferocious Fennel/Ravenous Rhubarb, Magic Mango, Wacky Watermelon,
// Despicable Dragonfruit, Grouchy Garlic, Ominous Onion) — this rule reproduces the exact
// table entry for all of them, so only the entries in AUTO_PICK_TABLE need special-casing.
function pickChoiceIndexDefault(fl, policy) {
    const allIndices = fl.choices.map((c, i) => i)
    const eliteIndex = fl.choices.findIndex(c => c.outcome === tC.CHOICES.ELITE)

    if (policy === tC.POLICY.GREEDY && eliteIndex !== -1) {
        return eliteIndex
    }

    const pool = (eliteIndex !== -1 && allIndices.length > 1)
        ? allIndices.filter(i => i !== eliteIndex)
        : allIndices

    if (policy === tC.POLICY.SAFE) {
        const safePool = pool.filter(i => fl.choices[i].outcome === tC.CHOICES.EXIT || toNumber(fl.choices[i].value) >= 0)
        if (safePool.length > 0) {
            return pickHighestValueIndex(fl, safePool)
        }
    }
    return pickHighestValueIndex(fl, pool)
}

function pickHighestValueIndex(fl, indices) {
    return indices.reduce((best, i) => {
        const bestValue = toNumber(fl.choices[best].value)
        const value = toNumber(fl.choices[i].value)
        if (value > bestValue) return i
        if (value === bestValue && fl.choices[best].outcome === tC.MODIFIER.WORK_MULTIPLIER && fl.choices[i].outcome !== tC.MODIFIER.WORK_MULTIPLIER) {
            return i
        }
        return best
    }, indices[0])
}

function emptyFastForwardSummary() {
    return { floorsResolved: 0, potatoes: 0, workMultiplier: 0, passiveIncome: 0, bankCapacity: 0, modifier: 0, notable: [] }
}

function summaryKeyForOutcome(outcomeIndex) {
    switch (outcomeIndex) {
        case tC.PAYOUT.POTATOES: return 'potatoes'
        case tC.PAYOUT.WORK_MULTIPLIER: return 'workMultiplier'
        case tC.PAYOUT.PASSIVE_INCOME: return 'passiveIncome'
        case tC.PAYOUT.BANK_CAPACITY: return 'bankCapacity'
        case tC.MODIFIER.WORK_MULTIPLIER: return 'modifier'
        default: return null
    }
}

function applyOutcomeToSummary(summary, outcome) {
    summary.floorsResolved++
    if (!outcome) return
    if (outcome.notableText) summary.notable.push(outcome.notableText)
    const key = summaryKeyForOutcome(outcome.outcome)
    if (key && outcome.amount) summary[key] += outcome.amount
    if (outcome.pricePaid) summary.potatoes -= outcome.pricePaid
}

// Reward VALUE scaling (2026-08-31) — module-level, exported for testing (same precedent as
// getFloor/pickElite). Real cumulative potato investment required to reach a given
// workMultiplierAmount, log-log linearly interpolated between whichever two
// SCALING_ANCHOR_TABLE checkpoints M falls between — see tower.md part 1 for why a closed-
// form power-law fit was checked and rejected in favor of the real table.
function investment(M) {
    const table = tC.SCALING_ANCHOR_TABLE
    // Exact-match short-circuit: a live M that lands precisely on a table checkpoint (e.g.
    // ENTRY_GATE_MULTI's own 20) returns that checkpoint's literal value rather than
    // round-tripping through log/exp, which introduces a ~1e-13 relative floating-point
    // error that would otherwise make scalingFactor(20) infinitesimally off from the exact
    // 1.0 the design relies on (see tower.md's "no existing test needs its numbers changed"
    // claim, which depends on this being exact, not merely close).
    const exact = table.find(([m]) => m === M)
    if (exact) return exact[1]
    if (M <= table[0][0]) return table[0][1]                 // defensive floor, never hit in
                                                                // real play (ENTRY_GATE_MULTI's
                                                                // own gate keeps live M above it)
    const top = table[table.length - 1]
    if (M >= top[0]) {
        // Live workMultiplierAmount is NOT hard-capped at 600 in practice — that's only the
        // shop+regrade portion; sweetPotatoBuffs stacks on top of it uncapped, same as every
        // other permanent stat track. Extrapolate the final segment's log-log slope forever
        // past the table's own top entry rather than flatlining scalingFactor there.
        const prev = table[table.length - 2]
        const slope = (Math.log(top[1]) - Math.log(prev[1])) / (Math.log(top[0]) - Math.log(prev[0]))
        return Math.exp(Math.log(top[1]) + slope * (Math.log(M) - Math.log(top[0])))
    }
    for (let i = 0; i < table.length - 1; i++) {
        const [lo, hi] = [table[i], table[i + 1]]
        if (M >= lo[0] && M <= hi[0]) {
            const t = (Math.log(M) - Math.log(lo[0])) / (Math.log(hi[0]) - Math.log(lo[0]))
            return Math.exp(Math.log(lo[1]) + t * (Math.log(hi[1]) - Math.log(lo[1])))
        }
    }
}

function scalingFactor(M) {
    return investment(M) / tC.SCALING_ANCHOR_INVESTMENT
}

function mergeFastForwardSummaries(target, source) {
    target.floorsResolved += source.floorsResolved
    target.potatoes += source.potatoes
    target.workMultiplier += source.workMultiplier
    target.passiveIncome += source.passiveIncome
    target.bankCapacity += source.bankCapacity
    target.modifier += source.modifier
    target.notable.push(...source.notable)
}

module.exports = {
    towerFactory,
    getFloor,
    getEliteTier,
    pickElite,
    pickChoiceIndex,
    investment,
    scalingFactor
}
