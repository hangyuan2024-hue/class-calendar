(function () {
  'use strict';
  const KEY = 'home_quick_tools_v1', dialog = document.getElementById('quickToolDialog');
  const base = [
    ['cIngestBtn','✨','AI 整理','整理班级群消息',()=>ingestAllowed()],
    ['cAddBtn','📣','发布事项','发布班级作业与通知',()=>canAddItem()],
    ['qMine','✏️','记一件事','添加自己的待办',()=>feat('mine')],
    ['qPlan','🎯','时间管理','四象限与学习规划',()=>funOpts().plan,'plan'],
    ['qIcs','🔥','打卡成长','习惯与成长记录',()=>funOpts().habits,'growth'],
    ['qFarm','🐣','云宠农场','养料与陪伴',()=>farmOn(),'farm'],
    ['qPomo','🍅','番茄专注','开始一个专注时段',()=>funOpts().plan],
    ['qCourse','📚','课程表','查看自己的课程',()=>!!courseTool()],
    ['qPeople','👥','班级成员','找到同学与老师',()=>!!(currentUser&&currentClass),'people'],
    ['qCal','📲','加到日历','导出或订阅系统日历',()=>true],
    ['qIntro','📖','功能介绍','认识校园工具',()=>true,'intro'],
    ['qPeopleDaily','📰','人民日报','打开人民日报网站',()=>true]
  ];
  let mode = 'open', draft = new Set(), opener = null, installing = false;
  function catalog() {
    const out = base.filter(x=>x[4]()).map(([id,icon,name,desc,,view])=>({id,icon,name,desc,view,button:id}));
    const covered = new Set([...out.map(t=>t.view).filter(Boolean),...(courseTool()?[courseTool().view]:[])]);
    return out.concat(toolList().filter(t=>!covered.has(t.view)).map(t=>({...t,id:t.id})));
  }
  function selected() { const saved=load(KEY,null); return new Set(Array.isArray(saved)?saved:base.map(x=>x[0])); }
  function render() {
    const picks=selected(), q=document.getElementById('quickPart');
    for(const [id,,,,available] of base) document.getElementById(id)?.classList.toggle('hidden',!available()||!picks.has(id));
    q.querySelectorAll('[data-quick-extra]').forEach(el=>el.remove());
    for(const t of catalog().filter(t=>!t.button&&picks.has(t.id))) {
      const b=document.createElement('button'); b.type='button'; b.className='qbtn'; b.dataset.quickExtra=t.id; b.dataset.tab=t.view;
      b.innerHTML=`<span class="qi">${esc(t.icon)}</span>${esc(t.name)}`; q.insertBefore(b,document.getElementById('qTools'));
    }
    if(dialog.open) paint();
  }
  function row(t, manage) {
    const copy=`<span class="quick-pick-icon" aria-hidden="true">${esc(t.icon)}</span><span class="quick-pick-copy"><b>${esc(t.name)}</b><small>${esc(t.desc||'')}</small></span>`;
    return manage?`<label class="quick-pick">${copy}<input type="checkbox" data-quick-pick="${esc(t.id)}" ${draft.has(t.id)?'checked':''} aria-label="首页显示${esc(t.name)}"></label>`:`<button type="button" class="quick-pick" data-quick-launch="${esc(t.id)}">${copy}<span class="quick-pick-go" aria-hidden="true">›</span></button>`;
  }
  function paint() {
    const query=document.getElementById('quickToolSearch').value.trim().toLowerCase();
    let items=catalog();
    if(mode==='open') {
      const extra=[{id:'core:calendar',view:'calendar',icon:'🗓️',name:'日历',desc:'按日期查看完整安排'},{id:'core:wall',view:'wall',icon:'💬',name:'班级墙',desc:'班级通知与交流'}].filter(t=>viewOn(t.view));
      items=extra.concat(items); const picks=selected(); items.sort((a,b)=>Number(picks.has(b.id))-Number(picks.has(a.id)));
    }
    const match=t=>(t.name+' '+t.desc).toLowerCase().includes(query);
    let html=items.filter(match).map(t=>row(t,mode==='manage')).join('');
    if(mode==='manage'&&feat('tools')) {
      const waiting=registry.filter(p=>p.channel!=='testing'&&!pluginState[p.key]?.running&&match({name:p.name,desc:p.description||''}));
      if(waiting.length) html+=`<div class="quick-section-title"><span>还可以添加</span><span>添加后即可勾选</span></div>`+waiting.map(p=>`<div class="quick-pick"><span class="quick-pick-icon">${esc(p.icon||'🧩')}</span><span class="quick-pick-copy"><b>${esc(p.name)}</b><small>${esc(p.description||'')}</small></span><button type="button" class="quick-install" data-quick-install="${esc(p.key)}" ${installing?'disabled':''}>添加</button></div>`).join('');
    }
    document.getElementById('quickToolList').innerHTML=html||'<div class="quick-empty">没有找到这个工具，试试其他关键词。</div>';
    document.getElementById('quickToolCount').textContent=mode==='manage'?`已选 ${catalog().filter(t=>draft.has(t.id)).length} 个`:'点选即可打开';
  }
  function open(next,button) {
    mode=next; opener=button; draft=selected(); document.getElementById('quickToolSearch').value=''; document.getElementById('quickToolStatus').textContent='';
    document.getElementById('quickToolTitle').textContent=mode==='manage'?'自选首页工具':'快捷选择工具';
    document.getElementById('quickToolIntro').textContent=mode==='manage'?'勾选首页常用入口。已安装的工具也能放进工具栏；取消勾选只移走入口。':'搜索并直接打开工具。日历和班级墙也可以从这里进入。';
    for(const id of ['quickToolReset','quickToolSave']) document.getElementById(id).hidden=mode!=='manage';
    paint(); dialog.showModal();
    if(mode==='manage') refreshRegistry().then(()=>{if(dialog.open&&mode==='manage')paint();});
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-quick-manage],[data-quick-open],[data-quick-launch],[data-quick-install]'); if(!b)return;
    if(b.hasAttribute('data-quick-manage'))return open('manage',b);
    if(b.hasAttribute('data-quick-open'))return open('open',b);
    if(b.dataset.quickLaunch) {
      const id=b.dataset.quickLaunch,t=catalog().find(x=>x.id===id); dialog.close();
      if(id.startsWith('core:'))showView(id.slice(5)); else if(t?.button)document.getElementById(t.button).click(); else if(t)showView(t.view);
    }
    if(b.dataset.quickInstall) {
      const meta=registry.find(p=>p.key===b.dataset.quickInstall); if(!meta||installing)return;
      installing=true; document.getElementById('quickToolStatus').textContent=`正在添加${meta.name}…`; paint();
      try {await enablePlugin(meta); const added=catalog().find(t=>t.plugin===meta.key||meta.id==='course-schedule'&&t.id==='qCourse'); if(added)draft.add(added.id); document.getElementById('quickToolStatus').textContent='已添加，点击“保存选择”放到首页。';}
      catch(err){document.getElementById('quickToolStatus').textContent=err.message;}
      finally{installing=false;paint();}
    }
  });
  document.getElementById('quickToolList').addEventListener('change',e=>{const b=e.target.closest('[data-quick-pick]');if(b){b.checked?draft.add(b.dataset.quickPick):draft.delete(b.dataset.quickPick);document.getElementById('quickToolCount').textContent=`已选 ${catalog().filter(t=>draft.has(t.id)).length} 个`;}});
  document.getElementById('quickToolSearch').addEventListener('input',paint);
  document.getElementById('quickToolClose').onclick=()=>dialog.close();
  document.getElementById('quickToolSave').onclick=()=>{if(installing)return;try{save(KEY,[...draft]);render();dialog.close();}catch(e){document.getElementById('quickToolStatus').textContent='本机空间不足，选择未保存。';}};
  document.getElementById('quickToolReset').onclick=()=>{draft=new Set(base.map(x=>x[0]));paint();};
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{const target=opener?.isConnected?opener:document.getElementById('navToolPicker');target?.focus({preventScroll:true});});
  new MutationObserver(()=>requestAnimationFrame(()=>{for(const f of frames.values())if(f.mode==='app')f.post({cc:'theme-snapshot',vars:themeSnapshot()});})).observe(document.documentElement,{attributes:true,attributeFilter:['data-skin','data-mode','style']});
  window.CampusQuick={render};render();
})();
