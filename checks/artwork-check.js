(async()=>{const assert=(condition,message)=>{if(!condition)throw new Error(message);};const wrap=s=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${s}</svg>`;
const separate=Artwork.svg(wrap('<path fill="none" stroke="black" d="M0 0 L10 10 M30 30 L40 40"/>'));
assert(separate.length===2,'Disconnected SVG strokes must not join');assert(separate.every(s=>s.length===2),'Straight line coordinates');
const transformed=Artwork.svg(wrap('<g transform="translate(7,9) scale(2,3)"><rect x="0" y="0" width="10" height="10" fill="none" stroke="black"/></g>'));
const b=Artwork.bounds(transformed);assert(Math.abs(b.width-1)<.001&&Math.abs(b.height-1.5)<.001,'SVG transform aspect ratio');assert(transformed[0].length===5,'Closed rectangle preserved');
const curves=Artwork.svg(wrap('<path d="M0 0 Q10 40 40 20 C80 0 90 90 100 50" fill="none" stroke="black"/>'));assert(curves[0].length>10,'Curves flattened');
const hidden=Artwork.svg(wrap('<path display="none" d="M0 0 L100 100"/><rect x="20" y="20" width="10" height="20"/>'));assert(hidden.length===1,'Hidden shapes omitted');
for(const source of ['<script>alert(1)</script>','<text>hello</text>','<image href="https://example.com/x"/>','<path clip-path="url(#x)" d="M0 0L10 10"/>']){let failed=false;try{Artwork.svg(wrap(source));}catch{failed=true;}assert(failed,'Unsupported content rejected');}
const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,80,80);ctx.fillStyle='black';ctx.fillRect(20,20,40,40);const raster=await Artwork.raster(canvas.toDataURL(),150);const rb=Artwork.bounds(raster);assert(raster.length>=1&&Math.abs(rb.width/rb.height-1)<.05,'Raster outline trace');
window.testResult({ok:true,message:'PASS: SVG transforms, subpaths, closed shapes, curves, hidden shapes, unsafe/unsupported content, PNG outline tracing.'});
})().catch(e=>window.testResult({ok:false,message:e.stack}));
