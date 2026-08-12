import express from 'express';
import helmet from 'helmet';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawlSites, assertPublicUrl, toCsv } from '@gojodev/mahoraga-crawl';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const jobs = new Map();
const startsByIp = new Map();
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org';
const OVERPASS_URL = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const SEARXNG_URL = (process.env.SEARXNG_URL || '').replace(/\/$/, '');
const USER_AGENT = 'MahoragaLeadResearch/2.0 (+https://github.com/gojocodes-all/mahoraga)';
const BLOCKED_SITE_HOSTS = [
  'facebook.com','instagram.com','linkedin.com','tiktok.com','x.com','twitter.com','youtube.com',
  'google.com','googleusercontent.com','goo.gl','maps.app.goo.gl','bing.com','duckduckgo.com',
  'yelp.com','tripadvisor.com','foursquare.com','yellowpages.com','businesslist.com.ng','finelib.com',
  'ng.worldorgs.com','hotfrog.com','schoolandcollegelistings.com','africabizinfo.com'
];

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc:["'self'"], styleSrc:["'self'"], scriptSrc:["'self'"], imgSrc:["'self'",'data:'], connectSrc:["'self'"], objectSrc:["'none'"], frameAncestors:["'none'"], baseUri:["'self'"] } },
  crossOriginEmbedderPolicy:false
}));
app.use(express.json({ limit:'80kb' }));
app.use(express.static(path.join(__dirname,'..','public'), { extensions:['html'] }));

app.get('/api/health', (_req,res)=>res.json({ok:true,name:'Mahoraga',version:'2.0.0',crawler:'@gojodev/mahoraga-crawl',searchProvider:SEARXNG_URL?'SearXNG + DuckDuckGo fallback':'DuckDuckGo fallback',geo:'Nominatim + Overpass'}));

app.post('/api/jobs', async (req,res)=>{
  try {
    enforceRate(req.ip || 'unknown');
    const query = clean(req.body?.query).slice(0,180);
    if (query.length < 3) throw badRequest('Describe the businesses you want to find.');
    const limit = clampInt(req.body?.limit,5,40,20);
    const id = crypto.randomUUID();
    const job = { id,query,limit,status:'queued',phase:'Understanding your search',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),progress:2,leads:[],errors:[],meta:{} };
    jobs.set(id,job);
    runLeadJob(job).catch(err=>{job.status='failed';job.phase='Search failed';job.errors.push(cleanError(err));job.updatedAt=new Date().toISOString();});
    res.status(202).json(publicJob(job));
  } catch(err) { res.status(err.statusCode||400).json({error:cleanError(err)}); }
});
app.get('/api/jobs/:id',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Search job not found or expired.'});res.json(publicJob(j));});
app.get('/api/jobs/:id/export.json',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).end();res.setHeader('Content-Disposition',`attachment; filename="mahoraga-${slug(j.query)}.json"`);res.json(j.leads);});
app.get('/api/jobs/:id/export.csv',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).end();res.type('text/csv');res.setHeader('Content-Disposition',`attachment; filename="mahoraga-${slug(j.query)}.csv"`);res.send(toCsv(j.leads));});

app.post('/api/verify', async (req,res)=>{
  try {
    const lead = normalizeLead(req.body?.lead || {});
    res.json(await enrichWebsite(lead));
  } catch(err) { res.status(400).json({error:cleanError(err)}); }
});

app.listen(PORT,()=>console.log(`Mahoraga listening on :${PORT}`));

