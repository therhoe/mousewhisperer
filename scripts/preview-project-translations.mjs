// Local-only browser fixture: real UI components, simulated analytics, no Shopify/DB writes.
// Run: node scripts/preview-project-translations.mjs; open http://127.0.0.1:4190/?locale=de
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
const result = await build({
  stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {AppProvider,Button,Page} from '@shopify/polaris';
      import en from '@shopify/polaris/locales/en.json'; import de from '@shopify/polaris/locales/de.json'; import cn from '@shopify/polaris/locales/zh-CN.json'; import tw from '@shopify/polaris/locales/zh-TW.json';
      import {I18nProvider,useI18n,normalizeLocale,LOCALE_LABELS} from './app/utils/i18n';
      import {GrowthOverviewCard} from './app/components/GrowthOverviewCard';
      import {GrowthProjectForm} from './app/components/GrowthProjectForm';
      import {GrowthMeasurementResults} from './app/components/GrowthMeasurementResults';
      import {GrowthProjectJourneys} from './app/components/GrowthProjectJourneys';
      function Fixture(){const {t,locale,setLocale}=useI18n();const[open,setOpen]=React.useState(new URLSearchParams(location.search).has('create')); const[audience,setAudience]=React.useState('all');
        return <AppProvider i18n={({en,de,'zh-CN':cn,'zh-TW':tw})[locale]}><Page title={t('Projects')} primaryAction={{content:t('Create project'),onAction:()=>setOpen(true)}}>
          <div className="gp-stack"><label style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:8}}>{t('Language')}<select value={locale} onChange={e=>setLocale(e.target.value)}>{Object.entries(LOCALE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <GrowthOverviewCard shop="local-i18n-fixture.myshopify.com"/><div className="gp-heading"><h2>{t('Measurement results')}</h2><div className="gp-toggle">{['all','active'].map(value=><button type="button" key={value} onClick={()=>setAudience(value)} aria-pressed={audience===value}>{t(value==='all'?'All':'Active')}</button>)}</div></div>
          <GrowthMeasurementResults shop="local-i18n-fixture.myshopify.com" projectId="local-project" measurementId="local-measurement" comparisonId="" filters={{audience,source:'',medium:'',campaign:''}}/>
          <GrowthProjectJourneys shop="local-i18n-fixture.myshopify.com" projectId="local-project" measurementId="local-measurement" filters={{audience,source:'',medium:'',campaign:''}}/>
          <GrowthProjectForm open={open} onClose={()=>setOpen(false)} shop="local-i18n-fixture.myshopify.com" sources={['facebook','google','email']}/>
          </div></Page></AppProvider>}
      createRoot(document.getElementById('root')).render(<I18nProvider locale={normalizeLocale(new URLSearchParams(location.search).get('locale'))||'en'} shop={'fixture-'+location.search}><Fixture/></I18nProvider>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "project-fixture-services",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(?:@remix-run\/react|@shopify\/app-bridge-react)$|(?:^|\/)background-json$/,
          },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          loader: "js",
          resolveDir: process.cwd(),
          contents: args.path.includes("background-json")
            ? `
        const series=Array.from({length:10},(_,i)=>({date:'2026-10-'+String(i+1).padStart(2,'0'),sessions:110+i*12,conversionRate:2.1+(i%4)*0.4}));
        const engagement={version:1,maxSessions:130,groups:[{category:'Button',items:[{key:'cart',label:'Merchant button label',clicks:144,sessions:130,carts:100,purchases:32},{key:'video',label:'Play video',clicks:32,sessions:27,carts:4,purchases:1}]}]};
        export function useBackgroundJson({path}){
          const report={sessions:1340,addedToCart:210,conversions:43,atcRate:15.67,conversionRate:3.21,series,channels:[{source:'facebook',medium:'paid_social',campaign:'Autumn campaign',sessions:690,addedToCart:120,conversions:28,conversionRate:4.06},{source:'google',medium:'organic',campaign:'',sessions:650,addedToCart:90,conversions:15,conversionRate:2.31}],engagement};
          const data=path.includes('growth-metrics')?{progress:{status:'ready',currentSeries:series,currentSessions:1340,currentRate:3.21,rangeStart:'2026-10-01',rangeEnd:'2026-10-10'},sales:{aov:87.50,ltv:142.30,currency:'EUR',series:series.map(p=>({date:p.date,aov:87.5,ltv:142.3}))}}:path.includes('project-journeys')?{sessions:[{id:'local',source:'facebook',medium:'paid_social',campaign:'Autumn campaign',startedAt:'2026-10-22T10:15:00Z',lastSeenAt:'2026-10-22T10:20:00Z',visitorType:'REAL',addedToCart:true,converted:false,pageCount:4,eventCount:7,detailUrl:'#fixture-only'}],total:1,page:1,pageCount:1}:{report,comparison:null};
          return {data,loading:false,error:null,reload(){}};
        }`
            : args.path.includes("app-bridge")
              ? `export const useAppBridge=()=>({resourcePicker:async()=>[{id:'gid://shopify/Product/1',title:'Merchant sample product',handle:'sample'}]});`
              : `import {createElement} from 'react'; export const Link=({to,...props})=>createElement('a',{href:to,...props}); export const useRouteLoaderData=()=>({apiKey:'fixture'});export const useFetcher=()=>({state:'idle',data:undefined,load(){},submit(){alert('Fixture only — no records created.')}});`,
        }));
      },
    },
  ],
});
const polaris = readFileSync(
  "node_modules/@shopify/polaris/build/esm/styles.css",
);
const projects = readFileSync("app/styles/projects.css");
createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:4190");
  if (url.searchParams.has("mobile")) {
    url.searchParams.delete("mobile");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      `<!doctype html><title>Projects mobile QA — 390px</title><body style="margin:0;background:#dfe3e8;display:flex;justify-content:center"><iframe title="390px responsive preview" src="${url.pathname + url.search}" style="width:390px;height:844px;border:0;background:#fff"></iframe></body>`,
    );
    return;
  }
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "application/javascript");
    res.end(result.outputFiles[0].contents);
    return;
  }
  if (req.url === "/polaris.css" || req.url === "/projects.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(req.url === "/polaris.css" ? polaris : projects);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Projects translation QA — simulated data</title><link rel="stylesheet" href="/polaris.css"><link rel="stylesheet" href="/projects.css"></head><body style="background:#f1f1f1"><p style="padding:8px 20px;background:#fff3c4">Local translation QA. Simulated data only; no Shopify or database writes.</p><div id="root"></div><script src="/fixture.js"></script></body></html>',
  );
}).listen(4190, "127.0.0.1", () =>
  console.log("Projects translation fixture: http://127.0.0.1:4190/?locale=de"),
);
