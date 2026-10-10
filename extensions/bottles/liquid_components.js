// Liquid identity is separate from colour. Fractions on bottles, millilitres on airborne drops/deposits.
export function dropComponents(ml,kind,source=null,supplied=null) {
  if(supplied)return {...supplied};
  const fractions=source?.liquidComposition;
  if(!fractions)return {[kind]:ml};
  const sum=Object.values(fractions).reduce((n,v)=>n+(Number.isFinite(v)&&v>0?v:0),0);
  if(!sum)return {[kind]:ml};
  return Object.fromEntries(Object.entries(fractions).filter(([,v])=>Number.isFinite(v)&&v>0).map(([k,v])=>[k,ml*v/sum]));
}
export function mixComponents(target,added) {for(const[k,ml]of Object.entries(added))target[k]=(target[k]??0)+ml;return target;}
export function receiveComponents(bottle,components,accepted,incomingMl) {
  const existing=dropComponents(bottle.fillMl,bottle.liquidKind??'unknown',bottle);
  const portion=Object.fromEntries(Object.entries(components).map(([k,ml])=>[k,ml*accepted/incomingMl]));
  mixComponents(existing,portion);const total=bottle.fillMl+accepted;
  bottle.liquidComposition=Object.fromEntries(Object.entries(existing).map(([k,ml])=>[k,total?ml/total:0]));
  const kinds=Object.entries(existing).filter(([,ml])=>ml>1e-8).map(([kind])=>kind);bottle.liquidKind=kinds.length===1?kinds[0]:'mixed';
}
