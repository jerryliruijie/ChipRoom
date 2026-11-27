import * as THREE from './vendor/three.js';
import { chipPoints } from './seat-layout.js';

const TAU = Math.PI * 2;
const POT = 'pot';
const bank = id => 'stack/' + id;
const wager = id => 'bet/' + id;
const clamp = (min, value, max) => Math.max(min, Math.min(max, value));

// A bank, a live bet and the collected pot each occupy a distinct place on the felt.
function balances(state) {
  const result = new Map();
  let collected = state.pot;
  for (const player of state.players) {
    result.set(bank(player.id), player.stack);
    const liveBet = state.phase === 'betting' ? player.bet : 0;
    result.set(wager(player.id), liveBet);
    collected -= liveBet;
  }
  result.set(POT, collected);
  return result;
}

function transfers(previous, next) {
  if (!previous || next.version !== previous.version + 1 ||
      previous.hostId !== next.hostId || previous.players.length !== next.players.length) return null;
  const initial = balances(previous);
  const remaining = new Map(initial);
  const slots = new Map(previous.players.map(player => [player.id,player]));
  const moves = [];
  const send = (from,to,amount,start,duration) => {
    if (amount <= 0) return;
    moves.push({from,to,amount,start,duration});
    remaining.set(from,remaining.get(from)-amount);
    remaining.set(to,remaining.get(to)+amount);
  };
  if (next.hand === previous.hand + 1 && (previous.phase === 'lobby' || previous.phase === 'complete')) {
    for (const player of next.players) {
      const old = slots.get(player.id);
      if (!old) return null;
      const delay = player.id === next.bbId ? 55 : 0;
      const destination = next.phase === 'betting' ? wager(player.id) : POT;
      send(bank(player.id), destination, old.stack-player.stack, delay, 380);
    }
  } else if (next.hand === previous.hand && next.phase === 'complete') {
    // A final fold can return an unmatched top bet before awarding the rest.
    if (previous.phase === 'betting') {
      const sorted = [...previous.players].sort((a,b)=>b.bet-a.bet);
      send(wager(sorted[0].id),bank(sorted[0].id),sorted[0].bet-sorted[1].bet,0,270);
      for (const player of previous.players) {
        send(wager(player.id),POT,remaining.get(wager(player.id)),0,320);
      }
    }
    const payoutStart = moves.length ? 335 : 0;
    for (const player of next.players) {
      send(POT,bank(player.id),player.stack-remaining.get(bank(player.id)),payoutStart,440);
    }
  } else if (next.hand === previous.hand && previous.phase === 'betting') {
    for (const player of next.players) {
      const old = slots.get(player.id);
      if (!old) return null;
      const delta = old.stack-player.stack;
      if (delta>0) send(bank(player.id),wager(player.id),delta,0,380);
      if (delta<0) send(wager(player.id),bank(player.id),-delta,0,320);
    }
    if (next.street !== previous.street || next.phase === 'showdown') {
      const gatherStart = moves.length ? 395 : 0;
      for (const player of next.players) {
        send(wager(player.id),POT,remaining.get(wager(player.id)),gatherStart,350);
      }
    }
  }
  // Restores, skipped actions and unrecognised state transitions snap to the server snapshot.
  for (const [key, final] of balances(next)) {
    if (remaining.get(key)!==final) return null;
  }
  return moves.length ? {initial,moves,duration:Math.max(...moves.map(m=>m.start+m.duration))} : null;
}

function textureFromCanvas(width,height,draw) {
  const canvas = document.createElement('canvas');
  canvas.width=width;
  canvas.height=height;
  draw(canvas.getContext('2d'),width,height);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}

