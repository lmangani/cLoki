import{h as p,i as b,d as s,F as x,f as g,j as u,g as m}from"./index-Ckknqq55.js";import{r as d}from"./react-B8DbRJ_3.js";import{L as v}from"./PluginManagerFactory-CvOKlfBO.js";import{r as S,S as P}from"./createSvgIcon-BVGKxwdj.js";import{j}from"./reactDnd-BtpxPq0t.js";import{u as N}from"./vendor-BVYYq__d.js";import"./reactSelect-FVq3QTPV.js";import"./memoize-CbKs8VX_.js";const k=e=>p("max-width:1440px;padding:10px;margin:10px;width:100%;display:-webkit-box;display:-webkit-flex;display:-ms-flexbox;display:flex;-webkit-flex:1;-ms-flex:1;flex:1;overflow-x:hidden;display:flex;flex:1;height:100%;overflow:hidden;max-width:1440px;align-self:center;.plugin-section{padding:4px;font-size:14px;color:",e.contrast,";}",""),E=e=>p("padding:10px;margin:4px;background:",e.shadow,";border:1px solid ",e.accentNeutral,";color:",e.contrast,";display:flex;align-items:flex-start;flex-direction:column;width:350px;border-radius:3px;height:fit-content;.image{display:flex;align-items:center;}.title{font-size:16px;padding:4px;align-self:flex-start;display:flex;align-items:center;width:100%;.plugin-name{flex:1;margin-left:10px;}.switch{display:flex;align-items:center;justify-self:end;}}.text{font-size:12px;padding:4px;line-height:1.5;}.icon{font-size:60px;opacity:0.25;}","");var h={},_=b;Object.defineProperty(h,"__esModule",{value:!0});var w=h.default=void 0,z=_(S()),C=j;w=h.default=(0,z.default)((0,C.jsx)("path",{d:"M10.5 4.5c.28 0 .5.22.5.5v2h6v6h2c.28 0 .5.22.5.5s-.22.5-.5.5h-2v6h-2.12c-.68-1.75-2.39-3-4.38-3s-3.7 1.25-4.38 3H4v-2.12c1.75-.68 3-2.39 3-4.38 0-1.99-1.24-3.7-2.99-4.38L4 7h6V5c0-.28.22-.5.5-.5m0-2C9.12 2.5 8 3.62 8 5H4c-1.1 0-1.99.9-1.99 2v3.8h.29c1.49 0 2.7 1.21 2.7 2.7s-1.21 2.7-2.7 2.7H2V20c0 1.1.9 2 2 2h3.8v-.3c0-1.49 1.21-2.7 2.7-2.7s2.7 1.21 2.7 2.7v.3H17c1.1 0 2-.9 2-2v-4c1.38 0 2.5-1.12 2.5-2.5S20.38 11 19 11V7c0-1.1-.9-2-2-2h-4c0-1.38-1.12-2.5-2.5-2.5"}),"ExtensionOutlined");const M=e=>{const{name:n,active:t,section:l}=e,i=v(),[r,c]=d.useState(t),a=(o,y,f)=>{c(()=>!f),i.togglePlugin(o,y,!f)};return s(x,{children:s(P,{size:"small",checked:r,onChange:()=>a(l,n,r),inputProps:{"aria-label":"controlled"}})})},O=e=>{const{theme:n,name:t,description:l,section:i,active:r,visible:c}=e;return c?s(x,{children:u("div",{className:m(E(n)),children:[u("div",{className:"title",children:[s("div",{className:"image",children:s(w,{className:"icon"})}),u("div",{className:"plugin-name",children:[" ",t]}),s("div",{className:"switch",children:s(M,{active:r,name:t,section:i})})]}),s("div",{className:"text",children:l})]})}):s(x,{})},H=({components:e,section:n})=>{const t=N(a=>a.currentUser.role),l=d.useMemo(()=>e==null?void 0:e.filter(a=>a.roles.includes(t)),[t,e]),[i,r]=d.useState(l);d.useEffect(()=>{if(t&&e){let a=e==null?void 0:e.filter(o=>o.roles.includes(t));r(a)}},[t,e]);const c=g();return s("div",{children:(i==null?void 0:i.length)>0&&(i==null?void 0:i.map((a,o)=>s(O,{theme:c,name:a.name,active:a.active,visible:a.visible,section:n,description:a.description},o)))})};function L(){const e=g(),n=v(),[t]=d.useState(n.getAll()),l=d.useMemo(()=>{var i;return((i=Object.keys(t))==null?void 0:i.length)>0?Object.entries(t):[]},[t]);return s("div",{className:m(k(e)),children:(l==null?void 0:l.length)>0&&(l==null?void 0:l.map(([i,r],c)=>s("div",{style:{marginTop:"4px"},children:s(H,{components:r,section:i})},c)))})}export{L as default};
