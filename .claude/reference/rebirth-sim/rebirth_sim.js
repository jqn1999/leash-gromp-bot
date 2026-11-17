// Planning-phase model behind .claude/systems/rebirth-v2-plan.md section 5. Run: node .claude/reference/rebirth-sim/rebirth_sim.js
const c=require('../../../src/utils/constants');
const byId=Object.fromEntries(c.shops.map(s=>[s.shopId,s.items]));
function expAttempts(p0,inc){let surv=1,e=0;for(let k=0;;k++){const p=Math.min(1,p0+k*inc);e+=surv;surv*=(1-p);if(p>=1||surv<1e-12)break;}return e;}
const reg=(tiers)=>tiers.map(t=>({cost:t.cost*expAttempts(t.chance,t.failStackIncrease),inc:t.increase}));
const R={work:reg(c.workRegradeTiers),passive:reg(c.passiveRegradeTiers),bank:reg(c.bankRegradeTiers)};
const rebirthPct=n=>n<=0?0:Math.min(1,0.05+0.095*(n-1));
const WORKS_PER_DAY=440; // an active player: 5-minute cooldown plus a ~35% skip chain
// Expected potatoes per /work as a multiple of the multiplier, across every scenario (regular 87% x1000, large 4% x10k, golden .1% x500k,
// metal, minus poison). The first version of this model used 1000 (regular only), which understated /work.
const YIELD=1800;
function sim({sweetWork,sweetPassive,rebirths,costMult=1,groupPerDay=0}){
  const rp=rebirthPct(rebirths);
  const st={work:{shop:0,reg:0},passive:{shop:0,reg:0},bank:{shop:0,reg:0},starch:0};
  let workBase=1,passiveBase=0,regW=0,regP=0,cash=0,days=0;
  const income=()=>WORKS_PER_DAY*YIELD*(workBase+sweetWork+regW)*(1+rp)*.95+(passiveBase+sweetPassive+regP)*(1+rp)+groupPerDay;
  const marks={};
  let shopsDoneDay=null;
  for(let guard=0;guard<500;guard++){
    const opts=[];
    const sw=byId.workShop[st.work.shop],sp=byId.passiveIncomeShop[st.passive.shop],sb=byId.bankShop[st.bank.shop],ss=byId.starchShop[st.starch];
    if(sw)opts.push({cost:sw.cost*costMult,go:()=>{workBase=sw.amount;st.work.shop++;}});
    if(sp)opts.push({cost:sp.cost*costMult,go:()=>{passiveBase=sp.amount;st.passive.shop++;}});
    if(sb)opts.push({cost:sb.cost*costMult,go:()=>{st.bank.shop++;}});
    if(ss)opts.push({cost:ss.cost*costMult,go:()=>{st.starch++;}});
    if(!sw&&R.work[st.work.reg])opts.push({cost:R.work[st.work.reg].cost*costMult,go:()=>{regW+=R.work[st.work.reg].inc;st.work.reg++;}});
    if(!sp&&R.passive[st.passive.reg])opts.push({cost:R.passive[st.passive.reg].cost*costMult,go:()=>{regP+=R.passive[st.passive.reg].inc;st.passive.reg++;}});
    if(!sb&&R.bank[st.bank.reg])opts.push({cost:R.bank[st.bank.reg].cost*costMult,go:()=>{st.bank.reg++;}});
    if(!opts.length)break;
    if(shopsDoneDay===null&&!sw&&!sp&&!sb&&!ss)shopsDoneDay=days;
    opts.sort((a,b)=>a.cost-b.cost);
    const o=opts[0];
    if(cash<o.cost){days+=(o.cost-cash)/income();cash=o.cost;}
    cash-=o.cost;o.go();
  }
  return {days,shopsDoneDay};
}
module.exports={sim,rebirthPct};
if(require.main===module){
  const profiles=[['first climb, no sweet buffs',0,0],['light sweet (100 work / 50M passive)',100,5e7],['mid sweet (200 / 250M)',200,2.5e8],['heavy sweet (400 / 500M)',400,5e8]];
  console.log('Days for a solo player (work+passive only, no raids) to re-reach rebirth eligibility, 440 works/day');
  for(const [name,w,p] of profiles){
    const a=sim({sweetWork:w,sweetPassive:p,rebirths:0}),b=sim({sweetWork:w,sweetPassive:p,rebirths:1});
    console.log(name.padEnd(40),'rebirth 0:',a.days.toFixed(0),'d (shops done day',a.shopsDoneDay&&a.shopsDoneDay.toFixed(0)+')','| after 1 rebirth:',b.days.toFixed(0),'d (shops',b.shopsDoneDay&&b.shopsDoneDay.toFixed(0)+')');
  }
}

