// Stable passive exchange; temperatures stay inside their finite endpoint range.
export function blendTemperature(a,b,fraction){
  if(fraction<=0||a===b)return a;if(fraction>=1)return b;
  const delta=b-a,value=Number.isFinite(delta)?a+delta*fraction:a*(1-fraction)+b*fraction;
  return Math.min(Math.max(a,b),Math.max(Math.min(a,b),value));
}
export function rateRatio(conductance,seconds,capacity){
  const work=conductance*seconds;
  return work===0?conductance/(capacity/seconds):Number.isFinite(work)?work/capacity:conductance/capacity*seconds;
}
export function implicitExchange(conductance,seconds,capacity){
  const ratio=rateRatio(conductance,seconds,capacity),fraction=ratio>1?1/(1+1/ratio):ratio/(1+ratio);
  return {fraction,beta:ratio<=1?conductance*seconds/(1+ratio):capacity/(1+1/ratio)};
}
export function exchangeTemperatures(a,b,ac,bc,conductance,seconds){
  const scale=Math.max(ac,bc),aw=ac/scale,bw=bc/scale,total=aw+bw;
  const fraction=-Math.expm1(-(rateRatio(conductance,seconds,ac)+rateRatio(conductance,seconds,bc)));
  return [blendTemperature(a,b,fraction*bw/total),blendTemperature(b,a,fraction*aw/total)];
}