function makeCloth() {
  // Fine diagonal weave and a broad pool of light, sampled once for the whole playing surface.
  return textureFromCanvas(768,768,(ctx,w,h)=>{
    const pixels=ctx.createImageData(w,h);
    let random=137;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      random=(Math.imul(random,1664525)+1013904223)>>>0;
      const u=x/w,v=y/h;
      const dx=(u-.32)*1.42+(v-.23)*.37,dy=(v-.23)*1.8-(u-.32)*.33;
      const light=Math.exp(-(dx*dx+dy*dy)*1.65);
      const fibre=(random/4294967296-.5)*10 + ((x+y)%4 === 0 ? 2.8 : 0);
      const i=(y*w+x)*4;
      pixels.data[i]=12+24*light+fibre*.47;
      pixels.data[i+1]=42+63*light+fibre;
      pixels.data[i+2]=34+49*light+fibre*.84;
      pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
  });
}

function makeStudio() {
  const texture=textureFromCanvas(256,128,(ctx,w,h)=>{
    const gradient=ctx.createLinearGradient(0,0,0,h);
    gradient.addColorStop(0,'#648477'); gradient.addColorStop(.46,'#80958a');
    gradient.addColorStop(.54,'#1c3531'); gradient.addColorStop(1,'#071713');
    ctx.fillStyle=gradient; ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#f4eee2'; ctx.fillRect(26,20,66,29);
    ctx.fillStyle='#c5af86'; ctx.fillRect(155,29,18,47);
    ctx.fillStyle='#a4c4bb'; ctx.fillRect(200,21,35,13);
  });
  texture.mapping=THREE.EquirectangularReflectionMapping;
  return texture;
}

function materialGrain(wood) {
  const texture=textureFromCanvas(256,64,(ctx,w,h)=>{
    const data=ctx.createImageData(w,h);
    let seed=75517;
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const noise=seed/4294967296-.5;
      const grain=wood ? 9*Math.sin(y*1.3+Math.sin(x*.036)*1.4)+6*Math.sin(.23*y+Math.sin(.012*x)*2.7)+noise*6
        : noise*21+Math.sin(x*.6+y*.8)*Math.cos(y*.56-x*.3)*3;
      const i=(y*w+x)*4;
      data.data[i]=(wood?98:47)+grain;
      data.data[i+1]=(wood?63:51)+grain*.8;
      data.data[i+2]=(wood?40:46)+grain*.63;
      data.data[i+3]=255;
    }
    ctx.putImageData(data,0,0);
  });
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  return texture;
}

const finishes = [
  {body:'#e1ce9f',stripe:'#244e43',metal:'#d9b76d',jewel:'#426859'},
  {body:'#137a65',stripe:'#eee1b4',metal:'#d4b777',jewel:'#39b69b'},
  {body:'#865064',stripe:'#eacdb0',metal:'#c9ad70',jewel:'#a5728c'},
  {body:'#203f44',stripe:'#d7ba7e',metal:'#caa363',jewel:'#277e71'},
  {body:'#b69a58',stripe:'#253f37',metal:'#ebcf8d',jewel:'#646e4b'}
];

// Faceted centre, two machined bevels and inlays continuing down the edge.
// All parts share one geometry and material, allowing a whole colourway in one draw call.
function makeChip(finish) {
  const positions=[], normals=[], colours=[], indices=[];
  const segments=40;
  const colour=new THREE.Color();
  function band(lowR,lowY,highR,highY,colourFor) {
    for(let i=0;i<segments;i++) {
      const a=TAU*i/segments,b=TAU*(i+1)/segments;
      const radial=highY-lowY, elevation=lowR-highR;
      const length=Math.hypot(radial,elevation) || 1;
      colour.set(colourFor(i));
      const first=positions.length/3;
      for(const [theta,radius,y] of [[a,lowR,lowY],[a,highR,highY],[b,highR,highY],[b,lowR,lowY]]) {
        const c=Math.cos(theta),s=Math.sin(theta);
        positions.push(c*radius,y,s*radius);
        normals.push(c*radial/length,elevation/length,s*radial/length);
        colours.push(colour.r,colour.g,colour.b);
      }
      indices.push(first,first+1,first+2,first,first+2,first+3);
    }
  }
  const metal=()=>finish.metal,body=()=>finish.body;
  const inlay=i=>i%5<2?finish.stripe:finish.body;
  band(.95,0,1,.026,metal);
  band(1,.026,1,.140,inlay);
  band(1,.140,.976,.173,inlay);
  band(.976,.173,.939,.179,metal);
  band(.939,.179,.675,.179,inlay);
  band(.675,.179,.644,.181,metal);
  band(.644,.181,.526,.182,body);
  band(.526,.182,.484,.187,metal);
  const facets=Array.from({length:8},(_,i)=>new THREE.Color(finish.jewel)
    .multiplyScalar([1.28,.72,.88,1.09,.67,1.13,.93,1.3][i]));
  band(.484,.187,0,.199,i=>facets[Math.floor(i/5)]);
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));
  geo.setIndex(indices);
  return geo;
}

