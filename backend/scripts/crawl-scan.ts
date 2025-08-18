/**
 * Erweiterter Site-Crawler + axe-core Scan
 * Parametrisierter Crawl mit Robots-Modi, Scope-Filter und Normreferenzen.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import fetch from 'node-fetch';
import { chromium, Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { checkDownloads } from '../scanners/downloads.js';

async function readDefaults() {
  try {
    const p = new URL('../config/scan.defaults.json', import.meta.url);
    return JSON.parse(await fs.readFile(p, 'utf-8'));
  } catch {
    return {};
  }
}

interface Defaults {
  startUrl?: string;
  maxPages?: number;
  maxDepth?: number;
  scope?: string;
  domainAllowlist?: string[];
  seedSitemap?: boolean;
  respectRobots?: string;
  respectHashRoutes?: boolean;
  checkIframes?: boolean;
  clickConsent?: string;
  customConsentSelectors?: string[];
  dynamicInteractions?: boolean;
  waitStrategy?: string;
  waitSelector?: string;
  waitMs?: number;
  rateLimitDelayMsMin?: number;
  rateLimitDelayMsMax?: number;
  navigationTimeoutMs?: number;
  actionTimeoutMs?: number;
  userAgent?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  downloads?: { enabled: boolean; types: string[]; maxBytes: number };
  linkFilters?: { include: string[]; exclude: string[] };
}

interface Violation {
  id: string;
  impact?: string;
  help?: string;
  helpUrl?: string;
  nodes?: { target: string[]; failureSummary?: string }[];
  tags?: string[];
  wcagRefs?: string[];
  bitvRefs?: string[];
  en301549Refs?: string[];
  legalContext?: string;
  mapped?: boolean;
  norms?: { wcagRefs: string[]; bitvRefs: string[]; en301549Refs: string[]; legalContext?: string };
}

interface PageResult { url: string; violations: Violation[]; incomplete: any[]; simulated?: boolean; robotsBlocked?: boolean; }
interface QueueItem { url: string; depth: number; }

function envBool(name: string, fallback: boolean): boolean {
  const v = (process.env[name] || '').toLowerCase().trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}
function envNum(name: string, fallback: number): number {
  const v = Number(process.env[name] || '');
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
}
function envList(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  try { const arr = JSON.parse(v); if (Array.isArray(arr)) return arr.map(String); } catch {}
  return v.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}
function toRegExps(arr: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const s of arr) { try { out.push(new RegExp(s)); } catch {} }
  return out;
}

function normalizeUrl(u: string, stripHash: boolean): string {
  try { const url = new URL(u); if (stripHash) url.hash=''; return url.toString(); } catch { return u; }
}
function isHttp(u: string) { return /^https?:\/\//i.test(u); }
function isDownloadLink(u: string, types: string[]): boolean {
  const ext = u.toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/)?.[1] || '';
  return types.includes(ext);
}
async function ensureDir(dir: string) { await fs.mkdir(dir, { recursive: true }); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function randInt(min: number, max: number) { return Math.floor(min + Math.random()*(max-min+1)); }

async function readRobots(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { redirect: 'follow' });
    if (!res.ok) return [];
    const txt = await res.text();
    const lines = txt.split(/\r?\n/); const dis:string[]=[]; let applies=false;
    for (const line of lines) {
      const l=line.trim();
      if (/^user-agent:\s*\*/i.test(l)) { applies=true; continue; }
      if (/^user-agent:/i.test(l)) { applies=false; continue; }
      if (applies) { const m=l.match(/^disallow:\s*(.*)$/i); if (m) dis.push(m[1].trim()); }
    }
    return dis.filter(Boolean);
  } catch { return []; }
}
function disallowed(urlStr: string, origin: string, rules: string[]): boolean {
  try { const u=new URL(urlStr); if (u.origin!==origin) return false; return rules.some(r=>r!=='' && u.pathname.startsWith(r)); } catch { return false; }
}
async function readSitemap(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/sitemap.xml`, { redirect: 'follow' });
    if (!res.ok) return [];
    const xml = await res.text();
    const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map(m=>m[1]);
    return locs.filter(isHttp);
  } catch { return []; }
}

function computeScore(violations: Violation[]): number {
  let score=100; const weights:Record<string,number>={critical:6,serious:4,moderate:2,minor:1};
  for(const v of violations){ const w=weights[v.impact||'moderate']||2; const count=Math.min(5,v.nodes?.length??1); score-=Math.min(35,w*count); }
  return Math.max(0, Math.min(100, score));
}

async function clickConsentAuto(page: Page) {
  const labels = ['Alle akzeptieren','Akzeptieren','Zustimmen','Einverstanden','Accept all','Accept','I agree','Agree','Allow all'];
  try {
    await page.evaluate((labelsIn) => {
      const candidates = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]'));
      function norm(s:string){return s.replace(/\s+/g,' ').trim().toLowerCase();}
      for (const el of candidates as HTMLElement[]) {
        const txt = norm(el.innerText || (el.getAttribute('aria-label')||''));
        if (labelsIn.some((l:string)=>txt.includes(l.toLowerCase()))) { (el as HTMLElement).click(); }
      }
    }, labels);
  } catch {}
}

async function gentleInteractions(page: Page) {
  try { await page.$$eval('details:not([open])', (els:Element[])=>els.slice(0,8).forEach((el:any)=>{try{el.open=true;}catch{}})); } catch{}
  try { await page.$$eval('[aria-haspopup], [role=menuitem], button, summary', (els:Element[])=>{ for(const el of els.slice(0,12)) try{(el as HTMLElement).click();}catch{} }); } catch{}
  try { const tabs = await page.$$("[role='tab']"); for(const t of tabs.slice(0,6)){try{await t.click(); await page.waitForTimeout(120);}catch{}} } catch{}
  try { await page.$$eval('[aria-expanded="false"], [data-accordion], a, button', (els:Element[])=>{ const hits=(els as HTMLElement[]).filter(el=>/mehr anzeigen|weiterlesen|more/i.test(el.innerText||'')); for(const el of hits.slice(0,6)) try{(el as HTMLElement).click();}catch{} }); } catch{}
  try { await page.$$eval('dialog:not([open])', (els:any[])=>{ for(const el of els.slice(0,2)) try{ (el as HTMLDialogElement).showModal?.(); }catch{} }); } catch{}
}


function attachNorms(v: Violation, mapping: Record<string, any>) {
  const entry = mapping[v.id] || {};
  const hasExplicit = Boolean(entry.wcagRefs?.length || entry.wcag?.length || entry.bitvRefs?.length || entry.bitv?.length || entry.en301549Refs?.length || entry.en301549?.length);
  v.wcagRefs = entry.wcagRefs || entry.wcag || v.wcagRefs || [];
  v.bitvRefs = entry.bitvRefs || entry.bitv || v.bitvRefs || [];
  v.en301549Refs = entry.en301549Refs || entry.en301549 || v.en301549Refs || [];
  if (entry.legalContext) v.legalContext = entry.legalContext;
  if (!v.wcagRefs.length || !v.bitvRefs.length || !v.en301549Refs.length) {
    enrichWithFallback(v);
    if (!hasExplicit && (v.wcagRefs.length || v.bitvRefs.length || v.en301549Refs.length)) v.mapped = true;
  }
  v.norms = {
    wcagRefs: v.wcagRefs,
    bitvRefs: v.bitvRefs,
    en301549Refs: v.en301549Refs,
    ...(v.legalContext ? { legalContext: v.legalContext } : {})
  };
}

async function main() {
  const defaults: Defaults = await readDefaults();

  const START_URL = envStr('START_URL', defaults.startUrl || '').trim();
  if (!START_URL) { console.error('❌ START_URL ist nicht gesetzt.'); process.exit(2); }

  const scope = envStr('SCOPE', defaults.scope || 'same-origin');
  const domainAllowlist = envList('DOMAIN_ALLOWLIST', defaults.domainAllowlist || []);
  const seedSitemap = envBool('SEED_SITEMAP', defaults.seedSitemap ?? true);
  const respectRobots = envStr('RESPECT_ROBOTS', defaults.respectRobots || 'respect');
  const respectHashRoutes = envBool('RESPECT_HASH_ROUTES', defaults.respectHashRoutes ?? true);
  const checkIframes = envBool('CHECK_IFRAMES', defaults.checkIframes ?? true);
  const clickConsent = envStr('CLICK_CONSENT', defaults.clickConsent || 'auto');
  const customConsentSelectors = envList('CUSTOM_CONSENT_SELECTORS', defaults.customConsentSelectors || []);
  const dynamicInteractions = envBool('DYNAMIC_INTERACTIONS', defaults.dynamicInteractions ?? true);
  const waitStrategy = envStr('WAIT_STRATEGY', defaults.waitStrategy || 'networkidle');
  const waitSelector = envStr('WAIT_SELECTOR', defaults.waitSelector || '');
  const waitMs = envNum('WAIT_MS', defaults.waitMs ?? 0);
  const MAX_PAGES = envNum('MAX_PAGES', defaults.maxPages ?? 200);
  const MAX_DEPTH = envNum('MAX_DEPTH', defaults.maxDepth ?? 10);
  const rateMin = envNum('RATE_LIMIT_DELAY_MS_MIN', defaults.rateLimitDelayMsMin ?? 200);
  const rateMax = envNum('RATE_LIMIT_DELAY_MS_MAX', defaults.rateLimitDelayMsMax ?? 600);
  const navigationTimeout = envNum('NAVIGATION_TIMEOUT_MS', defaults.navigationTimeoutMs ?? 45000);
  const actionTimeout = envNum('ACTION_TIMEOUT_MS', defaults.actionTimeoutMs ?? 45000);
  const userAgent = envStr('USER_AGENT', defaults.userAgent || 'AccessCheckerBot/0.2 (+https://example.invalid)');
  const viewportWidth = envNum('VIEWPORT_WIDTH', defaults.viewportWidth ?? 1200);
  const viewportHeight = envNum('VIEWPORT_HEIGHT', defaults.viewportHeight ?? 800);
  const downloadsEnabled = envBool('DOWNLOADS_ENABLED', defaults.downloads?.enabled ?? true);
  const downloadsTypes = envList('DOWNLOADS_TYPES', defaults.downloads?.types || ['pdf','docx','pptx','doc','ppt']);
  const downloadsMaxBytes = envNum('DOWNLOADS_MAX_BYTES', defaults.downloads?.maxBytes ?? 5242880);
  const linkInclude = envList('LINK_FILTERS_INCLUDE', defaults.linkFilters?.include || []);
  const linkExclude = envList('LINK_FILTERS_EXCLUDE', defaults.linkFilters?.exclude || []);
  const linkIncludeRegs = toRegExps(linkInclude); const linkExcludeRegs = toRegExps(linkExclude);

  const stripHash = !respectHashRoutes;
  const origin = new URL(START_URL).origin;
  const startHost = new URL(START_URL).hostname;
  const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(process.cwd(), 'out');
  await ensureDir(OUTPUT_DIR);

  function inScope(u: string): boolean {
    try {
      const url = new URL(u);
      if (scope === 'same-origin') return url.origin === origin;
      if (scope === 'same-site') return url.hostname === startHost;
      if (scope === 'domain-list') return domainAllowlist.some(d => url.hostname === d || url.hostname.endsWith(`.${d}`));
      return true;
    } catch { return false; }
  }

  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: normalizeUrl(START_URL, stripHash), depth: 0 }];
  const downloads = new Set<string>();
  const pageResults: PageResult[] = [];
  let robotsAuditCount = 0; let simulatedPagesCount = 0; let filteredByScope = 0;

  const disallow = await readRobots(origin);
  if (seedSitemap) {
    for (const u of await readSitemap(origin)) {
      const n = normalizeUrl(u, stripHash);
      if (inScope(n) && !visited.has(n)) queue.push({ url: n, depth: 0 });
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent, viewport: { width: viewportWidth, height: viewportHeight } });
  context.setDefaultNavigationTimeout(navigationTimeout);
  context.setDefaultTimeout(actionTimeout);
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as any).__acsRoutes = [];
    const record = () => { try { (window as any).__acsRoutes.push(location.href); } catch{} };
    const push = history.pushState; history.pushState = function(...args:any[]){ (push as any).apply(this,args as any); record(); };
    const rep = history.replaceState; history.replaceState = function(...args:any[]){ (rep as any).apply(this,args as any); record(); };
    window.addEventListener('hashchange', record, { capture: true });
  });

  let ruleMap: Record<string, any> = {};
  try {
    const arr = JSON.parse(await fs.readFile(new URL('../config/rules_mapping.json', import.meta.url), 'utf-8'));
    for (const m of arr) {
      ruleMap[m.axeRuleId] = {
        wcagRefs: m.wcagRefs || m.wcag || [],
        bitvRefs: m.bitvRefs || m.bitv || [],
        en301549Refs: m.en301549Refs || m.en301549 || [],
        legalContext: m.legalContext
      };
    }
  } catch {}

  while (queue.length && visited.size < MAX_PAGES) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    const isBlocked = disallowed(url, origin, disallow);
    if (isBlocked && respectRobots === 'respect') { robotsAuditCount++; continue; }
    visited.add(url);
    const simulate = isBlocked && (respectRobots === 'audit' || respectRobots === 'ignore');
    if (isBlocked && respectRobots === 'audit') robotsAuditCount++;
    if (simulate) simulatedPagesCount++;

    try {
      console.log(`🔎 Scanne [d=${depth}]${simulate?' (simulation)':''}: ${url}`);
      const resp = await page.goto(url, { waitUntil: waitStrategy==='networkidle'?'networkidle':'load' });
      if (waitStrategy === 'selector' && waitSelector) { try { await page.waitForSelector(waitSelector); } catch {} }
      if (waitStrategy === 'fixed' && waitMs>0) { await page.waitForTimeout(waitMs); }

      if (clickConsent === 'auto') await clickConsentAuto(page);
      else if (clickConsent === 'custom') {
        for (const sel of customConsentSelectors) { try { await page.click(sel); } catch {} }
      }
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      if (dynamicInteractions) await gentleInteractions(page);

      const axe = new AxeBuilder({ page });
      const res = await axe.analyze();
      const violations: Violation[] = (res.violations || []) as any[];
      const incomplete: any[] = (res.incomplete || []) as any[];
      for (const v of violations) attachNorms(v, ruleMap);

      pageResults.push({ url, violations, incomplete, simulated: simulate, robotsBlocked: isBlocked });

      if (!simulate) {
        const links:string[] = await page.$$eval('a[href]', els => (els as HTMLAnchorElement[]).map(a => (a as any).href as string));
        let extraLinks:string[]=[];
        try {
          extraLinks = await page.evaluate(()=>{
            const out=new Set<string>();
            const toAbs=(u:string)=>{try{return new URL(u,document.baseURI).toString();}catch{return'';}};
            document.querySelectorAll('[data-href],[data-url],[routerlink],[role="link"]').forEach(el=>{
              const href=(el.getAttribute('href')||(el as HTMLElement).dataset.href||(el as HTMLElement).dataset.url||el.getAttribute('routerlink'))||'';
              const u=toAbs(href); if(u) out.add(u);
            });
            document.querySelectorAll('[onclick]').forEach(el=>{
              const attr=el.getAttribute('onclick')||''; const m=attr.match(/(?:location\.href|window\.location(?:\.href)?)\s*=\s*['"]([^'"\s]+)['"]/i);
              if(m){const u=toAbs(m[1]); if(u) out.add(u);} });
            return Array.from(out);
          });
        } catch{}
        const allLinks = links.concat(extraLinks);
        for (const raw of allLinks) {
          if (!isHttp(raw)) continue;
          const href = normalizeUrl(raw, stripHash);
          if (!inScope(href)) { filteredByScope++; continue; }
          if (linkIncludeRegs.length && !linkIncludeRegs.some(r=>r.test(href))) { filteredByScope++; continue; }
          if (linkExcludeRegs.some(r=>r.test(href))) { filteredByScope++; continue; }
          if (downloadsEnabled && isDownloadLink(href, downloadsTypes)) { downloads.add(href); continue; }
          if (depth + 1 <= MAX_DEPTH && !visited.has(href) && !queue.find(q=>q.url===href)) queue.push({ url: href, depth: depth + 1 });
        }

        if (checkIframes) {
          for (const f of page.frames()) {
            const fu = f.url(); if (!isHttp(fu)) continue;
            const fUrl = normalizeUrl(fu, stripHash);
            if (!inScope(fUrl)) { filteredByScope++; continue; }
            if (depth + 1 <= MAX_DEPTH && !visited.has(fUrl) && !queue.find(q=>q.url===fUrl)) queue.push({ url: fUrl, depth: depth + 1 });
          }
        }

        try {
          const spaRoutes:string[] = await page.evaluate(()=>{const r=(window as any).__acsRoutes||[]; (window as any).__acsRoutes=[]; return r;});
          for(const raw of spaRoutes){ if(!isHttp(raw)) continue; const href=normalizeUrl(raw,stripHash); if(!inScope(href)){filteredByScope++;continue;} if(downloadsEnabled && isDownloadLink(href,downloadsTypes)){downloads.add(href);continue;} if(depth+1<=MAX_DEPTH && !visited.has(href) && !queue.find(q=>q.url===href)) queue.push({url:href, depth:depth+1}); }
        } catch{}
      } else {
        // simulation: trotzdem Downloads sammeln
        try {
          const links = await page.$$eval('a[href]', els => (els as HTMLAnchorElement[]).map(a => (a as any).href as string));
          for (const raw of links) { if (!isHttp(raw)) continue; const href = normalizeUrl(raw, stripHash); if (downloadsEnabled && isDownloadLink(href, downloadsTypes)) downloads.add(href); }
        } catch{}
      }
    } catch (e:any) {
      console.warn(`⚠️  Scan-Fehler bei ${url}:`, e?.message || e);
    }
    await sleep(randInt(rateMin, rateMax));
  }

  await browser.close();

  let downloadsReport: any[] = [];
  if (downloadsEnabled && downloads.size) {
    try { downloadsReport = await checkDownloads(Array.from(downloads).slice(0,50), { types: downloadsTypes, maxBytes: downloadsMaxBytes }); }
    catch(e){ console.warn('⚠️  Downloads konnten nicht geprüft werden:', (e as any)?.message || e); }
  }

  const allViolations = pageResults.flatMap(p => p.violations);
  const score = computeScore(allViolations);
  const params = {
    start_url: START_URL,
    max_pages: MAX_PAGES,
    max_depth: MAX_DEPTH,
    scope,
    domain_allowlist: domainAllowlist,
    seed_sitemap: seedSitemap,
    respect_robots: respectRobots,
    respect_hash_routes: respectHashRoutes,
    check_iframes: checkIframes,
    click_consent: clickConsent,
    custom_consent_selectors: customConsentSelectors,
    dynamic_interactions: dynamicInteractions,
    wait_strategy: waitStrategy,
    wait_selector: waitSelector,
    wait_ms: waitMs,
    rate_limit_delay_ms_min: rateMin,
    rate_limit_delay_ms_max: rateMax,
    navigation_timeout_ms: navigationTimeout,
    action_timeout_ms: actionTimeout,
    user_agent: userAgent,
    viewport_width: viewportWidth,
    viewport_height: viewportHeight,
    downloads: { enabled: downloadsEnabled, types: downloadsTypes, max_bytes: downloadsMaxBytes },
    link_filters: { include: linkInclude, exclude: linkExclude }
  };

  const summary = {
    startUrl: START_URL,
    date: new Date().toISOString(),
    pagesCrawled: visited.size,
    downloadsFound: downloads.size,
    score,
    totals: {
      violations: allViolations.length,
      incomplete: pageResults.reduce((a, p) => a + p.incomplete.length, 0)
    },
    params,
    robots_audit_count: robotsAuditCount,
    simulated_pages_count: simulatedPagesCount,
    filtered_by_scope: filteredByScope
  };

  await fs.writeFile(path.join(OUTPUT_DIR, 'scan.json'), JSON.stringify(summary, null, 2), 'utf-8');
  await fs.writeFile(path.join(OUTPUT_DIR, 'pages.json'), JSON.stringify(Array.from(visited), null, 2), 'utf-8');
  await fs.writeFile(path.join(OUTPUT_DIR, 'issues.json'), JSON.stringify(allViolations, null, 2), 'utf-8');
  await fs.writeFile(path.join(OUTPUT_DIR, 'downloads.json'), JSON.stringify(Array.from(downloads), null, 2), 'utf-8');
  await fs.writeFile(path.join(OUTPUT_DIR, 'downloads_report.json'), JSON.stringify(downloadsReport, null, 2), 'utf-8');

  console.log('✅ Scan abgeschlossen. Artefakte in:', OUTPUT_DIR);
}

main().catch(err => { console.error('❌ Unerwarteter Fehler:', err); process.exit(1); });
