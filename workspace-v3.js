(function(){
  'use strict';
  const root=document.documentElement, toggle=document.getElementById('sidebarToggle');
  let collapsed=false;try{collapsed=localStorage.getItem('campus_sidebar_collapsed_v1')==='1'}catch(e){}
  function paint(){root.classList.toggle('sidebar-collapsed',collapsed);toggle.setAttribute('aria-expanded',String(!collapsed));toggle.title=collapsed?'展开侧栏':'收起侧栏';toggle.querySelector('span').textContent=toggle.title}
  toggle.addEventListener('click',()=>{collapsed=!collapsed;paint();try{localStorage.setItem('campus_sidebar_collapsed_v1',collapsed?'1':'0')}catch(e){}requestAnimationFrame(fitQuick)});paint();
  const quick=document.getElementById('quickPart'), widgets=document.getElementById('widgets');
  function fitQuick(){const card=quick.closest('.wcard');if(!card||card.closest('.wedit'))return;const grid=getComputedStyle(widgets),step=parseFloat(grid.gridAutoRows)+parseFloat(grid.rowGap||0);if(!step)return;const rows=Math.max(1,Math.ceil((quick.getBoundingClientRect().height+parseFloat(grid.rowGap||0))/step));const value='span '+rows;if(card.style.gridRowEnd!==value||card.style.gridRowStart!=='auto'){card.style.gridRowStart='auto';card.style.gridRowEnd=value}}
  const ro=new ResizeObserver(fitQuick);ro.observe(quick);ro.observe(widgets);
  new MutationObserver(()=>requestAnimationFrame(fitQuick)).observe(widgets,{childList:true});
  window.addEventListener('resize',fitQuick);requestAnimationFrame(fitQuick);
})();