const denominations=[1,5,25,100,500,1000,5000,25000,100000,500000,
  1000000,5000000,25000000,100000000,500000000,1000000000,5000000000];

// Break high chips for playable stacks, with the same denominations for bets and refunds.
function mint(amount,targetCount=1) {
  const counts=emptyStock();
  let balance=amount, count=0;
  for(let i=counts.length-1;i>=0;i--) {
    counts[i]=Math.floor(balance/denominations[i]);
    balance-=counts[i]*denominations[i];
    count+=counts[i];
  }
  for(let i=counts.length-1; i>0 && count<targetCount;i--) {
    const change=denominations[i]/denominations[i-1];
    while(counts[i]>0 && count+change-1<=targetCount) {
      counts[i]--; counts[i-1]+=change; count+=change-1;
    }
  }
  return counts;
}

const emptyStock=()=>new Array(denominations.length).fill(0);
function addStock(to,delta,sign=1) {
  for(let i=0;i<delta.length;i++) to[i]+=delta[i]*sign;
}
function copyStock(stock) {
  return new Map([...stock].map(([key,counts])=>[key,[...counts]]));
}
function stockFromState(state) {
  const book=new Map(),bb=state.settings?.bb || 10,sb=state.settings?.sb || 5;
  for(const [key,amount] of balances(state)) {
    const counts=emptyStock();
    let rest=amount;
    if(key.startsWith('stack/')) {
      // Reserve common blind/call amounts as spendable chips at the front.
      const owed=key===bank(state.me) ? state.actions?.call : 0;
      for(const requested of [owed||bb,sb]) {
        const packet=Math.min(requested,rest);
        addStock(counts,mint(packet)); rest-=packet;
      }
    }
    addStock(counts,mint(rest,key.startsWith('stack/')?10:3));
    book.set(key,counts);
  }
  return book;
}

function debit(source,amount) {
  const selected=emptyStock(),change=emptyStock();
  let rest=amount;
  while(rest>0) {
    for(let i=denominations.length-1;i>=0;i--) {
      const n=Math.min(source[i],Math.floor(rest/denominations[i]));
      selected[i]+=n; source[i]-=n; rest-=n*denominations[i];
    }
    if(!rest) break;
    const bigger=source.findIndex((n,i)=>n>0 && denominations[i]>rest);
    if(bigger<=0) return null;
    const smaller=denominations[bigger]/denominations[bigger-1];
    source[bigger]--; change[bigger]--;
    source[bigger-1]+=smaller; change[bigger-1]+=smaller;
  }
  return {selected,change};
}
function attachStock(sequence,stock) {
  const final=copyStock(stock);
  for(const move of sequence.moves) {
    const coins=debit(final.get(move.from),move.amount);
    if(!coins) return null;
    Object.assign(move,coins);
    addStock(final.get(move.to),coins.selected);
  }
  sequence.stock=stock;
  return final;
}
function bucket(denom,key,blind) {
  if(key.startsWith('bet/') || denom===blind) return 0;
  return denom<=blind+2 ? 1 : 2;
}
function stacks(counts,key,blind) {
  const groups=[[],[],[]];
  // Denominations stay in stable positions instead of rearranging after each call.
  for(let i=denominations.length-1;i>=0;i--) {
    if(counts[i]) groups[bucket(i,key,blind)].push({denom:i,count:counts[i]});
  }
  return groups;
}
function sameAmounts(stock,wanted) {
  if(stock.size!==wanted.size) return false;
  for(const [key,value] of wanted) {
    const coins=stock.get(key);
    if(!coins || coins.reduce((sum,n,i)=>sum+n*denominations[i],0)!==value) return false;
  }
  return true;
}

