'use strict';
// Group existing nodes; retain their actions, labels, permissions and disabled state.
function arrangePageActions(){
 const heading=document.querySelector('main > .page-head');if(!heading)return;
 let group=heading.querySelector(':scope > .page-actions');
 const nodes=[...heading.children].filter(el=>el!==group&&(el.matches('button,a.button,.button-group')));
 if(!nodes.length)return;
 if(!group){group=document.createElement('div');group.className='page-actions';group.setAttribute('role','group');group.setAttribute('aria-label','จัดการหน้านี้');heading.append(group)}
 for(const node of nodes){if(node.matches('.button-group')){while(node.firstChild)group.append(node.firstChild);node.remove()}else group.append(node)}
 const priority=el=>el.matches('.danger,[data-cleanup],[data-empty-trash]')?2:el.matches('.secondary,.ghost')?1:0;
 [...group.children].sort((a,b)=>priority(a)-priority(b)).forEach(el=>group.append(el));
}
const buttonLayoutRender=render;render=function(){buttonLayoutRender();arrangePageActions()};
if(user)arrangePageActions();
