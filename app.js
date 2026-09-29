(() => {
  const KEY='euless-target-shelves-v2', OLD_KEY='euless-target-shelves-v1';
  const $=id=>document.getElementById(id);
  const stage=$('mapStage'), markers=$('markers'), viewport=$('mapViewport'), dialog=$('editor');
  let items=[]; try { const v=JSON.parse(localStorage.getItem(KEY)||'[]'); if(Array.isArray(v)) items=v.filter(x=>x&&Number.isInteger(x.shapeIndex)); } catch {}
  let oldPins=[]; try { const v=JSON.parse(localStorage.getItem(OLD_KEY)||'[]'); if(Array.isArray(v)) oldPins=v; } catch {}
  let shapes=[], svg=null, mode='add', zoom=1, editing=null, selectedIndex=null, pending=null, moving=null;
  const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
  function save(){localStorage.setItem(KEY,JSON.stringify(items));render()}
  function pointAtCenter(path){const b=path.getBBox(),v=svg.viewBox.baseVal;return {x:clamp((b.x+b.width/2-v.x)/v.width,0,1),y:clamp((b.y+b.height/2-v.y)/v.height,0,1)}}
  function pointForEvent(e){const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse()),v=svg.viewBox.baseVal;return {x:clamp((q.x-v.x)/v.width,0,1),y:clamp((q.y-v.y)/v.height,0,1)}}
  function render(){
    markers.replaceChildren();
    shapes.forEach((p,i)=>{p.classList.toggle('assigned',items.some(x=>x.shapeIndex===i));p.classList.toggle('selected',selectedIndex===i)});
    items.forEach(item=>{const b=document.createElement('button');b.type='button';b.className='marker';b.textContent=item.name;b.title=`${item.name} · ${item.steps} 步`;b.style.left=`${item.x*100}%`;b.style.top=`${item.y*100}%`;b.addEventListener('click',e=>{e.stopPropagation();selectShelf(item.shapeIndex,item)});markers.append(b)});
    $('count').textContent=`${items.length} 个编号`;$('savedCount').textContent=items.length;
  }
  function setMode(next){mode=next;for(const [id,value] of [['addMode','add'],['browseMode','browse']]){$(id).classList.toggle('active',value===next);$(id).setAttribute('aria-pressed',String(value===next))}stage.style.cursor=next==='add'?'crosshair':'grab';$('hint').textContent=next==='add'?'点选一段灰色货架，给这段货架编号。':'拖动地图查看；点已编号的货架可以修改。'}
  function openEditor(item=null,index=null,point=null){editing=item;pending=index===null?null:{shapeIndex:index,...point};selectedIndex=index;render();$('dialogTitle').textContent=item?'编辑这段货架':'给这段货架编号';$('shelfName').value=item?.name||'';$('shelfSteps').value=item?.steps||20;$('deleteBtn').hidden=!item;$('moveBtn').hidden=!item;dialog.showModal();$('shelfName').focus()}
  function selectShelf(index,item=items.find(x=>x.shapeIndex===index),point=null){if(!shapes[index])return;if(moving){if(item){$('hint').textContent='这段货架已有编号，请选择另一段。';return}moving.shapeIndex=index;Object.assign(moving,point||pointAtCenter(shapes[index]));moving=null;selectedIndex=index;save();$('hint').textContent='已改选货架。';return}if(mode==='browse'&&!item)return;openEditor(item,index,point||item||pointAtCenter(shapes[index]))}
  $('svgMount').addEventListener('click',e=>{const path=e.target.closest?.('#Aisle-Shapes > path');if(!path||!svg)return;const index=Number(path.dataset.index);selectShelf(index,items.find(x=>x.shapeIndex===index),pointForEvent(e))});
  $('editorForm').addEventListener('submit',e=>{e.preventDefault();const name=$('shelfName').value.trim(),steps=Number($('shelfSteps').value);if(!name||!Number.isInteger(steps)||steps<1||steps>500)return;if(editing){editing.name=name;editing.steps=steps}else if(pending){items.push({id:crypto.randomUUID(),name,steps,...pending})}save();dialog.close()});
  $('closeBtn').onclick=()=>dialog.close();$('deleteBtn').onclick=()=>{if(!editing)return;items=items.filter(x=>x.id!==editing.id);selectedIndex=null;save();dialog.close()};
  $('moveBtn').onclick=()=>{moving=editing;dialog.close();setMode('add');$('hint').textContent=`点选 ${moving.name} 要改到的那段货架。`};
  dialog.addEventListener('close',()=>{if(!moving){selectedIndex=null;render()}});
  $('addMode').onclick=()=>setMode('add');$('browseMode').onclick=()=>setMode('browse');
  function setZoom(v){zoom=clamp(v,.65,3);stage.style.width=`${Math.round(1250*zoom)}px`;$('zoomLabel').textContent=`${Math.round(zoom*100)}%`}
  $('zoomIn').onclick=()=>setZoom(zoom*1.25);$('zoomOut').onclick=()=>setZoom(zoom/1.25);
  $('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify({store:'Euless Target',shelves:items,previousPointMarkers:oldPins},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Euless_Target_货架编号备份.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
  async function loadMap(){try{const response=await fetch('map.svg');if(!response.ok)throw Error('map');const doc=new DOMParser().parseFromString(await response.text(),'image/svg+xml');svg=doc.documentElement;if(svg.tagName.toLowerCase()==='parsererror')throw Error('svg');svg.removeAttribute('width');svg.removeAttribute('height');$('svgMount').append(svg);shapes=[...svg.querySelectorAll('#Aisle-Shapes > path')];shapes.forEach((p,i)=>{p.dataset.index=i;p.setAttribute('tabindex','0');p.setAttribute('role','button');p.setAttribute('aria-label',`货架 ${i+1}`);p.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectShelf(i)}})});render();if(oldPins.length)$('hint').textContent='旧版点标记已保留在备份中。现在请直接点选灰色货架编号。'}catch{$('hint').textContent='地图加载失败，请刷新页面重试。'}}
  if(document.modelContext?.registerTool){const register=tool=>{try{Promise.resolve(document.modelContext.registerTool(tool)).catch(()=>{})}catch{}};
    register({name:'list_shelf_numbers',title:'查看货架编号',description:'读取已编号的货架图形及步数。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({shelves:items.map(({id,name,steps,shapeIndex,x,y})=>({id,name,steps,shapeIndex,x,y}))})});
    register({name:'assign_shelf_shape',title:'给货架编号',description:'将编号和总步数绑定到 Euless Target 地图的一段货架图形。',inputSchema:{type:'object',properties:{shapeIndex:{type:'integer',minimum:0},name:{type:'string'},steps:{type:'integer',minimum:1,maximum:500}},required:['shapeIndex','name','steps'],additionalProperties:false},annotations:{readOnlyHint:false},execute:input=>{if(!input||!Number.isInteger(input.shapeIndex)||!shapes[input.shapeIndex]||typeof input.name!=='string'||!input.name.trim()||input.name.length>24||!Number.isInteger(input.steps)||input.steps<1||input.steps>500)throw Error('货架、编号或步数不正确');const point=pointAtCenter(shapes[input.shapeIndex]);let item=items.find(x=>x.shapeIndex===input.shapeIndex);if(item){item.name=input.name.trim();item.steps=input.steps}else{item={id:crypto.randomUUID(),shapeIndex:input.shapeIndex,name:input.name.trim(),steps:input.steps,...point};items.push(item)}save();return {shelf:item}}});
  }
  render();setZoom(1);loadMap();
})();
