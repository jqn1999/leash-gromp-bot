// Solves the bonus step needed for a target payback. Run: node .claude/reference/rebirth-sim/rebirth_solve.js
const {roi,rebirthPct}=require('./rebirth_sim.js');
// Smallest total bonus after this rebirth that pays the climb back in TARGET days (stat income only, so it overstates the step needed).
function neededStep(opts,target){
  let lo=rebirthPct(opts.fromRebirths),hi=lo+20;
  for(let i=0;i<60;i++){const mid=(lo+hi)/2;const r=roi({...opts,stepPct:mid});if(r.payback>target)lo=mid;else hi=mid;}
  return hi;
}
for(const [label,g] of [['1B/day group income',1e9],['3B/day group income',3e9]]){
  for(const cm of [1,2]){
    const row=[];
    for(const n of [0,1,4]){
      const base=rebirthPct(n);const need=neededStep({sweetWork:200,sweetPassive:2.5e8,fromRebirths:n,costMult:cm,groupPerDay:g},180);
      const r=roi({sweetWork:200,sweetPassive:2.5e8,fromRebirths:n,costMult:cm,groupPerDay:g,stepPct:need});
      row.push('#'+(n+1)+': bonus '+(base*100).toFixed(0)+'% -> '+(need*100).toFixed(0)+'% (climb '+r.days.toFixed(0)+'d)');
    }
    console.log(label.padEnd(22),'cost x'+cm,'|',row.join(' | '));
  }
}
