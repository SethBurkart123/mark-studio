const {packager}=require('@electron/packager');
const path=require('node:path');
(async()=>{
  const target=process.argv[2]||process.platform;
  const arch=process.argv[3]||(target==='darwin'?'arm64':'x64');
  const results=await packager({dir:__dirname,out:path.join(__dirname,'dist'),name:'Mark Studio',executableName:target==='linux'?'mark-studio':'Mark Studio',platform:target,arch,overwrite:true,prune:true,asar:false,
    icon:path.join(__dirname,'assets',target==='darwin'?'icon.icns':target==='win32'?'icon.ico':'icon.png'),appBundleId:'org.markstudio.app',appCategoryType:'public.app-category.graphics-design',
    ignore:[/^\/dist($|\/)/,/^\/checks($|\/)/,/^\/check\.js$/, /^\/build\.js$/, /^\/docs($|\/)/, /^\/assets\/icon\.iconset/,/^\/assets\/icon\.swift$/, /^\/package-lock\.json$/],
    appCopyright:'Copyright © 2026 Mark Studio contributors',
    extendInfo:{NSHumanReadableCopyright:'Copyright © 2026 Mark Studio contributors',NSHighResolutionCapable:true},
    win32metadata:{CompanyName:'Mark Studio',FileDescription:'Mark Studio — dot-peen artwork and engraving',ProductName:'Mark Studio',OriginalFilename:'Mark Studio.exe'}
  });
  console.log(results.join('\n'));
})().catch(e=>{console.error(e);process.exitCode=1;});
