import {vector,distance,clamp} from '../host/system.js';

export function portalBounds(raw=null){
  if(raw===null)return null;const min=vector(raw.min),max=vector(raw.max);
  if(min.some((v,i)=>v>max[i])||min.filter((v,i)=>v<max[i]).length<2)throw new RangeError('Portal needs a nonempty rectangular opening');
  return {min,max};
}
// Direct segment through the box, otherwise a conservative route via clamped opening points.
export function portalDistance(a,b,portal){
  if(!portal)return distance(a,b);let near=0,far=1,intersects=true;
  for(let i=0;i<3;i++){const delta=b[i]-a[i];if(delta===0){if(a[i]<portal.min[i]||a[i]>portal.max[i])intersects=false;continue;}
    const t1=(portal.min[i]-a[i])/delta,t2=(portal.max[i]-a[i])/delta;near=Math.max(near,Math.min(t1,t2));far=Math.min(far,Math.max(t1,t2));if(near>far)intersects=false;
  }
  if(intersects)return distance(a,b);
  const pa=a.map((v,i)=>clamp(v,portal.min[i],portal.max[i])),pb=b.map((v,i)=>clamp(v,portal.min[i],portal.max[i]));
  return distance(a,pa)+distance(pa,pb)+distance(pb,b);
}
