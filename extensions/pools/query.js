import { positive, vector, distance } from '../host/system.js';

export function validatePoolQueryCursor(cursor){
  if(cursor===null)return;
  if(!cursor||typeof cursor.signature!=='string'||!Number.isSafeInteger(cursor.cellIndex)||cursor.cellIndex<0||cursor.cellIndex>4913||(cursor.nextId!==null&&(typeof cursor.nextId!=='string'||!cursor.nextId)))throw new TypeError('Invalid pool query cursor');
}

// Linked buckets permit bounded paging without copying or skipping a whole crowded cell.
export function createPoolQueryIndex(cellSize=1){
  positive(cellSize,'cellSize');const rooms=new Map(),nodes=new Map(),roomLists=new Map();
  const cell=p=>p.map(v=>Math.floor(v/cellSize));
  const api={
    put(p){if(nodes.has(p.id))return;let cells=rooms.get(p.roomId);if(!cells)rooms.set(p.roomId,cells=new Map());const key=cell(p.position).join(',');let bucket=cells.get(key);if(!bucket)cells.set(key,bucket={head:null,tail:null});
      const n={p,key,roomId:p.roomId,prev:bucket.tail,next:null};if(bucket.tail)bucket.tail.next=n;else bucket.head=n;bucket.tail=n;nodes.set(p.id,n);
      let list=roomLists.get(p.roomId);if(!list)roomLists.set(p.roomId,list={head:null,tail:null});n.roomPrev=list.tail;n.roomNext=null;if(list.tail)list.tail.roomNext=n;else list.head=n;list.tail=n;
    },
    remove(id){const n=nodes.get(id);if(!n)return;const cells=rooms.get(n.roomId),bucket=cells.get(n.key);if(n.prev)n.prev.next=n.next;else bucket.head=n.next;if(n.next)n.next.prev=n.prev;else bucket.tail=n.prev;
      nodes.delete(id);if(!bucket.head)cells.delete(n.key);if(!cells.size)rooms.delete(n.roomId);
      const list=roomLists.get(n.roomId);if(n.roomPrev)n.roomPrev.roomNext=n.roomNext;else list.head=n.roomNext;if(n.roomNext)n.roomNext.roomPrev=n.roomPrev;else list.tail=n.roomPrev;if(!list.head)roomLists.delete(n.roomId);
    },
    clear(){rooms.clear();nodes.clear();roomLists.clear();},
    queryRoom({roomId=null,limit=8,maxChecks=64,cursor=null,accept=()=>true,filterKey='all'}={}){
      for(const [name,value]of Object.entries({limit,maxChecks}))if(!Number.isSafeInteger(value)||value<1||value>4096)throw new RangeError(`Invalid ${name}`);
      validatePoolQueryCursor(cursor);const signature=JSON.stringify(['room',roomId,filterKey]),list=roomLists.get(roomId);
      let n=cursor?.signature===signature&&cursor.nextId?nodes.get(cursor.nextId):null;if(!n||n.roomId!==roomId)n=list?.head??null;
      const items=[];let checks=0;while(n&&checks<maxChecks&&items.length<limit){const p=n.p;n=n.roomNext;checks++;if(!p.active&&accept(p))items.push(p);}
      return {items,checks,cells:1,done:!n,cursor:n?{signature,cellIndex:0,nextId:n.p.id}:null};
    },
    query({position,roomId=null,radius=1,limit=8,maxChecks=64,maxCells=64,cursor=null,accept=()=>true,filterKey='all'}={}){
      position=vector(position);positive(radius,'radius');if(radius>cellSize*8)throw new RangeError('Query radius exceeds cell budget');
      for(const [name,value]of Object.entries({limit,maxChecks,maxCells}))if(!Number.isSafeInteger(value)||value<1||value>4096)throw new RangeError(`Invalid ${name}`);
      validatePoolQueryCursor(cursor);const signature=JSON.stringify([position,roomId,radius,cellSize,filterKey]);
      let cellIndex=cursor?.signature===signature?cursor.cellIndex:0,nextId=cursor?.signature===signature?cursor.nextId:null;
      const origin=cell(position),extent=Math.ceil(radius/cellSize),width=extent*2+1,total=width**3,cells=rooms.get(roomId),items=[];let checks=0,visited=0;
      while(cellIndex<total&&checks<maxChecks&&visited<maxCells&&items.length<limit){
        const x=Math.floor(cellIndex/(width*width)),y=Math.floor(cellIndex/width)%width,z=cellIndex%width;
        const key=[origin[0]+x-extent,origin[1]+y-extent,origin[2]+z-extent].join(','),bucket=cells?.get(key);visited++;
        let n=nextId?nodes.get(nextId):null;if(!n||n.key!==key||n.roomId!==roomId)n=bucket?.head??null;
        while(n&&checks<maxChecks&&items.length<limit){const p=n.p;n=n.next;checks++;if(!p.active&&accept(p)&&distance(p.position,position)<=radius)items.push(p);}
        if(n)nextId=n.p.id;else{cellIndex++;nextId=null;}
      }
      return {items,checks,cells:visited,done:cellIndex>=total,cursor:cellIndex>=total?null:{signature,cellIndex,nextId}};
    },
  };return api;
}
