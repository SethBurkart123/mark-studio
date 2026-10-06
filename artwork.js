'use strict';
// Imported SVGs are rebuilt from geometry only; scripts, URLs and effects never enter the document.
window.Artwork = (() => {
  const allowed = new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','use','symbol','title','desc']);
  const attributes = new Set(['id','x','y','x1','y1','x2','y2','width','height','rx','ry','cx','cy','r','d','points','transform','viewBox','preserveAspectRatio','fill','fill-rule','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','display','visibility']);
  const ns = 'http://www.w3.org/2000/svg';
  const scope = new paper.PaperScope(); scope.setup(document.createElement('canvas'));
  function bounds(strokes) {
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,count=0;
    for(const stroke of strokes)for(const [x,y] of stroke){if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Artwork contains invalid coordinates.');minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);if(++count>100000)throw new Error('Too much detail. Simplify the image or SVG.');}
    if(!count||maxX-minX<0.00001||maxY-minY<0.00001)throw new Error('Artwork needs visible width and height.');
    return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY,count};
  }
  function normalize(strokes) { const b=bounds(strokes);return strokes.map(s=>s.map(([x,y])=>[(x-b.minX)/b.width,(y-b.minY)/b.width])); }
  function svg(source) {
    if(source.length>8*1024*1024)throw new Error('SVG is larger than 8 MB.');
    if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('SVG document entities are not supported. Export a plain SVG.');
    const parsed=new DOMParser().parseFromString(source,'image/svg+xml');
    if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg')throw new Error('This file is not a valid SVG.');
    if(parsed.querySelectorAll('*').length>15000)throw new Error('SVG has too many elements. Simplify it first.');
    function clean(node,depth=0){
      if(depth>60)throw new Error('SVG groups are nested too deeply.');
      const name=node.localName;
      if(['style','metadata','namedview'].includes(name))return null;
      if(!allowed.has(name))throw new Error(`SVG ${name} is not supported. Convert text to paths, and flatten masks or effects before exporting.`);
      if(node.hasAttribute('clip-path')||node.hasAttribute('mask')||node.hasAttribute('filter'))throw new Error('Flatten clipping, masks and effects before importing.');
      const result=document.createElementNS(ns,name);
      for(const attr of node.attributes){
        if(attr.name==='style'){
          const style=node.getAttribute('style');
          if(/url\s*\(|clip-path|mask:|filter:/i.test(style))throw new Error('SVG effects must be flattened first.');
          for(const declaration of style.split(';')){const split=declaration.indexOf(':');if(split<0)continue;const key=declaration.slice(0,split).trim(),value=declaration.slice(split+1).trim();if(attributes.has(key))result.setAttribute(key,value);}
        }else if(attr.localName==='href'){
          if(!/^#[\w.-]+$/.test(attr.value))throw new Error('External SVG references are not supported.');
          result.setAttribute('href',attr.value);result.setAttributeNS('http://www.w3.org/1999/xlink','xlink:href',attr.value);
        }else if(attributes.has(attr.name)){
          if(/url\s*\(/i.test(attr.value))throw new Error('Convert gradient artwork into simple paths.');
          result.setAttribute(attr.name,attr.value);
        }
      }
      if(name==='title'||name==='desc')return null;
      for(const child of node.children){const c=clean(child,depth+1);if(c)result.append(c);}
      return result;
    }
    // Circular <use> references can recurse inside SVG libraries.
    if(parsed.querySelector('use'))throw new Error('Expand SVG clones / symbols before importing (object to path).');
    if(parsed.querySelector('style'))throw new Error('SVG stylesheet detected. Export with presentation attributes or inline styles so hidden lines are preserved.');
    const safe=clean(parsed.documentElement);scope.project.clear();
    let root;
    try{
      root=scope.project.importSVG(new XMLSerializer().serializeToString(safe),{expandShapes:true,insert:false,applyMatrix:true});
      if(!root||root.bounds.width===0||root.bounds.height===0)throw new Error('SVG contains no visible artwork.');
      root.scale(100/Math.max(root.bounds.width,root.bounds.height));
      const paths=[];
      function walk(item){
        if(!item.visible||item.opacity===0)return;
        if(item.className==='Path'){
          if(item.segments.length<2)return;
          const fill=item.fillColor&&item.fillColor.alpha>0;const stroke=item.strokeColor&&item.strokeColor.alpha>0;
          if(!fill&&!stroke)return;
          const flat=item.clone({insert:false});flat.flatten(0.06);
          const points=flat.segments.map(s=>{const p=item.localToGlobal(s.point);return [p.x,-p.y];});
          if(flat.closed&&points.length)points.push([...points[0]]);flat.remove();
          if(points.length>1)paths.push(points);
        }else if(item.children){for(const child of item.children)walk(child);}
      }
      walk(root);return normalize(paths);
    }finally{root?.remove();scope.project.clear();}
  }
  async function raster(dataUrl,threshold=150){
    const image=new Image();image.src=dataUrl;await image.decode();
    if(image.naturalWidth*image.naturalHeight>30000000)throw new Error('Image is too large. Resize it below 30 megapixels.');
    const scale=Math.min(1,900/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<pixels.data.length;i+=4){const v=(pixels.data[i]*.2126+pixels.data[i+1]*.7152+pixels.data[i+2]*.0722)<threshold?0:255;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;pixels.data[i+3]=255;}
    const traced=ImageTracer.imagedataToTracedata(pixels,{numberofcolors:2,colorsampling:0,pal:[{r:0,g:0,b:0,a:255},{r:255,g:255,b:255,a:255}],pathomit:8,ltres:1,qtres:1});
    traced.layers.forEach((layer,i)=>{if(traced.palette[i].r>128)traced.layers[i]=[];});
    return svg(ImageTracer.getsvgstring(traced,{scale:1,roundcoords:2,viewbox:true,desc:false}));
  }
  return {svg,raster,bounds,normalize};
})();
