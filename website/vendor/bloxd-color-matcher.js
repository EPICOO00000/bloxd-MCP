/* Perceptual, texture-aware material matching to safe placeable Bloxd block IDs. */
(function (global) {
  'use strict'
  const cache = new Map()
  const textureCache = new WeakMap()
  const excluded = /\|meta\||spawn orb|bow|sword|pickaxe|axe|shovel|hoe|shears|helmet|chestplate|leggings|boots|potion|ball|bomb|gun|arrow|key|coin|book|bucket|boat|glider|hang glider|name tag|map$|compass|bread|apple|pear|plum|coconut|melon slice|cookie|iceball|fireball|moonstone orb|protector|charge|charging|projectile|unloaded|air$/i
  const families = {
    natural: /dirt|grass block|sand$|clay$|gravel|snow$|stone$|granite|diorite|andesite|sandstone|cobblestone|log$|wood planks|leaves$|ice$|obsidian|bedrock/i,
    concrete: /concrete$/i,
    wool: /wool$/i,
    glass: /glass$/i,
    wood: /wood planks$|log$|barkless/i,
    colored: /wool$|concrete$|glass$|baked clay|ceramic|tile/i,
    safe: /block$|stone$|dirt$|sand$|clay$|gravel$|snow$|planks$|log$|leaves$|wool$|concrete$|glass$|bricks$|sandstone$|obsidian$|bedrock$|quartz$|ore$|ice$|hay$|cactus$/i
  }
  function srgbLinear(value) { value /= 255; return value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4) }
  function rgbToLab(hex) {
    const r=srgbLinear((hex>>16)&255),g=srgbLinear((hex>>8)&255),b=srgbLinear(hex&255)
    let x=(r*.4124+g*.3576+b*.1805)/.95047,y=(r*.2126+g*.7152+b*.0722),z=(r*.0193+g*.1192+b*.9505)/1.08883
    const f=v=>v>.008856?Math.cbrt(v):(7.787*v+16/116);x=f(x);y=f(y);z=f(z)
    return [116*y-16,500*(x-y),200*(y-z)]
  }
  function deltaE(a,b){const dl=a[0]-b[0],da=a[1]-b[1],db=a[2]-b[2];return Math.sqrt(dl*dl+da*da+db*db)}
  function safeCandidates(family='safe', transparent=false) {
    const cacheKey=`${family}:${transparent}`;if(cache.has(cacheKey))return cache.get(cacheKey)
    let matcher=families[family]||families.safe
    const result=[]
    Object.entries(global.BLOXD_NAME_TO_ID||{}).forEach(([name,id])=>{
      if(!id||excluded.test(name))return
      if(transparent&&!/glass|ice/i.test(name))return
      if(!transparent&&!matcher.test(name))return
      const hex=global.BloxdBlockColors.hex(id);result.push({id:Number(id),name,hex,lab:rgbToLab(hex)})
    })
    if(!result.length)return safeCandidates('safe',false)
    cache.set(cacheKey,result);return result
  }
  function targetHueName(hex){const r=((hex>>16)&255)/255,g=((hex>>8)&255)/255,b=(hex&255)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(d<.14)return null;let h;if(max===r)h=60*(((g-b)/d)%6);else if(max===g)h=60*((b-r)/d+2);else h=60*((r-g)/d+4);if(h<0)h+=360;if(h<15||h>=345)return'red';if(h<45)return'orange';if(h<72)return'yellow';if(h<165)return'green';if(h<200)return'cyan';if(h<255)return'blue';if(h<292)return'purple';return'magenta'}
  const hueWords=['red','orange','yellow','lime','green','cyan','light blue','blue','purple','magenta','pink','brown','black','gray','white']
  function nearest(hex, options={}) {
    const alpha=options.alpha==null?1:options.alpha,family=options.family||'safe',transparent=alpha<.72||options.transparent
    const target=rgbToLab(hex),targetHue=targetHueName(hex),list=safeCandidates(transparent?'glass':family,transparent),ranked=list.map(block=>{let distance=deltaE(target,block.lab);const name=block.name.toLowerCase(),namedHue=hueWords.find(word=>name.includes(word));if(targetHue&&namedHue){const compatible=namedHue===targetHue||(targetHue==='red'&&namedHue==='pink')||(targetHue==='green'&&namedHue==='lime')||(targetHue==='blue'&&namedHue==='light blue');if(!compatible)distance+=24}return{...block,distance}}).sort((a,b)=>a.distance-b.distance)
    return {best:ranked[0],second:ranked[1]||ranked[0],ranked:ranked.slice(0,8)}
  }
  function multiplyHex(a,b){return (((((a>>16)&255)*((b>>16)&255)/255)&255)<<16)|(((((a>>8)&255)*((b>>8)&255)/255)&255)<<8)|((((a&255)*(b&255)/255)&255))}
  function textureAverage(texture) {
    if(!texture||!texture.image||typeof document==='undefined')return null
    if(textureCache.has(texture))return textureCache.get(texture)
    try{
      const image=texture.image,canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,16,16);const data=ctx.getImageData(0,0,16,16).data;let r=0,g=0,b=0,w=0
      for(let i=0;i<data.length;i+=4){const a=data[i+3]/255;r+=data[i]*a;g+=data[i+1]*a;b+=data[i+2]*a;w+=a}const result=w?((Math.round(r/w)<<16)|(Math.round(g/w)<<8)|Math.round(b/w)):null;textureCache.set(texture,result);return result
    }catch(error){textureCache.set(texture,null);return null}
  }
  function materialColor(material, geometry, triangleIndex, options={}) {
    let hex=material&&material.color?material.color.getHex():0x808080
    if(options.textures!==false&&material&&material.map){const tex=textureAverage(material.map);if(tex!=null)hex=multiplyHex(hex,tex)}
    if(geometry&&geometry.getAttribute){const colors=geometry.getAttribute('color');if(colors){const start=triangleIndex*3;let r=0,g=0,b=0;for(let i=0;i<3;i++){r+=colors.getX(start+i);g+=colors.getY(start+i);b+=colors.getZ(start+i)}const vertex=(Math.round(Math.min(1,r/3)*255)<<16)|(Math.round(Math.min(1,g/3)*255)<<8)|Math.round(Math.min(1,b/3)*255);hex=multiplyHex(hex,vertex)}}
    const alpha=material&&material.transparent?material.opacity:1
    return {hex,alpha}
  }
  function choose(hex,x,y,z,options={}){const result=nearest(hex,options);if(!options.dither)return result.best.id;const total=result.best.distance+result.second.distance||1,secondChance=result.best.distance/total,hash=Math.abs((x*73856093)^(y*19349663)^(z*83492791))%1000/1000;return hash<secondChance?result.second.id:result.best.id}
  global.BloxdColorMatcher={rgbToLab,deltaE,safeCandidates,nearest,textureAverage,materialColor,choose,families}
  if(typeof module!=='undefined'&&module.exports)module.exports=global.BloxdColorMatcher
})(typeof window!=='undefined'?window:globalThis)
