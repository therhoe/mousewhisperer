// Isolated browser fixture for the real component. No Shopify or database writes.
// node scripts/preview-snapshot-setup.mjs -> http://127.0.0.1:4188
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
const result = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {AppProvider,Button,InlineStack} from '@shopify/polaris'; import {ClipboardChecklistIcon} from '@shopify/polaris-icons'; import en from '@shopify/polaris/locales/en.json';
    import {SnapshotSetupGuide} from './app/components/SnapshotSetupGuide';
    function Fixture(){const [visible,setVisible]=React.useState(true);return <><div style={{display:'flex',justifyContent:'flex-end',marginBottom:24}}><InlineStack gap="200" blockAlign="center">{!visible&&<Button icon={ClipboardChecklistIcon} variant="tertiary" accessibilityLabel="Open setup guide" onClick={()=>setVisible(true)}/>}<Button>Whisper · 16/50 snapshots</Button></InlineStack></div><SnapshotSetupGuide shop="shep-dev.myshopify.com" maxTarget={5000} visible={visible} onExit={()=>setVisible(false)}/></>}
    createRoot(document.getElementById('root')).render(<AppProvider i18n={en}><Fixture/></AppProvider>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "fixture-services",
      setup(b) {
        b.onResolve(
          { filter: /^(@remix-run\/react|@shopify\/app-bridge-react)$/ },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents: args.path.includes("app-bridge")
            ? `
      const bridge={app:{extensions:async()=>[{type:'theme_app_extension',activations:[{handle:'tracker',target:'body',status:new URLSearchParams(location.search).get('tracker')==='off'?'available':'active'}]}]},resourcePicker:async()=>[{id:'gid://shopify/Product/1',title:'Sample product',handle:'sample'}]};
      export const useAppBridge=()=>bridge;`
            : `
      import {createElement,useState,useCallback} from 'react';
      export const Link=({to,children,...props})=>createElement('a',{href:to,...props},children);
      export const useRouteLoaderData=()=>({apiKey:'be249e7dc1288f980804d0bf5e40cde0'});
      export function useFetcher(){const [data,setData]=useState(); const [state,setState]=useState('idle');
        const load=useCallback(url=>{setState('loading');setTimeout(()=>{setData(url.includes('/resources/')?{category:url.endsWith('pages')?'pages':'blogs',resources:[{id:'gid://shopify/Page/1',title:'Sample page',handle:'sample'}]}:{tracker:'active'});setState('idle')},80)},[]);
        const submit=useCallback(values=>{setState('submitting');setTimeout(()=>{setData(new URLSearchParams(location.search).has('error')?{error:'Your plan does not have room for both snapshots.'}:{success:true,pageUrl:'#page',snapshotUrl:'#snapshot'});setState('idle')},100);},[]);
        return {data,state,load,submit};}`,
        }));
      },
    },
  ],
});
const css = readFileSync("node_modules/@shopify/polaris/build/esm/styles.css");
createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(result.outputFiles[0].contents);
    return;
  }
  if (req.url === "/polaris.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Snapshot setup — local test</title><link rel="stylesheet" href="/polaris.css"></head><body style="background:#f1f1f1;padding:24px"><main style="max-width:1180px;margin:auto"><h1 style="font-size:24px;margin-bottom:24px">Dashboard</h1><div id="root"></div><p style="color:#616161;margin-top:16px">Local UI test — Shopify responses are simulated; no snapshots are created.</p></main><script src="/fixture.js"></script></body></html>',
  );
}).listen(4188, "127.0.0.1", () =>
  console.log("Snapshot setup fixture: http://127.0.0.1:4188"),
);
