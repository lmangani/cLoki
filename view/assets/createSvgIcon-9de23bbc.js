import{a as u,d as T}from"./vendor-c662a477.js";import{r as i,d as te,e as ae}from"./react-432945ee.js";import{O as oe,o as p,ac as ne,a8 as se,a7 as re,a9 as ie,a4 as ce,af as le,n as M,m as O,s as v,B as de,r as ue,c as U,b as q,a as P,aj as pe,ak as he,ai as fe}from"./index-82938894.js";import{j as w}from"./reactDnd-707fca38.js";function ge(...e){return e.reduce((t,a)=>a==null?t:function(...n){t.apply(this,n),a.apply(this,n)},()=>{})}function be(e,t=166){let a;function o(...n){const r=()=>{e.apply(this,n)};clearTimeout(a),a=setTimeout(r,t)}return o.clear=()=>{clearTimeout(a)},o}function me(e,t){return()=>null}function we(e,t){var a,o;return i.isValidElement(e)&&t.indexOf((a=e.type.muiName)!=null?a:(o=e.type)==null||(o=o._payload)==null||(o=o.value)==null?void 0:o.muiName)!==-1}function D(e){return e&&e.ownerDocument||document}function ve(e){return D(e).defaultView||window}function Se(e,t){return()=>null}let z=0;function ke(e){const[t,a]=i.useState(e),o=e||t;return i.useEffect(()=>{t==null&&(z+=1,a(`mui-${z}`))},[t]),o}const j=te["useId".toString()];function Ce(e){if(j!==void 0){const t=j();return e??t}return ke(e)}function ye(e,t,a,o,n){return null}function V({controlled:e,default:t,name:a,state:o="value"}){const{current:n}=i.useRef(e!==void 0),[r,h]=i.useState(t),l=n?e:r,f=i.useCallback(m=>{n||h(m)},[]);return[l,f]}const $e={configure:e=>{oe.configure(e)}},xe=Object.freeze(Object.defineProperty({__proto__:null,capitalize:p,createChainedFunction:ge,createSvgIcon:ne,debounce:be,deprecatedPropType:me,isMuiElement:we,ownerDocument:D,ownerWindow:ve,requirePropFactory:Se,setRef:se,unstable_ClassNameGenerator:$e,unstable_useEnhancedEffect:re,unstable_useId:Ce,unsupportedProp:ye,useControlled:V,useEventCallback:ie,useForkRef:ce,useIsFocusVisible:le},Symbol.toStringTag,{value:"Module"})),Ie=i.createContext(void 0),Be=Ie;function Re(){return i.useContext(Be)}function Fe(e){return M("PrivateSwitchBase",e)}O("PrivateSwitchBase",["root","checked","disabled","input","edgeStart","edgeEnd"]);const _e=["autoFocus","checked","checkedIcon","className","defaultChecked","disabled","disableFocusRipple","edge","icon","id","inputProps","inputRef","name","onBlur","onChange","onFocus","readOnly","required","tabIndex","type","value"],Ne=e=>{const{classes:t,checked:a,disabled:o,edge:n}=e,r={root:["root",a&&"checked",o&&"disabled",n&&`edge${p(n)}`],input:["input"]};return q(r,Fe,t)},Pe=v(de)(({ownerState:e})=>u({padding:9,borderRadius:"50%"},e.edge==="start"&&{marginLeft:e.size==="small"?-3:-12},e.edge==="end"&&{marginRight:e.size==="small"?-3:-12})),ze=v("input",{shouldForwardProp:ue})({cursor:"inherit",position:"absolute",opacity:0,width:"100%",height:"100%",top:0,left:0,margin:0,padding:0,zIndex:1}),je=i.forwardRef(function(t,a){const{autoFocus:o,checked:n,checkedIcon:r,className:h,defaultChecked:l,disabled:f,disableFocusRipple:m=!1,edge:g=!1,icon:b,id:k,inputProps:L,inputRef:A,name:G,onBlur:x,onChange:I,onFocus:B,readOnly:W,required:X=!1,tabIndex:H,type:C,value:R}=t,J=T(t,_e),[F,K]=V({controlled:n,default:!!l,name:"SwitchBase",state:"checked"}),d=Re(),Q=c=>{B&&B(c),d&&d.onFocus&&d.onFocus(c)},Y=c=>{x&&x(c),d&&d.onBlur&&d.onBlur(c)},Z=c=>{if(c.nativeEvent.defaultPrevented)return;const N=c.target.checked;K(N),I&&I(c,N)};let S=f;d&&typeof S>"u"&&(S=d.disabled);const ee=C==="checkbox"||C==="radio",y=u({},t,{checked:F,disabled:S,disableFocusRipple:m,edge:g}),_=Ne(y);return w.jsxs(Pe,u({component:"span",className:U(_.root,h),centerRipple:!0,focusRipple:!m,disabled:S,tabIndex:null,role:void 0,onFocus:Q,onBlur:Y,ownerState:y,ref:a},J,{children:[w.jsx(ze,u({autoFocus:o,checked:n,defaultChecked:l,className:_.input,disabled:S,id:ee?k:void 0,name:G,onChange:Z,readOnly:W,ref:A,required:X,ownerState:y,tabIndex:H,type:C},C==="checkbox"&&R===void 0?{}:{value:R},L)),F?r:b]}))}),Ee=je;function Te(e){return M("MuiSwitch",e)}const Me=O("MuiSwitch",["root","edgeStart","edgeEnd","switchBase","colorPrimary","colorSecondary","sizeSmall","sizeMedium","checked","disabled","input","thumb","track"]),s=Me,Oe=["className","color","edge","size","sx"],Ue=fe(),qe=e=>{const{classes:t,edge:a,size:o,color:n,checked:r,disabled:h}=e,l={root:["root",a&&`edge${p(a)}`,`size${p(o)}`],switchBase:["switchBase",`color${p(n)}`,r&&"checked",h&&"disabled"],thumb:["thumb"],track:["track"],input:["input"]},f=q(l,Te,t);return u({},t,f)},De=v("span",{name:"MuiSwitch",slot:"Root",overridesResolver:(e,t)=>{const{ownerState:a}=e;return[t.root,a.edge&&t[`edge${p(a.edge)}`],t[`size${p(a.size)}`]]}})({display:"inline-flex",width:34+12*2,height:14+12*2,overflow:"hidden",padding:12,boxSizing:"border-box",position:"relative",flexShrink:0,zIndex:0,verticalAlign:"middle","@media print":{colorAdjust:"exact"},variants:[{props:{edge:"start"},style:{marginLeft:-8}},{props:{edge:"end"},style:{marginRight:-8}},{props:{size:"small"},style:{width:40,height:24,padding:7,[`& .${s.thumb}`]:{width:16,height:16},[`& .${s.switchBase}`]:{padding:4,[`&.${s.checked}`]:{transform:"translateX(16px)"}}}}]}),Ve=v(Ee,{name:"MuiSwitch",slot:"SwitchBase",overridesResolver:(e,t)=>{const{ownerState:a}=e;return[t.switchBase,{[`& .${s.input}`]:t.input},a.color!=="default"&&t[`color${p(a.color)}`]]}})(({theme:e})=>({position:"absolute",top:0,left:0,zIndex:1,color:e.vars?e.vars.palette.Switch.defaultColor:`${e.palette.mode==="light"?e.palette.common.white:e.palette.grey[300]}`,transition:e.transitions.create(["left","transform"],{duration:e.transitions.duration.shortest}),[`&.${s.checked}`]:{transform:"translateX(20px)"},[`&.${s.disabled}`]:{color:e.vars?e.vars.palette.Switch.defaultDisabledColor:`${e.palette.mode==="light"?e.palette.grey[100]:e.palette.grey[600]}`},[`&.${s.checked} + .${s.track}`]:{opacity:.5},[`&.${s.disabled} + .${s.track}`]:{opacity:e.vars?e.vars.opacity.switchTrackDisabled:`${e.palette.mode==="light"?.12:.2}`},[`& .${s.input}`]:{left:"-100%",width:"300%"}}),({theme:e})=>({"&:hover":{backgroundColor:e.vars?`rgba(${e.vars.palette.action.activeChannel} / ${e.vars.palette.action.hoverOpacity})`:P(e.palette.action.active,e.palette.action.hoverOpacity),"@media (hover: none)":{backgroundColor:"transparent"}},variants:[...Object.entries(e.palette).filter(([,t])=>t.main&&t.light).map(([t])=>({props:{color:t},style:{[`&.${s.checked}`]:{color:(e.vars||e).palette[t].main,"&:hover":{backgroundColor:e.vars?`rgba(${e.vars.palette[t].mainChannel} / ${e.vars.palette.action.hoverOpacity})`:P(e.palette[t].main,e.palette.action.hoverOpacity),"@media (hover: none)":{backgroundColor:"transparent"}},[`&.${s.disabled}`]:{color:e.vars?e.vars.palette.Switch[`${t}DisabledColor`]:`${e.palette.mode==="light"?pe(e.palette[t].main,.62):he(e.palette[t].main,.55)}`}},[`&.${s.checked} + .${s.track}`]:{backgroundColor:(e.vars||e).palette[t].main}}}))]})),Le=v("span",{name:"MuiSwitch",slot:"Track",overridesResolver:(e,t)=>t.track})(({theme:e})=>({height:"100%",width:"100%",borderRadius:14/2,zIndex:-1,transition:e.transitions.create(["opacity","background-color"],{duration:e.transitions.duration.shortest}),backgroundColor:e.vars?e.vars.palette.common.onBackground:`${e.palette.mode==="light"?e.palette.common.black:e.palette.common.white}`,opacity:e.vars?e.vars.opacity.switchTrack:`${e.palette.mode==="light"?.38:.3}`})),Ae=v("span",{name:"MuiSwitch",slot:"Thumb",overridesResolver:(e,t)=>t.thumb})(({theme:e})=>({boxShadow:(e.vars||e).shadows[1],backgroundColor:"currentColor",width:20,height:20,borderRadius:"50%"})),Ge=i.forwardRef(function(t,a){const o=Ue({props:t,name:"MuiSwitch"}),{className:n,color:r="primary",edge:h=!1,size:l="medium",sx:f}=o,m=T(o,Oe),g=u({},o,{color:r,edge:h,size:l}),b=qe(g),k=w.jsx(Ae,{className:b.thumb,ownerState:g});return w.jsxs(De,{className:U(b.root,n),sx:f,ownerState:g,children:[w.jsx(Ve,u({type:"checkbox",icon:k,checkedIcon:k,ref:a,ownerState:g},m,{classes:u({},b,{root:b.switchBase})})),w.jsx(Le,{className:b.track,ownerState:g})]})}),Qe=Ge;var $={};const We=ae(xe);var E;function Ye(){return E||(E=1,function(e){"use client";Object.defineProperty(e,"__esModule",{value:!0}),Object.defineProperty(e,"default",{enumerable:!0,get:function(){return t.createSvgIcon}});var t=We}($)),$}export{Qe as S,ve as a,Ee as b,ge as c,be as d,Re as e,V as f,D as o,Ye as r,Ce as u};
