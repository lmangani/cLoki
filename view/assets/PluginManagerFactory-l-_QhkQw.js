import{r as y}from"./react-B8DbRJ_3.js";import{x}from"./index-BnoslHk9.js";const v=s=>n=>{n({type:"SET_PLUGINS",plugins:s})},A={Main:{parent:"",children:["Status Bar","Panel"]},"Status Bar":{parent:"Main",children:[""]},Panel:{parent:"Main",children:["Queries","Data Views"]},Queries:{parent:"Panel",children:["Stats","Data Views"]},Stats:{parent:"Queries",children:[""]},"Data Views":{parent:"Panel",children:["Data View Header","View"]},"Query Item":{parent:"Queries",children:[]}};function M(){function s(){try{return JSON.parse(localStorage.getItem("plugins")||"{}")}catch{return{}}}function n(r,l){var o;let a=s();a[r]||(a[r]=[]),(o=a[r])!=null&&o.some(e=>e.name===l.name)||(a[r].push(l),localStorage.setItem("plugins",JSON.stringify(a)))}function c(r){let l=s();return l[r]?l[r]:[]}function P(r,l){var o,e;let a=s();if(a[r]&&Array.isArray(a[r])&&((o=a[r])!=null&&o.some(i=>i.name===l))){let i=(e=a[r])==null?void 0:e.filter(t=>t.name!==l);a[r]=i,localStorage.setItem("plugins",JSON.stringify(a))}}function h(r,l,a){var i;const o=s(),e=(i=o[r])==null?void 0:i.findIndex(t=>(t==null?void 0:t.name)===l);if(e>=0){const t={...o,[r]:o[r].map((g,f)=>f===e?{...g,active:a}:g)};localStorage.setItem("plugins",JSON.stringify(t))}}function S(r,l,a){var i;const o=s(),e=(i=o[r])==null?void 0:i.findIndex(t=>(t==null?void 0:t.name)===l);if(e>=0){const t={...o,[r]:o[r].map((g,f)=>f===e?{...g,visible:a}:g)};localStorage.setItem("plugins",JSON.stringify(t))}}return{getAll:s,getPluginsFromLocation:c,setPlugin:n,removePlugin:P,togglePlugin:h,togglePluginVisibility:S}}function b(){const s=M(),[n]=y.useState(s.getAll());return y.useMemo(()=>{var P;return((P=Object.keys(n))==null?void 0:P.length)>0?Object.entries(n):[]},[n])}function w(s){const n=b(),c=y.useMemo(()=>{if(n!=null&&n.some(h=>h[0]===s)){let h=n==null?void 0:n.filter(([S])=>S===s)[0][1];return h==null?void 0:h.filter(S=>S.active&&S.visible)}return[]},[n]),P=y.useMemo(()=>(c==null?void 0:c.length)>0,c);return{activeTabs:c,isActiveTabs:P}}function O(s){const n={},c=M();let P=c.getAll();function h(e,i){var t,g;if((i==null?void 0:i.length)>0)for(const f of i){const m=f.section;if(P[m]){const p=i.filter(u=>u.section===m).map(({name:u})=>u),d=(t=P[m])==null?void 0:t.filter(u=>!p.includes(u.name));(d==null?void 0:d.length)>0&&d.forEach(({section:u,name:I})=>{c.removePlugin(u,I)})}}n[e.section]||(n[e.section]=[]),n[e.section].push(e),x.dispatch(v(n)),(g=P[e.section])!=null&&g.some(f=>f.name===e.name)||c.setPlugin(e.section,e)}function S(e){for(let i in s)i!=="Main"&&h(e,n)}function r(e){var f,m;let i=c.getPluginsFromLocation(e);const t=(f=n==null?void 0:n[e])==null?void 0:f.filter((p,d)=>{var u;return((u=n[e])==null?void 0:u.findIndex(I=>I.name===p.name))===d});let g=[];if((t==null?void 0:t.length)>0)for(let p of i){let d=(m=t==null?void 0:t.find)==null?void 0:m.call(t,u=>u.name===p.name);p.active&&g.push(d)}return g||[]}function l(e,i){var f;const t=(f=n==null?void 0:n[e])==null?void 0:f.filter((m,p)=>{var d;return((d=n[e])==null?void 0:d.findIndex(u=>u.name===m.name))===p});return(t==null?void 0:t.find(m=>(m==null?void 0:m.name)===i))||{}}function a(e,i,t){c.togglePlugin(e,i,t)}function o(){const e=[];for(let i in s)i!=="Main"&&e.push(...r(i));return e}return{registerPlugin:h,registerPluginGlobally:S,getAllPlugins:o,getPlugins:r,getPlugin:l,togglePlugin:a}}const L=O(A);function J(s){s.forEach(n=>{n.visible&&L.registerPlugin(n,s)})}export{M as L,L as P,J as i,w as u};
