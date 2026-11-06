/**
 * block_colors.js — Couleurs des blocs Bloxd, partagées entre les outils.
 * ─────────────────────────────────────────────────────────────────────────
 * Portage fidèle du système de couleurs du Schem Placer (schem_placer.js)
 * afin que l'aperçu 3D du Schem Converter utilise exactement la même palette
 * (bois par espèce, minerais, laines/bétons/verres colorés…).
 *
 * API : BloxdBlockColors.init(nameToIdJson) puis BloxdBlockColors.hex(id)
 *       → entier 0xRRGGBB, ou BloxdBlockColors.rgb(id) → [r,g,b] normalisés.
 *
 * Fichier sans dépendance (ni DOM ni Babylon) : utilisable navigateur + Node.
 */
(function (global) {
'use strict';

const BC_WOOD = {
    Maple:{log:0x8a6339,planks:0xc19a6b,leaves:0x5a9633,sapling:0x5a9633,barkless:0xc19a6b},
    Pine:{log:0x55463a,planks:0x8d7350,leaves:0x2d5c2c,sapling:0x3a7a3b,barkless:0x8d7350},
    Plum:{log:0x6a4b36,planks:0xa38264,leaves:0x4d7e39,sapling:0x558a3d,barkless:0xa38264,fruit:0x7a2a4b},
    Cedar:{log:0x5c4835,planks:0x8a6f4d,leaves:0x2e6a2f,sapling:0x3c7a3b,barkless:0x8a6f4d},
    Aspen:{log:0x9a8c76,planks:0xd1c08b,leaves:0x7bb34a,sapling:0x7bb34a,barkless:0xd1c08b},
    Elm:{log:0x7a5a3c,planks:0xa38054,leaves:0x48893a,sapling:0x48893a,barkless:0xa38054},
    Cherry:{log:0xb49070,planks:0xe0baa6,leaves:0x8e3a4f,sapling:0x8e3a4f,barkless:0xe0baa6},
    Palm:{log:0x786044,planks:0x9d835b,leaves:0x40893c,sapling:0x40893c,barkless:0x9d835b,coconut:0x6b4a2c},
    Pear:{log:0x765c42,planks:0xa78765,leaves:0x4e8d3d,sapling:0x4e8d3d,barkless:0xa78765,fruit:0x9cb74a},
};
const BC_METAL = {
    Stone:0x808080,'Smooth Stone':0x9a9a9a,Diorite:0xdcdcdc,Andesite:0x86847f,Granite:0x9b7c71,
    Sandstone:0xddc98a,Yellowstone:0xc3b070,Obsidian:0x140d23,Bedrock:0x2f2f34,Cobblestone:0x757575,
    Mossy:0x6b7a54,Cracked:0x777777,Bricks:0x934b42,'Stone Bricks':0x7f7f79,'Dark Red Brick':0x602924,
    'Dark Red Stone':0x5a2222,Coal:0x262628,Iron:0xd4d4d4,Gold:0xf3d04a,'Lapis Lazuli':0x2a4fa0,
    Emerald:0x3dd06b,Diamond:0x63d8e8,Quartz:0xf4efe4,Moonstone:0x8ab8e0,Magma:0xff6a1f,
    Water:0x2a7bc0,Ice:0xa8d6ee,Snow:0xf5f9fc,Glass:0xcfe8f5,Sponge:0xd6b751,Beacon:0xd8f1ff,
    Hay:0xc8a841,Cactus:0x3f803a,Grass:0x5aa03a,Dirt:0x6e4b2a,Sand:0xe6d797,Clay:0xa2aaa8,
    Gravel:0x888888,Chalk:0xf8f8f0,Lava:0xff5522,Redstone:0xaa1c1c,
};
const BC_HUE = {
    White:0xf2f2f2, Orange:0xea7e35, Magenta:0xc74ebd, 'Light Blue':0x6387d2,
    Yellow:0xb8a93a, Lime:0x72b828, Pink:0xe88da2, Gray:0x6a6a6a, 'Light Gray':0xa0a0a0,
    Cyan:0x6099a8, Purple:0x804dba, Blue:0x3c54ad, Brown:0x7b5536, Green:0x4d8a33,
    Red:0xa03333, Black:0x1b1b20, Maroon:0x6b1e1e, Teal:0x2f7f87, Indigo:0x3b3b8c,
    Gold:0xf2c94c, Bronze:0xa57a3f, Copper:0xc47d4a, Beige:0xd9c99a, Cream:0xf1e9ca, Silver:0xccccd6,
};
const BC_MAT = {
    wool:[1,1,1], concrete:[0.88,0.88,0.88], planks:[0.82,0.70,0.50],
    'baked clay':[0.85,0.78,0.70], clay:[0.95,0.95,0.95], glass:[1,1,1],
    ceramic:[0.95,0.95,1], tile:[0.92,0.92,0.95],
};
const BC_FLOWER_BY_COLOR = {
    red:0xd93c3c, orange:0xe27d2e, yellow:0xeacb3d, lime:0x83c92c, green:0x3e9030,
    cyan:0x3fb8b3, 'light blue':0x5aaee0, blue:0x3e5bc4, purple:0x8b4fc8, magenta:0xc54fb6,
    pink:0xea8ba6, white:0xf5f5f5, gray:0x8a8a8a, 'light gray':0xbfbfbf, black:0x202028, brown:0x8a5f3a,
};

function _bcHexToRgb(h){return[(h>>16)&255,(h>>8)&255,h&255];}
function _bcClamp(v){return Math.max(0,Math.min(255,Math.round(v)));}
function _bcRgbToHex(r,g,b){return((_bcClamp(r)<<16)|(_bcClamp(g)<<8)|_bcClamp(b))>>>0;}
function _bcMultiply(h,f){const[r,g,b]=_bcHexToRgb(h);const[fr,fg,fb]=typeof f==='number'?[f,f,f]:f;return _bcRgbToHex(r*fr,g*fg,b*fb);}
function _bcMix(h1,h2,t){const a=_bcHexToRgb(h1),b=_bcHexToRgb(h2);return _bcRgbToHex(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t);}
function _bcColored(hueName,material){let base=BC_HUE[hueName]!==undefined?BC_HUE[hueName]:0x909090;if(material){if(material==='planks')base=_bcMix(base,0x7a5a3a,0.55);else if(material==='baked clay')base=_bcMix(base,0x9b6f50,0.35);else{const adj=BC_MAT[material];if(adj)base=_bcMultiply(base,adj);}}return base;}
function _bcFindHue(n){
    if(/\blight blue\b/.test(n))return'Light Blue';if(/\blight gray\b/.test(n))return'Light Gray';
    if(/\bwhite\b/.test(n))return'White';if(/\borange\b/.test(n))return'Orange';if(/\bmagenta\b/.test(n))return'Magenta';
    if(/\byellow\b/.test(n))return'Yellow';if(/\blime\b/.test(n))return'Lime';if(/\bpink\b/.test(n))return'Pink';
    if(/\bgray\b/.test(n))return'Gray';if(/\bcyan\b/.test(n))return'Cyan';if(/\bpurple\b/.test(n))return'Purple';
    if(/\bblue\b/.test(n))return'Blue';if(/\bbrown\b/.test(n))return'Brown';if(/\bgreen\b/.test(n))return'Green';
    if(/\bred\b/.test(n))return'Red';if(/\bblack\b/.test(n))return'Black';return null;
}
function _bcWood(n){for(const k of Object.keys(BC_WOOD)){if(new RegExp('\\b'+k.toLowerCase()+'\\b').test(n))return BC_WOOD[k];}return null;}
function _bcFallbackColor(name){
    const l=name.toLowerCase();
    if(/^air\b|\bair\b/.test(l)&&!/plane/.test(l))return 0x000000;
    if(/unloaded|placeholder|unused|invisible|ghost/i.test(l))return 0x20202a;
    const w=_bcWood(l);
    if(w){if(/\blog\b/.test(l))return w.log;if(/barkless/.test(l))return w.barkless;if(/\bplanks?\b/.test(l))return w.planks;if(/\bleaves?\b|canopy|hedge/.test(l))return w.leaves;if(/sapling/.test(l))return w.sapling;if(/door|trapdoor|ladder|fence|gate|stairs|slab|button|plate|sign/.test(l))return _bcMultiply(w.planks,0.92);if(/coconut/.test(l))return w.coconut||0x6b4a2c;return w.log;}
    if(/dandelion/.test(l))return 0xfde04c;
    if(/poppy|tulip|daisy|bluebell|allium|bluet|lily|rose|flower/.test(l)){const h=_bcFindHue(l);if(h&&BC_FLOWER_BY_COLOR[h.toLowerCase()])return BC_FLOWER_BY_COLOR[h.toLowerCase()];if(/poppy|rose|red/.test(l))return 0xd83030;if(/tulip|pink/.test(l))return 0xe85a7a;if(/daisy|white/.test(l))return 0xf2f2f2;if(/bluebell|blue/.test(l))return 0x4461d6;if(/allium|purple/.test(l))return 0x9c63c8;return 0xff76a6;}
    if(/sapling|vine|leaves|hedge|bush|grass/.test(l))return 0x3f8a37;
    if(/cactus/.test(l))return 0x3e8139;if(/pumpkin|jack/.test(l))return 0xd07a1f;if(/watermelon|melon/.test(l))return 0x3c9a3e;
    if(/smooth stone/.test(l))return BC_METAL['Smooth Stone'];if(/stone brick/.test(l))return BC_METAL['Stone Bricks'];
    if(/dark red brick/.test(l))return BC_METAL['Dark Red Brick'];if(/dark red stone/.test(l))return BC_METAL['Dark Red Stone'];
    if(/cobble|rocky/.test(l))return BC_METAL.Cobblestone;if(/mossy/.test(l))return BC_METAL.Mossy;if(/cracked/.test(l))return BC_METAL.Cracked;
    if(/diorite/.test(l))return BC_METAL.Diorite;if(/andesite/.test(l))return BC_METAL.Andesite;if(/granite/.test(l))return BC_METAL.Granite;
    if(/sandstone/.test(l))return BC_METAL.Sandstone;if(/yellowstone/.test(l))return BC_METAL.Yellowstone;if(/obsidian|obby/.test(l))return BC_METAL.Obsidian;
    if(/bedrock/.test(l))return BC_METAL.Bedrock;if(/brick/.test(l))return BC_METAL.Bricks;if(/stone/.test(l))return BC_METAL.Stone;
    if(/engraved|marked|patterned|chiseled/.test(l))return _bcMultiply(BC_METAL['Smooth Stone'],0.95);
    if(/lapis/.test(l))return BC_METAL['Lapis Lazuli'];if(/emerald/.test(l))return BC_METAL.Emerald;if(/diamond/.test(l))return BC_METAL.Diamond;
    if(/redstone/.test(l))return BC_METAL.Redstone;if(/coal/.test(l))return BC_METAL.Coal;if(/gold/.test(l))return BC_METAL.Gold;if(/iron/.test(l))return BC_METAL.Iron;
    if(/moonstone/.test(l))return BC_METAL.Moonstone;if(/quartz/.test(l))return BC_METAL.Quartz;if(/magma|lava|volcano/.test(l))return BC_METAL.Magma;
    if(/water/.test(l))return BC_METAL.Water;if(/ice/.test(l))return BC_METAL.Ice;if(/snow|packed/.test(l))return BC_METAL.Snow;
    if(/glass|pane/.test(l))return BC_METAL.Glass;if(/sponge/.test(l))return BC_METAL.Sponge;if(/beacon/.test(l))return BC_METAL.Beacon;
    if(/hay|straw|wheat|corn|rice|cotton|cranberr/.test(l))return 0xc3a041;if(/tilled|farmland|dirt|mud/.test(l))return BC_METAL.Dirt;
    if(/red sand/.test(l))return 0xc55c3e;if(/sand|beach/.test(l))return BC_METAL.Sand;if(/clay/.test(l))return BC_METAL.Clay;if(/gravel|pebble/.test(l))return BC_METAL.Gravel;if(/chalk/.test(l))return 0xf5f5ef;
    if(/lamp.*on|torch|glowstone|lantern|lit/.test(l))return 0xffd672;if(/lamp.*off/.test(l))return 0x806d40;
    if(/furnace/.test(l))return 0x4a4a4a;if(/workbench|artisan/.test(l))return 0x8a5f3a;if(/chest|loot|crate/.test(l))return 0x9a6b3a;if(/protector/.test(l))return 0x6352ff;if(/bookshelf|book/.test(l))return 0x8e5d32;
    const hue=_bcFindHue(l);const mat=/\bwool\b/.test(l)?'wool':/\bconcrete\b/.test(l)?'concrete':/\bplanks?\b/.test(l)?'planks':/\bbaked clay\b|\bterracotta\b/.test(l)?'baked clay':/\b(glass|pane)\b/.test(l)?'glass':/\bceramic\b/.test(l)?'ceramic':/\btile/.test(l)?'tile':null;
    if(hue)return _bcColored(hue,mat);
    if(mat==='planks')return 0xa0794b;if(mat==='baked clay')return 0xa0664b;
    let h=(name.length*2654435761^(name.charCodeAt(0)||0)*2246822519)>>>0;
    return _bcRgbToHex(60+((h>>16)&127),60+((h>>8)&127),60+(h&127));
}
const BC_EXPLICIT = {
    0:0x000000,1:0x1a1a22,2:BC_METAL.Dirt,3:_bcMultiply(BC_METAL.Dirt,0.92),4:0x4da64d,5:BC_METAL.Sand,6:BC_METAL.Clay,7:BC_METAL.Gravel,8:BC_METAL.Snow,
    28:BC_METAL.Stone,29:_bcMultiply(BC_METAL.Stone,0.88),31:BC_METAL['Smooth Stone'],32:BC_METAL.Diorite,33:_bcMultiply(BC_METAL.Diorite,0.98),
    34:BC_METAL.Andesite,35:_bcMultiply(BC_METAL.Andesite,0.97),36:BC_METAL.Granite,37:_bcMultiply(BC_METAL.Granite,0.98),38:BC_METAL.Sandstone,39:BC_METAL.Yellowstone,
    40:0x2e2e32,41:0x96938f,42:0x9e8e6a,43:0x4b638b,44:0x4f7c56,45:0x788f94,46:BC_METAL.Coal,47:BC_METAL.Iron,48:BC_METAL.Gold,49:BC_METAL['Lapis Lazuli'],50:BC_METAL.Emerald,
    126:BC_METAL.Water,127:0x3a3a44,128:BC_METAL.Bricks,129:BC_METAL['Stone Bricks'],130:BC_METAL['Dark Red Brick'],131:BC_METAL['Dark Red Stone'],
    132:BC_METAL.Quartz,133:_bcMultiply(BC_METAL.Quartz,0.95),134:_bcMultiply(BC_METAL['Smooth Stone'],0.97),135:BC_METAL.Mossy,136:BC_METAL.Cracked,
    137:_bcMultiply(BC_METAL.Sandstone,1.02),138:BC_METAL.Sandstone,139:BC_METAL.Ice,140:BC_METAL.Obsidian,141:BC_METAL.Hay,142:BC_METAL.Sponge,143:BC_METAL.Beacon,
    145:BC_METAL.Gold,146:BC_METAL.Moonstone,147:BC_METAL.Bedrock,149:BC_METAL.Cactus,150:0x5aa03a,223:_bcMultiply(BC_METAL.Dirt,0.95),471:BC_METAL.Magma,475:_bcMultiply(BC_METAL.Sandstone,0.90),650:0xc35a3c,1222:BC_WOOD.Cherry.log,
};
(function(){
    const W=['White','Orange','Magenta','Light Blue','Yellow','Lime','Pink','Gray','Light Gray','Cyan','Purple','Blue','Brown','Green','Red','Black'];
    const CONC=['Gray','Light Gray','Black','Blue','Brown','Cyan','Light Blue','Lime','Magenta','Orange','Pink','Purple','Red','White','Green','Yellow'];
    const GLASS=['Black','Blue','Brown','Cyan','Gray','Light Gray','Green','Light Blue','Lime','Magenta','Orange','Pink','Purple','Red','White','Yellow'];
    let id;
    id=51;W.forEach(h=>{BC_EXPLICIT[id++]=_bcColored(h,'wool');});
    BC_EXPLICIT[67]=0xa0664b;id=68;W.forEach(h=>{BC_EXPLICIT[id++]=_bcColored(h,'baked clay');});
    id=84;CONC.forEach(h=>{BC_EXPLICIT[id++]=_bcColored(h,'concrete');});
    BC_EXPLICIT[100]=BC_WOOD.Pine.leaves;BC_EXPLICIT[101]=BC_WOOD.Aspen.leaves;BC_EXPLICIT[102]=BC_WOOD.Maple.leaves;BC_EXPLICIT[103]=BC_WOOD.Elm.leaves;
    BC_EXPLICIT[106]=BC_METAL.Glass;id=107;GLASS.forEach(h=>{BC_EXPLICIT[id++]=_bcMultiply(_bcColored(h,'glass'),0.85);});
    BC_EXPLICIT[123]=0xff00ff;BC_EXPLICIT[124]=0xffe680;BC_EXPLICIT[125]=0xc8a74c;
    id=228;W.forEach(h=>{BC_EXPLICIT[id++]=_bcColored(h,'planks');});
    id=245;for(let r=0;r<4;r++){W.forEach(h=>{BC_EXPLICIT[id++]=_bcColored(h,'ceramic');});}
})();

let BC_ID_TO_NAME={};const BC_CACHE={};
function init(nameToId){
    BC_ID_TO_NAME={};
    if(nameToId)for(const n in nameToId){const i=nameToId[n];if(BC_ID_TO_NAME[i]===undefined)BC_ID_TO_NAME[i]=n;}
    // espèces de bois par nom (comme schem_placer.initBlockNameMap)
    if(nameToId)for(const wname in BC_WOOD){const p=BC_WOOD[wname];
        const L=wname+' Log',P=wname+' Wood Planks',LV=wname+' Leaves',S=wname+' Sapling',B='Barkless '+wname+' Log';
        if(nameToId[L]!==undefined)BC_EXPLICIT[nameToId[L]]=p.log;
        if(nameToId[P]!==undefined)BC_EXPLICIT[nameToId[P]]=p.planks;
        if(nameToId[LV]!==undefined)BC_EXPLICIT[nameToId[LV]]=p.leaves;
        if(nameToId[S]!==undefined)BC_EXPLICIT[nameToId[S]]=p.sapling;
        if(nameToId[B]!==undefined)BC_EXPLICIT[nameToId[B]]=p.barkless;
    }
    for(const k in BC_CACHE)delete BC_CACHE[k];
}
function blockColorHex(id){
    if(BC_EXPLICIT[id]!==undefined)return BC_EXPLICIT[id];
    if(BC_CACHE[id]!==undefined)return BC_CACHE[id];
    let c;
    const name=BC_ID_TO_NAME[id];
    if(name)c=_bcFallbackColor(name);
    else{let h=(id*2654435761)>>>0;c=_bcRgbToHex(60+((h>>16)&127),60+((h>>8)&127),60+(h&127));}
    BC_CACHE[id]=c;return c;
}
function blockColorRGB(id){
    const h=blockColorHex(id);
    return [((h>>16)&255)/255,((h>>8)&255)/255,(h&255)/255];
}

const API = { init, hex: blockColorHex, rgb: blockColorRGB, WOOD: BC_WOOD, METAL: BC_METAL };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
global.BloxdBlockColors = API;

})(typeof window !== 'undefined' ? window : globalThis);