async function runLeadJob(job) {
  job.status='running';
  const intent = parseIntent(job.query);
  job.meta.intent=intent;
  update(job,'Finding the location',8);

  const [geoResult, webResult] = await Promise.allSettled([
    discoverOsm(intent, Math.max(job.limit*2,25)),
    discoverWeb(intent, Math.min(12,Math.ceil(job.limit/2)+4))
  ]);
  const osm = geoResult.status==='fulfilled'?geoResult.value:[];
  if (geoResult.status==='rejected') job.errors.push(`Map discovery: ${cleanError(geoResult.reason)}`);
  const web = webResult.status==='fulfilled'?webResult.value:[];
  if (webResult.status==='rejected') job.errors.push(`Web discovery: ${cleanError(webResult.reason)}`);

  update(job,'Combining and cleaning discoveries',32);
  let leads = dedupeLeads([...osm,...web]).filter(l=>relevanceScore(l,intent)>0).sort((a,b)=>relevanceScore(b,intent)-relevanceScore(a,intent));
  leads = leads.slice(0, Math.max(job.limit+8, job.limit));

  if (!leads.length) {
    job.leads=[];job.status='completed';update(job,'No matching businesses found',100);return;
  }

  update(job,'Checking the web for standalone websites',42);
  const verified=[];
  await mapLimit(leads,3,async(lead,index)=>{
    const enriched = await enrichWebsite(lead,intent).catch(err=>({...lead,websiteStatus:'uncertain',websiteConfidence:0,websiteReason:`Verification error: ${cleanError(err)}`}));
    enriched.score = opportunityScore(enriched);
    enriched.message = generateMessage(enriched,intent);
    verified.push(enriched);
    const pct=42+Math.round(((index+1)/leads.length)*52);
    update(job,`Verifying websites ${index+1}/${leads.length}`,Math.min(94,pct));
  });

  let final = verified.sort((a,b)=>b.score-a.score);
  if (intent.wantsNoWebsite) final = final.filter(l=>l.websiteStatus!=='verified');
  job.leads=final.slice(0,job.limit);
  job.status='completed';
  job.meta.sources={osm:osm.length,web:web.length,combined:leads.length};
  update(job,`Ready · ${job.leads.length} leads`,100);
}

function parseIntent(raw) {
  let q = clean(raw);
  const wantsNoWebsite = /\b(without|no|lacking)\s+(a\s+)?(standalone\s+)?website(s)?\b|\bwithout\s+(a\s+)?site\b/i.test(q);
  q=q.replace(/\b(without|no|lacking)\s+(a\s+)?(standalone\s+)?website(s)?\b|\bwithout\s+(a\s+)?site\b/gi,'').trim();
  const match=q.match(/^(.*?)\s+(?:in|around|near)\s+(.+)$/i);
  const businessType=clean(match?.[1]||q);
  const location=clean(match?.[2]||'Lagos, Nigeria');
  return {raw, businessType, location, wantsNoWebsite, keywords:tokenize(businessType)};
}

async function discoverOsm(intent, limit) {
  const geo=await geocode(intent.location);
  if(!geo)return[];
  const [south,north,west,east]=geo.bbox;
  const clause=osmClause(intent.businessType);
  const q=`[out:json][timeout:25];(nwr${clause}(${south},${west},${north},${east}););out center tags ${Math.min(limit,80)};`;
  const response=await axios.post(OVERPASS_URL,q,{headers:{'content-type':'application/x-www-form-urlencoded','user-agent':USER_AGENT},timeout:30000,maxContentLength:4_000_000});
  return (response.data?.elements||[]).map(el=>osmToLead(el,intent)).filter(l=>l.title).slice(0,limit);
}

async function geocode(location) {
  const r=await axios.get(`${NOMINATIM_URL}/search`,{params:{q:location,format:'jsonv2',limit:1,addressdetails:1},headers:{'user-agent':USER_AGENT,'accept-language':'en'},timeout:12000});
  const item=r.data?.[0]; if(!item)return null;
  const b=item.boundingbox?.map(Number); if(!b||b.length!==4)return null;
  return {display:item.display_name,bbox:[b[0],b[1],b[2],b[3]]};
}

