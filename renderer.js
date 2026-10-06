'use strict';
const $=id=>document.getElementById(id);
const api=window.peen;
let machine={connected:false,busy:false,homed:false},settings,art=null,name='',rasterData=null,previewed=false,pending=false,drag=null,importGeneration=0;
let corners=null, firstCorner=null, aspect=55/34, previousRotation=0, saveTimer, autoConnect=true;
const checkboxInputs=['mirror','lockRatio','snap'];
const num=id=>Number($(id).value);
const layoutInputs=['workWidth','workHeight','originX','originY','designWidth','designHeight','lockRatio','snap','rotation','mirror','left','top','speed'];
function notice(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
async function perform(fn){if(pending)return;pending=true;buttons();try{await fn();}catch(e){notice(e.message,true);}finally{pending=false;buttons();}}
function transformed(){
  if(!art)return [];
  const radians=num('rotation')*Math.PI/180;
  const turned=art.map(s=>s.map(([x,y])=>[x*Math.cos(radians)-y*Math.sin(radians),x*Math.sin(radians)+y*Math.cos(radians)]));
  const b=Artwork.bounds(turned),scale=num('designWidth')/b.width,scaleY=num('designHeight')/b.height;
  return turned.map(s=>s.map(([x,y])=>[(($('mirror').checked?b.maxX-x:x-b.minX)*scale)+num('left'),(y-b.minY)*scaleY+num('workHeight')-num('top')-num('designHeight')]));
}
function workpieceCorners(){
  if(corners)return corners;
  const start=firstCorner||[num('originX'),num('originY')];
  return [start,[start[0]+num('workWidth'),start[1]+num('workHeight')]];
}
function job(strokes=transformed()){return {width:num('workWidth'),height:num('workHeight'),originX:num('originX'),originY:num('originY'),speed:num('speed'),corners:workpieceCorners(),strokes};}
function valid(){
  if(!art||!settings||firstCorner||num('designWidth')<=0||num('designHeight')<=0)return false;
  try{const j=job();if(![j.width,j.height,j.originX,j.originY,j.speed].every(Number.isFinite)||j.width<=0||j.height<=0||j.originX<0||j.originY<0||j.width+j.originX>settings.bedWidth+1e-9||j.height+j.originY>settings.bedHeight+1e-9)return false;
    const b=Artwork.bounds(j.strokes);return b.minX>=0&&b.minY>=0&&b.maxX<=j.width&&b.maxY<=j.height;
  }catch{return false;}
}
function buttons(){
  const busy=machine.busy||pending,ready=machine.connected&&machine.homed&&valid()&&!busy;
  $('homeButton').disabled=!machine.connected||busy;
  $('moveButton').disabled=!machine.connected||!machine.homed||busy;
  $('moveX').disabled=$('moveY').disabled=busy;
  $('outlineButton').disabled=!ready;$('previewButton').disabled=!ready;
  $('captureTop').disabled=!machine.connected||!machine.homed||busy;
  $('workpieceOutline').disabled=!machine.connected||!machine.homed||busy||!!firstCorner;
  $('captureBottom').disabled=$('captureTop').disabled||!firstCorner;$('markButton').disabled=!ready||!previewed;
  $('stopButton').disabled=!machine.busy||machine.stopping;
  document.querySelectorAll('[data-jog]').forEach(button => {
    const delta=button.dataset.jog.split(',').map(Number);
    const outside=machine.xyz && settings && delta.some((direction,axis) => {
      const step=axis===0?settings.stepX:settings.stepY;
      const target=machine.xyz[axis]+Math.round(direction*num('jogStep')/step);
      return target<0 || target*step>(axis===0?settings.bedWidth:settings.bedHeight);
    });
    button.disabled=!machine.connected||!machine.homed||busy||outside;
    button.title=outside?'Travel limit: choose another direction or a smaller step.':'';
  });
  for(const id of [...layoutInputs,'importButton','emptyImport','sampleButton','fitButton','centerButton','saveButton','settingsButton','connectionButton','threshold','jogStep'])$(id).disabled=busy;
  $('connectionLabel').textContent=machine.connected?`Engraver connected · ${machine.version}`:'Not connected';
  $('statusDot').classList.toggle('connected',machine.connected);
  $('connectionButton').textContent=machine.connected?'Manage':'Connect';
  $('position').textContent=machine.xyz&&settings?`X ${(machine.xyz[0]*settings.stepX).toFixed(1)}  ·  Y ${(machine.xyz[1]*settings.stepY).toFixed(1)} mm`:'X —   Y —';
  positionPreview();
  if(!machine.busy){$('runTitle').textContent=previewed?'Ready to engrave':art?'Placement not checked':'Import artwork';$('runHint').textContent=!machine.connected?'Connect your engraver to continue.':!machine.homed?'Press Start on the machine to home it.':!valid()?firstCorner?'Jog to bottom-right and capture the second corner.':'Fit artwork inside the workpiece.':previewed?'Placement checked. Press Start on the machine or click Engrave.':'Press Start to outline the design, or use the preview buttons.';}
}
function render(invalidate=true){
  if(invalidate){previewed=false;$('progressBar').style.width='0%';}
  const w=num('workWidth'),h=num('workHeight');if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0){buttons();return;}
  $('workWidth').max=settings.bedWidth;$('workHeight').max=settings.bedHeight;
  $('moveX').max=settings.bedWidth;$('moveY').max=settings.bedHeight;
  $('canvas').setAttribute('viewBox',`-9 -7 ${w+18} ${h+14}`);
  for(const id of ['sheet','gridRect']){const el=$(id);el.setAttribute('x',0);el.setAttribute('y',0);el.setAttribute('width',w);el.setAttribute('height',h);}
  $('sheet').classList.toggle('located',!!corners);
  const shadow=$('sheetShadow');shadow.setAttribute('x',.7);shadow.setAttribute('y',1);shadow.setAttribute('width',w);shadow.setAttribute('height',h);
  $('artPaths').replaceChildren();$('selection').setAttribute('visibility','hidden');
  $('pathLabel').textContent=art?'Enter positive width and height':'No artwork loaded';
  if(art&&num('designWidth')>0&&num('designHeight')>0){try{
    const strokes=transformed(),b=Artwork.bounds(strokes);const ns='http://www.w3.org/2000/svg';
    for(const stroke of strokes){const p=document.createElementNS(ns,'polyline');p.setAttribute('points',stroke.map(([x,y])=>`${x},${h-y}`).join(' '));$('artPaths').append(p);}
    const sel=$('selection');for(const [key,value] of Object.entries({x:b.minX,y:h-b.maxY,width:b.width,height:b.height,visibility:'visible'}))sel.setAttribute(key,value);
    $('artPaths').setAttribute('stroke',valid()?'#263c38':'#bf5040');$('pathLabel').textContent=`${b.width.toFixed(1)} × ${b.height.toFixed(1)} mm · ${strokes.length} strokes`;
  }catch(e){notice(e.message,true);}}
  $('empty').hidden=!!art;$('artInfo').hidden=!art;$('artName').textContent=name;
  $('artDetail').textContent=art?`${art.length} paths · ready to position`:'';
  $('documentTitle').textContent=art?name:'No artwork loaded';
  $('documentSubtitle').textContent=art?'Drag to position · dimensions in millimetres':'Import artwork or try the sample';
  $('sizeLabel').textContent=`${Number(w.toFixed(2))} × ${Number(h.toFixed(2))} mm workpiece`;
  $('correctionLabel').textContent=corners?'Position set from two corners':firstCorner?'Top-left set · awaiting bottom-right':'Machine origin · top-left';
  $('originMarker').replaceChildren();
  const marker=document.createElementNS('http://www.w3.org/2000/svg','text');marker.setAttribute('x','-1');marker.setAttribute('y','-2');marker.setAttribute('font-size','1.7');marker.setAttribute('fill','#90988d');marker.textContent='0,0';$('originMarker').append(marker);
  buttons();
  clearTimeout(saveTimer);saveTimer=setTimeout(saveDraft,250);
}
function fit(){
  if(!art)return;
  const margin=Math.min(5,num('workWidth')/10,num('workHeight')/10);
  const ratio=num('designWidth')/num('designHeight');
  const width=Math.min(num('workWidth')-2*margin,(num('workHeight')-2*margin)*ratio);
  if(!Number.isFinite(width)||width<=0)throw new Error('Enter positive workpiece and design dimensions.');
  $('designWidth').value=width;$('designHeight').value=width/ratio;aspect=ratio;center();
}
function center(){
  if(!art)return;
  $('left').value=(num('workWidth')-num('designWidth'))/2;
  $('top').value=(num('workHeight')-num('designHeight'))/2;render();
}
function project(){
  const layout=Object.fromEntries(layoutInputs.map(id=>[id,checkboxInputs.includes(id)?$(id).checked:num(id)]));
  return {format:'peen-studio-3',name,art,layout,corners,calibration:[settings.stepX,settings.stepY,settings.reverseX]};
}
function saveDraft(){
  try{localStorage.setItem('peen-draft',JSON.stringify(project()));}
  catch{notice('Automatic save failed. Use Save project to keep this setup.',true);}
}
function restore(saved){
  if(!['peen-studio-1','peen-studio-2','peen-studio-3'].includes(saved.format))throw new Error('Not a Mark Studio project.');
  if(saved.art){
    if(!Array.isArray(saved.art)||!saved.art.every(stroke=>Array.isArray(stroke)&&stroke.length>=2&&stroke.every(point=>Array.isArray(point)&&point.length===2)))throw new Error('Project contains invalid artwork.');
    Artwork.bounds(saved.art);
  }
  art=saved.art||null;name=String(saved.name||'').slice(0,200);rasterData=null;
  for(const id of layoutInputs){
    if(checkboxInputs.includes(id))$(id).checked=typeof saved.layout?.[id]==='boolean'?saved.layout[id]:id!=='mirror';
    else if(Number.isFinite(saved.layout?.[id]))$(id).value=saved.layout[id];
  }
  if(art&&!Number.isFinite(saved.layout?.designHeight)){
    const angle=num('rotation')*Math.PI/180;
    const b=Artwork.bounds(art.map(stroke=>stroke.map(([x,y])=>[x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle)])));
    $('designHeight').value=num('designWidth')*b.height/b.width;
  }
  if(saved.format==='peen-studio-1')$('top').value=num('workHeight')-(saved.layout?.bottom||0)-num('designHeight');
  const c=saved.corners;
  corners=Array.isArray(c)&&c.length===2&&c.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite))?c:null;
  if(saved.calibration&&JSON.stringify(saved.calibration)!==JSON.stringify([settings.stepX,settings.stepY,settings.reverseX]))corners=null;
  firstCorner=null;aspect=num('designWidth')/num('designHeight');previousRotation=num('rotation');
  $('cornerStatus').textContent=corners?'Saved workpiece restored. Home and check placement before engraving.':'Workpiece dimensions restored.';
  $('rasterTools').hidden=true;render();
}
function positionPreview(){
  if(!settings)return;
  const w=num('workWidth'),h=num('workHeight');
  const c=workpieceCorners();
  $('bedMap').setAttribute('viewBox',`-4 -4 ${settings.bedWidth+8} ${settings.bedHeight+8}`);
  $('pieceRect').setAttribute('stroke-dasharray',firstCorner?'2 1':'none');
  $('bedRect').setAttribute('width',settings.bedWidth);$('bedRect').setAttribute('height',settings.bedHeight);
  for(const [key,value] of Object.entries({x:Math.min(c[0][0],c[1][0]),y:Math.min(c[0][1],c[1][1]),width:w,height:h}))$('pieceRect').setAttribute(key,value);
  const known=machine.connected&&machine.homed&&machine.xyz&&!machine.busy;
  $('headDot').setAttribute('visibility',known?'visible':'hidden');$('bedDot').setAttribute('visibility',known?'visible':'hidden');
  $('positionHint').textContent=machine.busy?'Moving · position updates after completion':machine.homed?'Reported machine position · mm':'Home to verify tip position';
  if(!known)return;
  const x=machine.xyz[0]*settings.stepX,y=machine.xyz[1]*settings.stepY;
  const localX=(x-c[0][0])*Math.sign(c[1][0]-c[0][0]),localY=(y-c[0][1])*Math.sign(c[1][1]-c[0][1]);
  $('headDot').setAttribute('cx',localX);$('headDot').setAttribute('cy',localY);
  $('bedDot').setAttribute('cx',x);$('bedDot').setAttribute('cy',y);
}
async function importData(file){
  if(!file)return;const generation=++importGeneration;const ext=file.name.split('.').pop().toLowerCase();
  notice('Preparing artwork…');await new Promise(r=>setTimeout(r,20));
  let next;
  if(ext==='peen'){
    const saved=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.data),c=>c.charCodeAt(0))));
    restore(saved);notice('Project opened. Home and check placement before engraving.');return;
  }else if(ext==='svg'){
    next=Artwork.svg(new TextDecoder().decode(Uint8Array.from(atob(file.data),c=>c.charCodeAt(0))));rasterData=null;
  }else if(['png','jpg','jpeg','webp'].includes(ext)){
    rasterData=`data:image/${ext==='jpg'?'jpeg':ext};base64,${file.data}`;next=await Artwork.raster(rasterData,num('threshold'));
  }else throw new Error('Choose an SVG, PNG, JPG, WebP or .peen project.');
  if(generation!==importGeneration)return;
  art=next;name=file.name;$('rotation').value='0';$('mirror').checked=false;previousRotation=0;const bounds=Artwork.bounds(art);aspect=bounds.width/bounds.height;$('designWidth').value=55;$('designHeight').value=55/aspect;$('rasterTools').hidden=!rasterData;fit();
  notice(rasterData?'Outline tracing complete. Inspect the paths before marking; solid areas are not filled.':'Artwork imported and fitted to the workpiece.');
}
function ask(title,text,readiness=false){return new Promise(resolve=>{
  const d=$('confirmDialog');$('confirmTitle').textContent=title;$('confirmText').textContent=text;$('readyLabel').hidden=!readiness;$('ready').checked=false;$('acceptConfirm').disabled=readiness;
  $('ready').onchange=()=>{$('acceptConfirm').disabled=readiness&&!$('ready').checked;};
  const finish=value=>{d.close();d.oncancel=null;resolve(value);};$('cancelConfirm').onclick=()=>finish(false);$('acceptConfirm').onclick=()=>finish(true);d.oncancel=e=>{e.preventDefault();finish(false);};d.showModal();
});}
async function ports(){const list=await api.ports();$('portSelect').replaceChildren();for(const p of list){const o=document.createElement('option');o.value=p.path;o.textContent=`${p.recommended?'VEVOR / FTDI · ':''}${p.path}`;o.selected=p.recommended;$('portSelect').append(o);}if(!list.length){const o=document.createElement('option');o.textContent='No serial devices found';o.value='';$('portSelect').append(o);}$('doConnect').disabled=!list.length;return list;}
const importArtwork=()=>perform(async()=>importData(await api.import()));
$('importButton').onclick=$('emptyImport').onclick=importArtwork;
$('sampleButton').onclick=()=>perform(async()=>{const response=await fetch('sample.svg');await importData({name:'First mark.svg',data:btoa(await response.text())});});
$('fitButton').onclick=()=>{try{fit();}catch(e){notice(e.message,true);}};$('centerButton').onclick=center;
for(const id of layoutInputs)$(id).addEventListener('input',()=>{
  if(['workWidth','workHeight','originX','originY'].includes(id)){corners=null;firstCorner=null;$('cornerStatus').textContent='Manual dimensions · set corners to locate the piece';}
  if(id==='designWidth'&&$('lockRatio').checked&&num(id)>0)$('designHeight').value=num(id)/aspect;
  if(id==='designHeight'&&$('lockRatio').checked&&num(id)>0)$('designWidth').value=num(id)*aspect;
  if(id==='rotation'){
    if(Math.abs(num('rotation')-previousRotation)%180===90){const width=num('designWidth');$('designWidth').value=num('designHeight');$('designHeight').value=width;}
    previousRotation=num('rotation');
  }
  if(num('designWidth')>0&&num('designHeight')>0)aspect=num('designWidth')/num('designHeight');
  if(id==='speed')$('speedValue').textContent=$(id).value;
  render();
});
$('threshold').onchange=()=>perform(async()=>{if(rasterData){$('thresholdValue').textContent=$('threshold').value;art=await Artwork.raster(rasterData,num('threshold'));fit();}});
$('saveButton').onclick=()=>perform(async()=>{if(await api.save(JSON.stringify(project())))notice('Project saved.');});
$('connectionButton').onclick=()=>perform(async()=>{await ports();$('connectDialog').showModal();});$('refreshPorts').onclick=()=>perform(ports);
$('doConnect').onclick=()=>perform(async()=>{machine=await api.connect($('portSelect').value);autoConnect=true;$('connectDialog').close();notice('Connected. Home the machine when the carriage path is clear.');});
$('disconnectButton').onclick=()=>perform(async()=>{autoConnect=false;await api.disconnect();$('connectDialog').close();notice('Engraver disconnected.');});
$('settingsButton').onclick=()=>{for(const id of ['bedWidth','bedHeight','stepX','stepY'])$(id).value=settings[id];$('reverseX').checked=settings.reverseX;$('settingsDialog').showModal();};
$('saveSettings').onclick=()=>perform(async()=>{const next={reverseX:$('reverseX').checked};for(const id of ['bedWidth','bedHeight','stepX','stepY'])next[id]=num(id);settings=await api.settings(next);corners=null;firstCorner=null;$('cornerStatus').textContent='Machine settings changed. Set both corners again.';$('settingsDialog').close();render();notice('Settings saved. Home again before moving or marking.');});
$('homeButton').onclick=()=>perform(async()=>{if(await ask('Home the machine?','The X and Y carriage will travel to its limit switches. Keep its path clear.')){previewed=false;await api.home();notice('Homed. Preview your artwork to verify placement.');}});
for(const button of document.querySelectorAll('[data-jog]'))button.onclick=()=>perform(async()=>{const [x,y]=button.dataset.jog.split(',').map(Number);previewed=false;await api.jog(x*num('jogStep'),y*num('jogStep'));});
$('jogStep').onchange=buttons;
$('moveForm').onsubmit=event=>{event.preventDefault();void perform(async()=>{previewed=false;await api.move(num('moveX'),num('moveY'));notice('Position reached. Pin off.');});};
$('captureTop').onclick=()=>perform(async()=>{firstCorner=await api.capture();corners=null;previewed=false;$('cornerStatus').textContent=`Top-left captured at X ${firstCorner[0].toFixed(2)}, Y ${firstCorner[1].toFixed(2)}. Jog to bottom-right.`;render();});
$('captureBottom').onclick=()=>perform(async()=>{const end=await api.capture();const width=Math.abs(end[0]-firstCorner[0]),height=Math.abs(end[1]-firstCorner[1]);if(width<1||height<1)throw new Error('Corners must be at least 1 mm apart on both axes.');corners=[firstCorner,end];$('workWidth').value=width;$('workHeight').value=height;$('originX').value=Math.min(firstCorner[0],end[0]);$('originY').value=Math.min(firstCorner[1],end[1]);firstCorner=null;$('cornerStatus').textContent=`Workpiece set · ${width.toFixed(2)} × ${height.toFixed(2)} mm`;if(art)fit();else render();notice('Corners set. Use Outline workpiece to check the material boundary.');});
$('workpieceOutline').onclick=()=>perform(async()=>{if(await ask('Outline workpiece — pin off?','The tip will trace all four workpiece edges and return to its top-left corner. Keep the carriage path clear.')){previewed=false;await api.run(job([]),'workpiece');notice('Workpiece outline complete. Check the rectangle against the material.');}});
$('outlineButton').onclick=()=>perform(async()=>{if(await ask('Outline — pin off?','Trace the rectangular boundary of the design with the marking pin inactive. Keep the carriage path clear.')){previewed=false;await api.run(job(),'outline');previewed=true;notice('Outline complete. Check that the boundary is on your workpiece.');}});
$('previewButton').onclick=()=>perform(async()=>{if(await ask('Dry run — pin off?','The carriage will trace the artwork with the marking pin inactive. Keep the path clear.')){previewed=false;await api.run(job(),'dry-run');previewed=true;notice('Preview completed. Check the placement, then engrave.');}});
$('markButton').onclick=()=>perform(async()=>{if(await ask('Engrave this design?','One permanent marking pass at the position shown. Confirm the outline or dry run landed correctly. Keep the workpiece fixed.',true)){await api.run(job(),'engrave');previewed=true;notice('Marking pass complete. Inspect the workpiece before repeating.');}});
$('stopButton').onclick=()=>{void api.stop().catch(e=>notice(e.message,true));};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&machine.busy){e.preventDefault();void api.stop().catch(err=>notice(err.message,true));}});
api.onUpdate(({type,data})=>{
  if(type==='start' && machine.connected && !machine.busy && !pending && !document.querySelector('dialog[open]'))void perform(async()=>{
    if(!machine.homed){await api.home();notice('Homed. Release Start, then press again to outline the design.');return;}
    if(!valid()){notice('Import artwork and fit it inside the workpiece first.',true);return;}
    const mode=previewed?'engrave':'outline';
    previewed=false;
    await api.run(job(),mode);
    previewed=mode==='outline';
    notice(previewed?'Outline complete. Release Start for one second, then press again to engrave.':'Marking pass complete. The next Start press will outline again.');
  });
  if(type==='state'){machine=data;if(!machine.connected||!machine.homed){previewed=false;if(firstCorner)$('cornerStatus').textContent='Connection or home lost. Home, then capture top-left again.';firstCorner=null;}buttons();}
  if(type==='log')notice(data);
  if(type==='progress'){$('progressBar').style.width=`${data.value}%`;$('runTitle').textContent=data.label;$('runHint').textContent=data.value===100?'Controller confirmed completion.':`${data.value}% · Keep hands clear` ;}
  if(type==='command'){if(data==='import')importArtwork();if(data==='save')$('saveButton').click();}
});
const stage=$('stage');
for(const event of ['dragenter','dragover'])stage.addEventListener(event,e=>{e.preventDefault();if(!machine.busy&&!pending)$('dropOverlay').hidden=false;});
stage.addEventListener('dragleave',e=>{if(!stage.contains(e.relatedTarget))$('dropOverlay').hidden=true;});
stage.addEventListener('drop',e=>{e.preventDefault();$('dropOverlay').hidden=true;if(machine.busy||pending)return;const file=e.dataTransfer.files[0];if(!file)return;void perform(async()=>{if(file.size>8*1024*1024)throw new Error('Choose artwork smaller than 8 MB.');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=()=>reject(new Error('Could not read file.'));r.readAsDataURL(file);});await importData({name:file.name,data});});});
function canvasPoint(e){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform($('canvas').getScreenCTM().inverse());return [p.x,num('workHeight')-p.y];}
$('canvas').addEventListener('pointerdown',e=>{if(!art||machine.busy||pending)return;const [x,y]=canvasPoint(e),b=Artwork.bounds(transformed());if(x<b.minX-1||x>b.maxX+1||y<b.minY-1||y>b.maxY+1)return;drag={x,y,left:num('left'),top:num('top')};$('canvas').setPointerCapture(e.pointerId);});
$('canvas').addEventListener('pointermove',e=>{if(!drag)return;const [x,y]=canvasPoint(e);$('left').value=(drag.left+x-drag.x).toFixed(2);$('top').value=(drag.top-y+drag.y).toFixed(2);snapPlacement();render();});
$('canvas').addEventListener('pointerup',()=>{drag=null;$('snapGuides').replaceChildren();saveDraft();});$('canvas').addEventListener('pointercancel',()=>{drag=null;$('snapGuides').replaceChildren();});
function snapPlacement(){
  $('snapGuides').replaceChildren();
  if(!$('snap').checked)return;
  const threshold=8/Math.abs($('canvas').getScreenCTM().a);
  for(const [id,size,total,vertical] of [['left',num('designWidth'),num('workWidth'),true],['top',num('designHeight'),num('workHeight'),false]]){
    const candidates=[0,(total-size)/2,total-size];
    const value=num(id),nearest=candidates.reduce((a,b)=>Math.abs(b-value)<Math.abs(a-value)?b:a);
    if(Math.abs(nearest-value)>threshold)continue;
    $(id).value=nearest;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    const guide=nearest===0?0:nearest===total-size?total:total/2;
    for(const [key,val] of Object.entries(vertical?{x1:guide,x2:guide,y1:0,y2:num('workHeight')}:{y1:guide,y2:guide,x1:0,x2:num('workWidth')}))line.setAttribute(key,val);
    $('snapGuides').append(line);
  }
}
window.addEventListener('beforeunload',saveDraft);
(async()=>{try{const initial=await api.initial();settings=initial.settings;machine=initial.state;const draft=localStorage.getItem('peen-draft');if(draft){try{restore(JSON.parse(draft));}catch(e){notice(`Saved setup could not be restored: ${e.message}`,true);}}render(false);await reconnect();setInterval(()=>void reconnect(),3000);}catch(e){notice(e.message,true);}})();

async function reconnect(){
  if(!autoConnect||machine.connected||machine.busy||pending||document.querySelector('dialog[open]'))return;
  await perform(async()=>{
    const available=(await api.ports()).filter(p=>p.recommended);
    if(available.length!==1)return;
    machine=await api.connect(available[0].path);
    notice('Connected. Press Start on the machine to home it.');
  });
}
