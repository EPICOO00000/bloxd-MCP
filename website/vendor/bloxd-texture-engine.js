/* Block-native palette texture synthesis for Bloxd worlds. */
(function(global){
'use strict'
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t,fade=t=>t*t*t*(t*(t*6-15)+10)
function seedHash(value){let h=2166136261;for(const c of String(value??'1')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function hash3(x,y,z,seed){let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(z|0,1442695041)^seed;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295}
function valueNoise3(x,y,z,seed){const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),tx=fade(x-xi),ty=fade(y-yi),tz=fade(z-zi),v=(dx,dy,dz)=>hash3(xi+dx,yi+dy,zi+dz,seed),x00=mix(v(0,0,0),v(1,0,0),tx),x10=mix(v(0,1,0),v(1,1,0),tx),x01=mix(v(0,0,1),v(1,0,1),tx),x11=mix(v(0,1,1),v(1,1,1),tx);return mix(mix(x00,x10,ty),mix(x01,x11,ty),tz)}
const gradients=[[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]]
function perlin3(x,y,z,seed){const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),xf=x-xi,yf=y-yi,zf=z-zi,u=fade(xf),v=fade(yf),w=fade(zf),dot=(dx,dy,dz)=>{const g=gradients[Math.floor(hash3(xi+dx,yi+dy,zi+dz,seed)*gradients.length)%gradients.length];return g[0]*(xf-dx)+g[1]*(yf-dy)+g[2]*(zf-dz)},x00=mix(dot(0,0,0),dot(1,0,0),u),x10=mix(dot(0,1,0),dot(1,1,0),u),x01=mix(dot(0,0,1),dot(1,0,1),u),x11=mix(dot(0,1,1),dot(1,1,1),u);return clamp(mix(mix(x00,x10,v),mix(x01,x11,v),w)*.5+.5)}
function fbm3(x,y,z,seed,octaves=4,ridged=false){let total=0,amp=.55,freq=1,norm=0;for(let i=0;i<octaves;i++){let n=perlin3(x*freq,y*freq,z*freq,seed+i*1013);if(ridged)n=1-Math.abs(n*2-1);total+=n*amp;norm+=amp;amp*=.5;freq*=2}return total/norm}
function cellular3(x,y,z,seed){const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z);let nearest=Infinity;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){const cx=xi+dx+hash3(xi+dx,yi+dy,zi+dz,seed),cy=yi+dy+hash3(xi+dx,yi+dy,zi+dz,seed+17),cz=zi+dz+hash3(xi+dx,yi+dy,zi+dz,seed+31),d=(x-cx)**2+(y-cy)**2+(z-cz)**2;if(d<nearest)nearest=d}return clamp(Math.sqrt(nearest)/1.2)}
function sample(x,y,z,options={}){const scale=Math.max(.05,Number(options.scale)||6),seed=seedHash(options.seed),nx=x/scale,ny=y/scale,nz=z/scale,mode=options.mode||'fbm';let value
 if(mode==='perlin')value=perlin3(nx,ny,nz,seed)
 else if(mode==='value')value=valueNoise3(nx,ny,nz,seed)
 else if(mode==='ridged')value=fbm3(nx,ny,nz,seed,Math.max(1,Math.min(8,Number(options.octaves)||4)),true)
 else if(mode==='cellular')value=cellular3(nx,ny,nz,seed)
 else if(mode==='random')value=hash3(x,y,z,seed)
 else if(mode==='checker')value=((Math.floor(nx)+Math.floor(ny)+Math.floor(nz))&1)?1:0
 else if(mode==='stripes'){const axis=options.axis||'y',q=axis==='x'?nx:axis==='z'?nz:ny;value=(Math.sin(q*Math.PI*2)+1)/2}
 else if(mode==='gradient'){const axis=options.axis||'y',q=axis==='x'?x:axis==='z'?z:y,min=Number(options.min)||0,max=Number(options.max)||1;value=(q-min)/Math.max(1,max-min)}
 else value=fbm3(nx,ny,nz,seed,Math.max(1,Math.min(8,Number(options.octaves)||4)),false)
 value=clamp((value-.5)*(Number(options.contrast)||1)+.5+(Number(options.bias)||0));return options.invert?1-value:value}
function normalizePalette(input){const out=[];(input||[]).forEach(item=>{const id=Number(typeof item==='object'?item.id:item),weight=Math.max(.01,Number(typeof item==='object'?item.weight:1)||1);if(id>0){const existing=out.find(entry=>entry.id===id);if(existing)existing.weight+=weight;else out.push({id,weight})}});return out}
function pick(palette,value){const items=normalizePalette(palette);if(!items.length)return 0;const total=items.reduce((n,item)=>n+item.weight,0);let cursor=clamp(value)*total;for(const item of items){cursor-=item.weight;if(cursor<=0)return item.id}return items[items.length-1].id}
function generateNearRgb(color,count=6,family='safe',spread=65){const matcher=global.BloxdColorMatcher;if(!matcher)return[];const target=typeof color==='number'?color:parseInt(String(color).replace('#',''),16),targetLab=matcher.rgbToLab(target),candidates=matcher.safeCandidates(family,false).map(block=>({...block,distance:matcher.deltaE(targetLab,block.lab)})).filter(item=>item.distance<=Math.max(1,Number(spread)||65)).sort((a,b)=>a.distance-b.distance),chosen=[];for(const candidate of candidates){if(chosen.length>=Math.max(2,Math.min(32,Number(count)||6)))break;if(chosen.some(item=>matcher.deltaE(item.lab,candidate.lab)<3.5))continue;chosen.push(candidate)}if(chosen.length<2)candidates.slice(0,Math.max(2,count)).forEach(item=>{if(!chosen.some(x=>x.id===item.id))chosen.push(item)});return chosen.slice(0,count).map((item,index)=>({id:item.id,weight:Math.max(.2,1-item.distance/Math.max(20,spread)*.55),name:item.name,hex:item.hex,distance:item.distance,index}))}
function apply(blocks,keys,palette,options={}){const items=normalizePalette(palette);if(!items.length)return{changed:0,counts:new Map()};let changed=0;const counts=new Map(),onlyId=Number(options.onlyId)||0;(keys||blocks.keys()).forEach(key=>{if(!blocks.has(key))return;const current=blocks.get(key);if(onlyId&&current!==onlyId)return;const p=String(key).split(',').map(Number),id=pick(items,sample(p[0],p[1],p[2],options));if(id&&id!==current){blocks.set(key,id);changed++}if(id)counts.set(id,(counts.get(id)||0)+1)});return{changed,counts}}
function surfaceKeys(blocks,source){const set=source?new Set(source):new Set(blocks.keys()),dirs=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],result=[];set.forEach(k=>{if(!blocks.has(k))return;const p=k.split(',').map(Number);if(dirs.some(d=>!blocks.has(`${p[0]+d[0]},${p[1]+d[1]},${p[2]+d[2]}`)))result.push(k)});return result}
const api={seedHash,hash3,valueNoise3,perlin3,fbm3,cellular3,sample,pick,normalizePalette,generateNearRgb,apply,surfaceKeys}
if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.BloxdTextureEngine=api
})(typeof window!=='undefined'?window:globalThis)
