// Reusable scene text for XR: one canvas, one texture, bounded updates and explicit ownership.
export function createWorldReadout({THREE,parent,canvas=document.createElement('canvas'),width=1024,height=640,worldWidth=2.5,intervalMs=200}={}){
  if(!THREE?.CanvasTexture||!parent?.add||!Number.isFinite(intervalMs)||intervalMs<0)throw new TypeError('Invalid world readout dependencies');
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<64||height<64||!Number.isFinite(worldWidth)||worldWidth<=0)throw new RangeError('Invalid readout dimensions');
  canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw new Error('Readout needs a 2D canvas');
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const geometry=new THREE.PlaneGeometry(worldWidth,worldWidth*height/width),material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,toneMapped:false,transparent:true,depthTest:false,depthWrite:false});
  const mesh=new THREE.Mesh(geometry,material);mesh.name='fire-status-board';mesh.renderOrder=100;mesh.visible=false;parent.add(mesh);
  let last=-Infinity,text='',updates=0,disposed=false;
  function draw(value){
    context.fillStyle='#14262b';context.fillRect(0,0,width,height);context.font='32px system-ui';context.fillStyle='#f0dec0';context.textAlign='left';context.textBaseline='top';
    const lines=[],padding=24,lineHeight=40,maxLines=Math.floor((height-padding*2)/lineHeight);
    for(const paragraph of value.split('\n')){let line='';for(const word of paragraph.split(/\s+/)){const next=line?`${line} ${word}`:word;if(line&&context.measureText(next).width>width-padding*2){lines.push(line);line=word;}else line=next;}lines.push(line);}
    const visible=lines.slice(0,maxLines);if(lines.length>maxLines)visible[maxLines-1]='…';
    visible.forEach((line,i)=>context.fillText(line,padding,padding+i*lineHeight,width-padding*2));texture.needsUpdate=true;
  }
  return {mesh,
    setVisible(value){if(typeof value!=='boolean')throw new TypeError('Visibility must be boolean');if(disposed)return;if(value&&!mesh.visible)last=-Infinity;mesh.visible=value;},
    update(value,{now=performance.now(),force=false}={}){if(disposed)return false;if(typeof value!=='string'||!Number.isFinite(now))throw new TypeError('Invalid readout text/time');if(!mesh.visible)return false;if(!force&&(value===text||now-last<intervalMs))return false;draw(value);text=value;last=now;updates++;return true;},
    stats:()=>({text,updates,visible:mesh.visible,disposed}),
    dispose(){if(disposed)return;disposed=true;mesh.visible=false;mesh.removeFromParent();texture.dispose();material.dispose();geometry.dispose();},
  };
}