// Rebirth ROI: income forgone while re-climbing vs the extra income the next bonus step pays forever.
function roi({sweetWork,sweetPassive,fromRebirths,costMult=1,groupPerDay=0,stepPct}){
  const rpOld=rebirthPct(fromRebirths), rpNew=stepPct!==undefined?stepPct:rebirthPct(fromRebirths+1);
  const maxedStat=(rp)=>WORKS_PER_DAY*YIELD*(100+500+sweetWork)*(1+rp)*.95+(60e6+600e6+sweetPassive)*(1+rp);
  const full=maxedStat(rpOld), uplift=maxedStat(rpNew)-full;
  // Re-run the climb at the NEW rebirth pct, accumulating forgone stat income relative to the maxed account.
  const rp=rpNew;
  let workBase=1,passiveBase=0,regW=0,regP=0,cash=0,days=0,forgone=0;
  const st={w:0,p:0,b:0,s:0,rw:0,rp:0,rb:0};
  const inc=()=>WORKS_PER_DAY*YIELD*(workBase+sweetWork+regW)*(1+rp)*.95+(passiveBase+sweetPassive+regP)*(1+rp);
  for(let g=0;g<500;g++){
    const sw=byId.workShop[st.w],sp=byId.passiveIncomeShop[st.p],sb=byId.bankShop[st.b],ss=byId.starchShop[st.s];
    const o=[];
    if(sw)o.push({cost:sw.cost*costMult,go:()=>{workBase=sw.amount;st.w++}});
    if(sp)o.push({cost:sp.cost*costMult,go:()=>{passiveBase=sp.amount;st.p++}});
    if(sb)o.push({cost:sb.cost*costMult,go:()=>{st.b++}});
    if(ss)o.push({cost:ss.cost*costMult,go:()=>{st.s++}});
    if(!sw&&R.work[st.rw])o.push({cost:R.work[st.rw].cost*costMult,go:()=>{regW+=R.work[st.rw].inc;st.rw++}});
    if(!sp&&R.passive[st.rp])o.push({cost:R.passive[st.rp].cost*costMult,go:()=>{regP+=R.passive[st.rp].inc;st.rp++}});
    if(!sb&&R.bank[st.rb])o.push({cost:R.bank[st.rb].cost*costMult,go:()=>{st.rb++}});
    if(!o.length)break;
    o.sort((a,b)=>a.cost-b.cost);const x=o[0];
    const total=inc()+groupPerDay;
    if(cash<x.cost){const dt=(x.cost-cash)/total;days+=dt;forgone+=(full-inc())*dt;cash=x.cost;}
    cash-=x.cost;x.go();
  }
  return {days,forgone,uplift,payback:uplift>0?forgone/uplift:Infinity,full};
}
module.exports.roi=roi;
if(require.main===module){
  console.log('\nRebirth ROI. climb days, then payback days = (stat income forgone while climbing) / (extra stat income per day from the new bonus step)');
  for(const [name,w,p,g] of [['mid sweet (200/250M), no raids',200,2.5e8,0],['mid sweet, 1B/day group income',200,2.5e8,1e9],['mid sweet, 3B/day group income',200,2.5e8,3e9]]){
    for(const n of [0,1,4]){
      const r=roi({sweetWork:w,sweetPassive:p,fromRebirths:n,groupPerDay:g});
      console.log(name.padEnd(34),'rebirth #'+(n+1),'climb',r.days.toFixed(0),'d | payback',isFinite(r.payback)?r.payback.toFixed(0)+' d':'never','| bonus',(rebirthPct(n)*100).toFixed(1)+'% -> '+(rebirthPct(n+1)*100).toFixed(1)+'%');
    }
  }
}