function osmClause(type) {
  const t=type.toLowerCase();
  if(/school|academy|college|university|education|nursery|montessori/.test(t))return '["amenity"~"^(school|college|university|kindergarten)$"]';
  if(/real estate|property|realtor|estate agent/.test(t))return '["office"="estate_agent"]';
  if(/restaurant|cafe|food|eatery|bakery/.test(t))return '["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]';
  if(/clinic|hospital|medical|doctor|dentist|pharmacy|health/.test(t))return '["amenity"~"^(clinic|hospital|doctors|dentist|pharmacy)$"]';
  if(/salon|barber|beauty|hair|spa/.test(t))return '["shop"~"^(hairdresser|beauty|massage)$"]';
  if(/hotel|guest house|hostel|resort/.test(t))return '["tourism"~"^(hotel|guest_house|hostel|resort)$"]';
  if(/gym|fitness/.test(t))return '["leisure"="fitness_centre"]';
  if(/computer|electronics/.test(t))return '["shop"~"^(computer|electronics|mobile_phone)$"]';
  const safe=type.replace(/[^a-zA-Z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>2).slice(0,3).join('|')||'business';
  return `["name"~"${safe}",i][~"^(shop|office|amenity|tourism|leisure)$"~"."]`;
}

function osmToLead(el,intent) {
  const t=el.tags||{};
  const lat=el.lat??el.center?.lat, lon=el.lon??el.center?.lon;
  const phone=clean(t['contact:phone']||t.phone||t['contact:mobile']||'');
  const website=clean(t['contact:website']||t.website||'');
  const address=[t['addr:housenumber'],t['addr:street'],t['addr:suburb'],t['addr:city'],t['addr:state']].filter(Boolean).join(', ');
  return normalizeLead({
    title:t.name||t.brand||'', categoryName:t.amenity||t.shop||t.office||t.tourism||t.leisure||intent.businessType,
    address, city:t['addr:city']||'', state:t['addr:state']||'', countryCode:t['addr:country']||'NG', phone,
    email:t['contact:email']||t.email||'', website, sourceUrl:`https://www.openstreetmap.org/${el.type}/${el.id}`,
    latitude:lat,longitude:lon,discoverySource:'OpenStreetMap',rawTags:t
  });
}

async function discoverWeb(intent, limit) {
  const queries=[
    `${intent.businessType} ${intent.location} phone address`,
    `"${intent.businessType}" "${intent.location}" business`,
    `${intent.businessType} ${intent.location} contact`
  ];
  const all=[];
  for(const q of queries){
    const results=await webSearch(q,Math.min(limit,10)).catch(()=>[]);
    all.push(...results);
    if(all.length>=limit*2)break;
  }
  const uniqueResults=dedupeSearch(all).slice(0,Math.min(18,limit*2));
  const leads=[];
  const crawlable=[];
  for(const r of uniqueResults){
    const host=safeHost(r.url);
    const title=cleanSearchTitle(r.title);
    const phone=extractPhones(`${r.title} ${r.snippet}`)[0]||'';
    if(title && !looksLikeListicle(title)) leads.push(normalizeLead({title,categoryName:intent.businessType,address:'',phone,website:isBlockedHost(host)?'':origin(r.url),sourceUrl:r.url,description:r.snippet,discoverySource:'Web search'}));
    if(r.url && !isBlockedHost(host)) crawlable.push(r.url);
  }
  if(crawlable.length){
    const crawled=await crawlSites({startUrls:crawlable.slice(0,8),maxPages:8,maxDepth:0,concurrency:2,delaySecs:1,followLinks:false}).catch(()=>({leads:[]}));
    for(const l of crawled.leads||[]) leads.push(normalizeLead({...l,sourceUrl:l.url,discoverySource:'Web crawl'}));
  }
  return dedupeLeads(leads).slice(0,limit*2);
}

async function webSearch(query,num=6){
  if(SEARXNG_URL){
    try{
      const r=await axios.get(`${SEARXNG_URL}/search`,{params:{q:query,format:'json',safesearch:1,language:'en'},headers:{'user-agent':USER_AGENT},timeout:12000});
      const results=(r.data?.results||[]).slice(0,num).map(x=>({title:clean(x.title),url:clean(x.url),snippet:clean(x.content||x.snippet||'')}));
      if(results.length)return results;
    }catch{}
  }
  return duckSearch(query,num);
}

async function duckSearch(query,num=6){
  const r=await axios.get('https://duckduckgo.com/html/',{params:{q:query},headers:{'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/135 Safari/537.36'},timeout:12000,maxContentLength:2_000_000});
  const $=cheerio.load(r.data);const out=[];
  $('.result').each((_,el)=>{if(out.length>=num)return;const a=$(el).find('.result__title a').first();const raw=a.attr('href')||'';const url=duckDirect(raw);const title=clean(a.text());const snippet=clean($(el).find('.result__snippet').text());if(title&&url)out.push({title,url,snippet});});
  return out;
}
function duckDirect(raw){try{let s=raw;if(s.startsWith('//'))s='https:'+s;if(s.startsWith('/'))s='https://duckduckgo.com'+s;const u=new URL(s);if(u.hostname.endsWith('duckduckgo.com')){const d=u.searchParams.get('uddg');if(d)return decodeURIComponent(d)}return u.href}catch{return''}}

async function enrichWebsite(lead,intent={location:lead.city||lead.state||'',businessType:lead.categoryName||''}) {
  const base=normalizeLead(lead);
  const candidates=[];
  if(base.website && !isBlockedHost(safeHost(base.website))) candidates.push(base.website);
  const searchQuery=`"${base.title}" ${intent.location||base.city||base.state||''} official website`;
  const results=await webSearch(searchQuery,5).catch(()=>[]);
  for(const r of results){const h=safeHost(r.url);if(h&&!isBlockedHost(h))candidates.push(origin(r.url));}
  const unique=[...new Set(candidates.filter(Boolean))].slice(0,5);
  let best=null; let sawReachable=false;
  for(const candidate of unique){
    const verdict=await verifyWebsite(candidate,base).catch(()=>null);
    if(!verdict)continue;
    if(verdict.reachable)sawReachable=true;
    if(!best||verdict.confidence>best.confidence)best=verdict;
    if(verdict.verified&&verdict.confidence>=72)break;
  }
  if(best?.verified){return{...base,website:best.url,websiteStatus:'verified',websiteConfidence:best.confidence,websiteReason:best.reason,websiteCheckedAt:new Date().toISOString()};}
  return{...base,website:base.website||'',websiteStatus:sawReachable?'uncertain':'not_found',websiteConfidence:best?.confidence||0,websiteReason:sawReachable?'A possible site was reachable, but identity matching was too weak to call it official.':'No credible standalone website was found in the checked search results.',websiteCheckedAt:new Date().toISOString()};
}

async function verifyWebsite(value,lead){
  const url=await assertPublicUrl(value);
  const r=await axios.get(url,{headers:{'user-agent':USER_AGENT,'accept':'text/html,application/xhtml+xml'},timeout:12000,maxRedirects:5,maxContentLength:1_200_000,validateStatus:s=>s>=200&&s<500});
  const type=String(r.headers['content-type']||'');
  if(r.status>=400||!type.includes('text/html'))return{url,reachable:false,verified:false,confidence:0,reason:`HTTP ${r.status}`};
  const $=cheerio.load(String(r.data||''));
  const pageText=clean(`${$('title').text()} ${$('h1').first().text()} ${$('meta[name="description"]').attr('content')||''} ${$('body').text().slice(0,60000)}`);
  if(/domain (is )?for sale|buy this domain|parked domain|sedo domain parking|hugedomains/i.test(pageText))return{url,reachable:true,verified:false,confidence:5,reason:'The domain appears parked or for sale.'};
  const nameTokens=tokenize(lead.title).filter(t=>t.length>2);
  const hay=pageText.toLowerCase();
  const matched=nameTokens.filter(t=>hay.includes(t)).length;
  const ratio=nameTokens.length?matched/nameTokens.length:0;
  const phoneDigits=digits(lead.phone);
  const phoneMatch=phoneDigits.length>=8&&digits(pageText).includes(phoneDigits.slice(-8));
  const locationTokens=tokenize(`${lead.city} ${lead.state} ${lead.address}`).filter(t=>t.length>3).slice(0,5);
  const locationMatch=locationTokens.some(t=>hay.includes(t));
  const confidence=Math.min(99,Math.round(ratio*70+(phoneMatch?22:0)+(locationMatch?8:0)));
  const verified=(ratio>=0.6&&matched>=1)||(phoneMatch&&ratio>=0.3)||(confidence>=70);
  return{url:origin(r.request?.res?.responseUrl||url),reachable:true,verified,confidence,reason:verified?`Business identity matched the live site (${confidence}% confidence).`:`Site is live, but only weakly matches this business (${confidence}% confidence).`};
}

function normalizeLead(l){
  return {id:l.id||hash(`${l.title}|${l.phone}|${l.website}|${l.address}`),title:clean(l.title||l.name||'Unnamed business'),categoryName:clean(l.categoryName||l.category||''),address:clean(l.address||''),city:clean(l.city||''),state:clean(l.state||''),countryCode:clean(l.countryCode||'NG'),phone:clean(l.phone||''),phoneUnformatted:digits(l.phone),email:clean(l.email||l.emails?.[0]||''),website:clean(l.website||''),sourceUrl:clean(l.sourceUrl||l.url||''),description:clean(l.description||''),latitude:l.latitude??null,longitude:l.longitude??null,discoverySource:clean(l.discoverySource||''),rawTags:l.rawTags||null,websiteStatus:l.websiteStatus||'unchecked',websiteConfidence:l.websiteConfidence||0};
}
function dedupeLeads(items){const m=new Map();for(const l0 of items){const l=normalizeLead(l0);const key=l.phoneUnformatted?`p:${l.phoneUnformatted}`:l.website?`w:${safeHost(l.website)}`:`n:${norm(l.title)}:${norm(l.city||l.address)}`;if(!m.has(key))m.set(key,l);else m.set(key,merge(m.get(key),l));}return[...m.values()]}
function merge(a,b){const r={...a};for(const k of ['title','categoryName','address','city','state','countryCode','phone','email','website','sourceUrl','description','discoverySource'])if(clean(b[k]).length>clean(r[k]).length)r[k]=b[k];if(!r.latitude&&b.latitude)r.latitude=b.latitude;if(!r.longitude&&b.longitude)r.longitude=b.longitude;return r}
function relevanceScore(l,intent){const hay=`${l.title} ${l.categoryName} ${l.description}`.toLowerCase();let s=0;for(const k of intent.keywords)if(hay.includes(k))s+=5;if(l.phone)s+=2;if(l.address||l.city)s+=1;return s||1}
function opportunityScore(l){let s=35;if(l.phone)s+=28;else s-=15;if(l.websiteStatus==='not_found')s+=28;if(l.websiteStatus==='uncertain')s+=15;if(l.websiteStatus==='verified')s-=18;if(l.address||l.city)s+=5;if(l.email)s+=3;return Math.max(0,Math.min(100,s))}
function generateMessage(l,intent){const type=clean(l.categoryName||intent.businessType||'business').toLowerCase();const loc=clean(l.city||l.state||intent.location);const angle=businessAngle(type);const site=l.websiteStatus==='verified'?'I also checked your current website and noticed a few opportunities to make the online experience clearer and more conversion-focused.':l.websiteStatus==='not_found'?'I couldn’t find a clear standalone website for the business, so I had an idea that could give customers one reliable place to see what you offer and contact you.':'I had an idea for improving how the business is presented online.';return `Hi 👋\n\nI came across ${l.title}${loc?` in ${loc}`:''}. I’m Gojo from GOJO.DEV, and I build practical websites for businesses.\n\n${site} For a ${type}, a focused site could ${angle}.\n\nWould you be open to me sending a quick idea of what I have in mind? No pressure.`}
function businessAngle(t){if(/school|education|college|academy/.test(t))return'present admissions, programmes and enquiry information clearly to parents and students';if(/real estate|property|estate/.test(t))return'show available properties and turn interested visitors into inspection enquiries';if(/restaurant|cafe|food/.test(t))return'put menus, location, ordering and customer enquiries in one easy place';if(/clinic|medical|hospital|health|pharmacy/.test(t))return'make services, location and appointment enquiries easier to find';if(/salon|beauty|hair|barber/.test(t))return'show services and work clearly while making bookings easier';if(/hotel|guest|resort/.test(t))return'show rooms, facilities and booking enquiries in a trustworthy mobile-friendly way';return'explain what you offer clearly and turn interested visitors into direct enquiries'}

function cleanSearchTitle(t){return clean(String(t||'').replace(/\s+[|–—-]\s+(Facebook|Instagram|LinkedIn|YouTube|TikTok|X).*$/i,'').replace(/\s+[|–—]\s+.*$/,''))}
function looksLikeListicle(t){return /\b(top|best|list of|directory|review|guide|near me|businesses in|schools in|companies in)\b/i.test(t)}
function dedupeSearch(a){const m=new Map();for(const r of a){const k=safeHost(r.url)+norm(r.title);if(!m.has(k))m.set(k,r)}return[...m.values()]}
function extractPhones(t){return [...new Set((String(t).match(/(?:\+?\d[\d\s().-]{7,}\d)/g)||[]).map(clean).filter(v=>{const d=digits(v);return d.length>=8&&d.length<=15}))]}
function isBlockedHost(h){h=h.replace(/^www\./,'').toLowerCase();return BLOCKED_SITE_HOSTS.some(x=>h===x||h.endsWith('.'+x))}
function safeHost(v){try{return new URL(v).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function origin(v){try{return new URL(v).origin}catch{return''}}
function update(job,phase,progress){job.phase=phase;job.progress=progress;job.updatedAt=new Date().toISOString()}
function publicJob(j){return{id:j.id,query:j.query,status:j.status,phase:j.phase,progress:j.progress,createdAt:j.createdAt,updatedAt:j.updatedAt,leads:j.leads,errors:j.errors.slice(-15),meta:j.meta}}
function enforceRate(ip){const now=Date.now();const recent=(startsByIp.get(ip)||[]).filter(t=>t>now-10*60*1000);if(recent.length>=6){const e=new Error('Too many searches from this connection. Try again later.');e.statusCode=429;throw e}recent.push(now);startsByIp.set(ip,recent)}
function tokenize(v){return [...new Set(String(v||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>1&&!['the','and','for','with','private','business','businesses'].includes(x)))]}
function norm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function digits(v){return String(v||'').replace(/\D/g,'')}
function clean(v){return String(v??'').replace(/\s+/g,' ').trim()}
function cleanError(e){return clean(e?.message||e||'Unknown error').slice(0,500)}
function clampInt(v,min,max,f){const n=parseInt(v,10);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f}
function badRequest(m){const e=new Error(m);e.statusCode=400;return e}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return `lead_${(h>>>0).toString(36)}`}
function slug(v){return clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,50)||'leads'}
async function mapLimit(items,limit,fn){let i=0;const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(i<items.length){const index=i++;await fn(items[index],index)}});await Promise.all(workers)}
setInterval(()=>{const cut=Date.now()-2*60*60*1000;for(const[id,j]of jobs)if(new Date(j.updatedAt).getTime()<cut&&!['running','queued'].includes(j.status))jobs.delete(id);for(const[ip,times]of startsByIp){const f=times.filter(t=>t>Date.now()-10*60*1000);f.length?startsByIp.set(ip,f):startsByIp.delete(ip)}},10*60*1000).unref();