export function createTableScene(container) {
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  const canvas=renderer.domElement;
  canvas.setAttribute('aria-hidden','true');
  canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none';
  container.append(canvas);
  renderer.setClearColor(0x0c1b18,0);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.04;

  const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(28,1,.1,75);
  camera.position.set(0,8.3,11.55);
  camera.lookAt(0,0,0);
  camera.updateMatrixWorld();
  const surface=new THREE.Group();
  scene.add(surface);
  const resources=[];
  function keep(item) { resources.push(item); return item; }
  function material(colour,roughness,metalness=0) {
    return keep(new THREE.MeshStandardMaterial({color:colour,roughness,metalness,side:THREE.DoubleSide}));
  }
  const studio=keep(makeStudio());
  scene.environment=studio;
  scene.environmentIntensity=.48;
  const warm=new THREE.DirectionalLight(0xffeed4,2.00);
  warm.position.set(-4,7,-2);
  const edge=new THREE.DirectionalLight(0xbbdfd6,1.2);
  edge.position.set(5,3.6,2);
  scene.add(new THREE.HemisphereLight(0xd5e1d5,0x2a3e37,1.12),warm,edge);

  const cloth=keep(makeCloth());
  cloth.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
  const clothMat=keep(new THREE.MeshStandardMaterial({map:cloth,roughness:.99,side:THREE.DoubleSide,envMapIntensity:.3}));
  const leather=keep(materialGrain(false)),veneer=keep(materialGrain(true));
  const railMat=keep(new THREE.MeshStandardMaterial({map:leather,bumpMap:leather,bumpScale:.019,
    roughness:.56,metalness:.055,side:THREE.DoubleSide}));
  const railLip=material(0x201e1b,.65,.08);
  const wood=keep(new THREE.MeshStandardMaterial({map:veneer,roughness:.39,metalness:.10,side:THREE.DoubleSide}));
  const edgeMetal=material(0xb69a69,.32,.76);
  const stitchMat=material(0x716e51,.85,.08);
  const feltLine=material(0x477665,.93);
  const chipMat=keep(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.37,metalness:.34}));
  const batches=finishes.map(finish=>{
    const mesh=new THREE.InstancedMesh(keep(makeChip(finish)),chipMat,512);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.count=0; mesh.frustumCulled=false;
    scene.add(mesh);
    return mesh;
  });
  const shade=keep(textureFromCanvas(64,64,(ctx,w,h)=>{
    const g=ctx.createRadialGradient(w*.5,h*.5,0,w*.5,h*.5,w*.5);
    g.addColorStop(0,'rgba(0,0,0,.88)'); g.addColorStop(.49,'rgba(0,0,0,.72)');
    g.addColorStop(.78,'rgba(0,0,0,.27)'); g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,w,h);
  }));
  const shadowGeo=keep(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2));
  const shadowMat=keep(new THREE.MeshBasicMaterial({map:shade,transparent:true,depthWrite:false,toneMapped:false}));
  const shadows=new THREE.InstancedMesh(shadowGeo,shadowMat,100);
  shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadows.frustumCulled=false;
  scene.add(shadows);

  const ray=new THREE.Raycaster(), plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  const ndc=new THREE.Vector2();
  function toWorld(x,y) {
    ndc.set(x*.02-1,1-y*.02);
    ray.setFromCamera(ndc,camera);
    return ray.ray.intersectPlane(plane,new THREE.Vector3());
  }

  const compact=matchMedia('(max-width:780px)');
  let width=0,height=0,ratio=0,radius=.18,snapshot=null;
  let stock=new Map(), anchors=new Map(), timeline=null,blindDenom=1;
  let frame=0,lost=false,disposed=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const needsReady=()=>!disposed && !lost && width>0 && height>0;
  const ready=value=>{
    container.classList.toggle('scene-ready',value);
    container.dataset.scene=value?'ready':'lost';
    canvas.style.visibility=value?'visible':'hidden';
  };
  const surfaces=[];
  function addSurface(geometry,mat) {
    surfaces.push(geometry);
    surface.add(new THREE.Mesh(geometry,mat));
  }
  function buildTable() {
    surface.clear();
    for(const g of surfaces) g.dispose();
    surfaces.length=0;
    const segments=112, exponent=.76;
    // Project a stadium perimeter onto the real horizontal table plane. The trim
    // remains under the same DOM seats for both tall and wide arrangements.
    function perimeter(scale,index) {
      const angle=index*TAU/segments;
      const x=Math.cos(angle), y=Math.sin(angle);
      const u=50+47.9*scale*Math.sign(x)*Math.pow(Math.abs(x),exponent);
      const v=49.4+45.6*scale*Math.sign(y)*Math.pow(Math.abs(y),exponent);
      return {world:toWorld(u,v),u,v};
    }
    function rail(profile,mat) {
      const positions=[],indices=[],uv=[];
      for(const [row,[scale,y]] of profile.entries()) {
        for(let i=0;i<=segments;i++) {
          const p=perimeter(scale,i).world;
          positions.push(p.x,y,p.z);
          uv.push(i/segments*(mat===wood?8:20),row/(profile.length-1));
        }
      }
      for(let j=0;j<profile.length-1;j++) for(let i=0;i<segments;i++) {
        const a=j*(segments+1)+i,b=a+segments+1;
        indices.push(a,b,b+1,a,b+1,a+1);
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      addSurface(geometry,mat);
    }
    rail([[.989,-.378],[1.012,-.365],[1.025,-.317],[1.027,-.135],[1.024,-.082],
      [1.015,-.050],[.972,-.044]],wood);
    rail([[1.026,-.294],[1.029,-.280],[1.028,-.262]],edgeMetal);
    rail([[1.011,-.059],[1.018,-.048],[1.011,-.039]],edgeMetal);
    rail([[.975,-.066],[.998,-.049],[1.001,-.001],[.997,.041],[.982,.082],
      [.956,.102],[.929,.099],[.909,.077],[.899,.023],[.902,-.024]],railMat);
    rail([[.901,.020],[.905,.010],[.899,.001]],railLip);
    rail([[.931,.104],[.933,.104]],stitchMat);
    rail([[.942,.104],[.943,.105]],stitchMat);
    rail([[.900,.022],[.903,.028]],edgeMetal);

    const positions=[...toWorld(50,49.4).toArray()],uv=[.5,.5],indices=[];
    for(let i=0;i<=segments;i++) {
      const {world,u,v}=perimeter(.904,i);
      positions.push(world.x,0,world.z); uv.push(u/100,1-v/100);
      if(i>0) indices.push(0,i+1,i);
    }
    const felt=new THREE.BufferGeometry();
    felt.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    felt.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    felt.setIndex(indices); felt.computeVertexNormals();
    addSurface(felt,clothMat);
    rail([[.807,.004],[.811,.004]],feltLine);
  }

  function setAnchors() {
    anchors=new Map([[POT,toWorld(50,61)]]);
    if (!snapshot) return;
    const mine=snapshot.players.findIndex(p=>p.id===snapshot.me);
    const total=snapshot.players.length;
    snapshot.players.forEach((p,i)=>{
      const relative=(i-mine+total)%total;
      const {bank:[bx,by],wager:[wx,wy]} = chipPoints(relative,total,width,height,compact.matches);
      anchors.set(bank(p.id),toWorld(bx,by));
      anchors.set(wager(p.id),toWorld(wx,wy));
    });
  }
  function size() {
    const w=container.clientWidth,h=container.clientHeight;
    const dpr=Math.min(devicePixelRatio||1,1.7);
    if (!w || !h || (w===width && h===height && dpr===ratio)) return;
    width=w; height=h; ratio=dpr;
    renderer.setPixelRatio(dpr); renderer.setSize(w,h,false);
    camera.aspect=w/h; camera.updateProjectionMatrix();
    const diameter=compact.matches ? clamp(16,Math.min(w*.061,h*.076),34) : clamp(17,Math.min(w*.066,h*.079),34);
    radius=toWorld(50+diameter*50/w,50).distanceTo(toWorld(50,50));
    buildTable(); setAnchors();
  }

  const transform=new THREE.Object3D(), position=new THREE.Vector3();
  const coinHeight=()=>radius*.221;
  const countCoins= stack=>stack.reduce((n,line)=>n+line.count,0);
  function offset(point,key,column) {
    if(key.startsWith('bet/')) return point.clone();
    const scale = snapshot.players.length >= 7 ? (compact.matches ? .68 : .87) : 1;
    const toward=key===POT?1:point.x<0?1:-1;
    const x=[1.10,-1.08,-.05][column]*toward*scale;
    const z=[.33,.20,-1.68][column]*scale;
    return new THREE.Vector3(point.x+radius*x,0,point.z+radius*z);
  }
  function pileHeight(stack) {return Math.min(11,countCoins(stack))*coinHeight();}
  function paintStack(point,stack,yaw=0,tilt=0,base=0,inFlight=false) {
    const total=countCoins(stack);
    if(!total) return;
    const elevation=base/radius;
    if(shadows.count<100) {
      const spread=Math.min(.85,elevation*.33);
      transform.position.set(point.x+radius*(.14+spread*.73),.009,point.z+radius*(.15+spread*.64));
      transform.rotation.set(0,0,0);
      transform.scale.set(radius*(2.98+spread),1,radius*(2.62+spread));
      transform.updateMatrix(); shadows.setMatrixAt(shadows.count++,transform.matrix);
    }
    const visible=Math.min(total,inFlight?7:11);
    for(let row=0;row<visible;row++) {
      let j=0,index=visible===1?total-1:Math.round(row*(total-1)/(visible-1));
      while(index>=stack[j].count && j+1<stack.length) {index-=stack[j].count;j++;}
      const mesh=batches[stack[j].denom%finishes.length];
      if(mesh.count>=512) continue;
      const twist=row*.18+stack[j].denom*.27;
      const scatter=(visible>1?.033:0)*radius;
      transform.position.set(point.x+scatter*Math.sin(twist*1.9),.018+base+row*coinHeight(),point.z+scatter*Math.cos(twist));
      transform.rotation.set(tilt,yaw+twist,tilt*.4);
      transform.scale.set(radius,radius*1.23,radius);
      transform.updateMatrix(); mesh.setMatrixAt(mesh.count++,transform.matrix);
    }
  }
  function paintTransfer(move,t,staged) {
    const packets=new Map();
    for(let i=denominations.length-1;i>=0;i--) {
      if(!move.selected[i]) continue;
      const fromCol=bucket(i,move.from,blindDenom),toCol=bucket(i,move.to,blindDenom);
      const pair=fromCol*3+toCol;
      if(!packets.has(pair)) packets.set(pair,{fromCol,toCol,coins:[]});
      packets.get(pair).coins.push({denom:i,count:move.selected[i]});
    }
    const origin=anchors.get(move.from),destination=anchors.get(move.to);
    if(!origin || !destination) return;
    const startStacks=stacks(staged.get(move.from),move.from,blindDenom);
    const endStacks=stacks(staged.get(move.to),move.to,blindDenom);
    for(const {fromCol,toCol,coins} of packets.values()) {
      const from=offset(origin,move.from,fromCol),to=offset(destination,move.to,toCol);
      const travel=1-Math.pow(1-t,1.7);
      position.lerpVectors(from,to,travel);
      const dx=to.x-from.x,dz=to.z-from.z,len=Math.hypot(dx,dz)||1;
      const slip=Math.sin(Math.PI*t)*radius*.29;
      position.x-=dz/len*slip; position.z+=dx/len*slip;
      // Slide off the remaining stack, settle against the destination stack.
      const bankClear=Math.max(0,1-t/.29);
      const arrival=clamp(0,(t-.68)/.26,1);
      const lift=pileHeight(startStacks[fromCol])*bankClear*bankClear+
        pileHeight(endStacks[toCol])*arrival+Math.sin(Math.PI*t)*radius*.14;
      paintStack(position,coins,travel*.52,Math.sin(t*Math.PI*2)*.10*(1-t),lift,true);
    }
  }
  function render(now) {
    frame=0;
    if(disposed || lost || document.hidden) return;
    size();
    if(!needsReady()) return;
    for(const batch of batches) batch.count=0;
    shadows.count=0;
    const elapsed=timeline?now-timeline.started:0;
    if(timeline && (elapsed>=timeline.duration || reduced.matches)) timeline=null;
    const staged=timeline?copyStock(timeline.stock):stock;
    if(timeline) {
      for(const move of timeline.moves) {
        if(elapsed<move.start) continue;
        addStock(staged.get(move.from),move.change);
        addStock(staged.get(move.from),move.selected,-1);
        if(elapsed>=move.start+move.duration) addStock(staged.get(move.to),move.selected);
      }
    }
    for(const [key,counts] of staged) {
      const point=anchors.get(key);
      if(!point) continue;
      stacks(counts,key,blindDenom).forEach((stack,col)=>{
        if(stack.length) paintStack(offset(point,key,col),stack);
      });
    }
    if(timeline) for(const move of timeline.moves) {
      const t=(elapsed-move.start)/move.duration;
      if(t>=0 && t<1) paintTransfer(move,t,staged);
    }
    for(const batch of batches) batch.instanceMatrix.needsUpdate=true;
    shadows.instanceMatrix.needsUpdate=true;
    renderer.render(scene,camera);
    if(!container.classList.contains('scene-ready')) ready(true);
    if(timeline) schedule();
  }
  function schedule() {
    if(!frame && !disposed && !lost && !document.hidden) frame=requestAnimationFrame(render);
  }
  function stop() {
    if(frame) cancelAnimationFrame(frame);
    frame=0; timeline=null;
  }
  const visibility=()=>{if(document.hidden) stop();else schedule();};
  const onLost=event=>{event.preventDefault(); lost=true; stop(); ready(false);};
  const onRestore=()=>{lost=false; schedule();};
  const preference=()=>{if(reduced.matches) timeline=null; schedule();};
  canvas.addEventListener('webglcontextlost',onLost);
  canvas.addEventListener('webglcontextrestored',onRestore);
  document.addEventListener('visibilitychange',visibility);
  reduced.addEventListener('change',preference);
  const resize=new ResizeObserver(schedule);
  resize.observe(container);
  schedule();
  return {
    update(next,previous) {
      if(disposed || !next) return;
      if(snapshot && snapshot.version===next.version && snapshot.hostId===next.hostId) return;
      const contiguous=snapshot && previous && snapshot.version===previous.version;
      const sequence=contiguous && transfers(previous,next);
      const final=sequence && attachStock(sequence,stock);
      if(final) stock=final;
      else if(!sameAmounts(stock,balances(next))) stock=stockFromState(next);
      const blind=next.settings?.sb || 5;
      blindDenom=denominations.findLastIndex(v=>v<=blind);
      snapshot=next;
      if(width) setAnchors();
      timeline=final && !document.hidden && !reduced.matches && !lost ? {...sequence,started:performance.now()}:null;
      schedule();
    },
    destroy() {
      if(disposed) return;
      disposed=true; stop();
      canvas.removeEventListener('webglcontextlost',onLost);
      canvas.removeEventListener('webglcontextrestored',onRestore);
      document.removeEventListener('visibilitychange',visibility);
      reduced.removeEventListener('change',preference);
      resize.disconnect();
      for(const g of surfaces) g.dispose();
      for(const batch of [...batches,shadows]) batch.dispose();
      for(const resource of resources) resource.dispose();
      renderer.dispose(); renderer.forceContextLoss();
      canvas.remove(); delete container.dataset.scene;
      container.classList.remove('scene-ready');
    }
  };
}
