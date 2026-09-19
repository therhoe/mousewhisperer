// Loopback-only visual QA of the actual component, using synthetic session data.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.SNAPSHOT_PREVIEW_PORT || 4186);
const bundle = await build({
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"development"' },
  stdin: {
    resolveDir: root,
    loader: "tsx",
    contents: `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { AppProvider, Checkbox } from '@shopify/polaris';
    import i18n from '@shopify/polaris/locales/en.json';
    import { EngagementOutcomesView } from './app/components/EngagementOutcomes';
    import { buildEngagementOutcomes } from './app/utils/click-engagement';
    const rows = Array.from({length:24}, (_,i) => ({sessionId:'session-'+i, addedToCart:i<8, converted:i<3, ctaClicks:JSON.stringify([
      ...Array.from({length:i<8?2:1},()=>({label:'Play video',tag:'button'})),
      ...(i<12?[{label:'Add to cart',tag:'button'}]:[]),
      ...(i<10?[{label:'Download our size guide',tag:'a',href:'/pages/sizing'}]:[]),
      ...Array.from({length:6},(_,n)=>({label:'Product option '+(n+1),tag:'button'})),
      ...Array.from({length:7},(_,n)=>({label:'Product image '+(n+1),tag:'img',href:'http://127.0.0.1:${port}/product-'+n+'.svg'}))
    ])}));
    function Preview(){const[show,setShow]=useState(false);return <main style={{maxWidth:1400,margin:'24px auto',padding:'24px',background:'white',borderRadius:16}}><p>Local QA · synthetic data</p><header style={{display:'flex',justifyContent:'space-between',gap:16,marginBottom:24}}><h1>Engagement by Zone</h1><Checkbox label='Show outcomes' checked={show} onChange={setShow}/></header>{show?<EngagementOutcomesView data={buildEngagementOutcomes(rows)} totals={{Button:320,Link:10,Image:168,Widget:0}}/>:<p>Click-only view. Enable Show outcomes to inspect the new component.</p>}</main>}
    createRoot(document.getElementById('root')).render(<AppProvider i18n={i18n}><Preview/></AppProvider>);
  `,
  },
});
const css = readFileSync(
  new URL(
    "../node_modules/@shopify/polaris/build/esm/styles.css",
    import.meta.url,
  ),
);
createServer((request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path.endsWith(".svg")) {
    response.setHeader("Content-Type", "image/svg+xml");
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="155"><rect width="220" height="155" fill="#eef3f8"/><path d="M80 35L55 52L65 75L85 67V120H135V67L155 75L165 52L140 35Z" fill="#397ac3"/></svg>',
    );
    return;
  }
  response.setHeader(
    "Content-Type",
    path === "/qa.js"
      ? "text/javascript"
      : path === "/qa.css"
        ? "text/css"
        : "text/html",
  );
  response.end(
    path === "/qa.js"
      ? bundle.outputFiles[0].text
      : path === "/qa.css"
        ? css
        : '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Engagement outcomes QA</title><link rel="stylesheet" href="/qa.css"><div id="root"></div><script type="module" src="/qa.js"></script>',
  );
}).listen(port, "127.0.0.1", () =>
  console.log("Local outcomes QA: http://127.0.0.1:" + port),
);
