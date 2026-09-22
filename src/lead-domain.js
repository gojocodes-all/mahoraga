export function parseIntent(raw) {
  let query = clean(raw);
  const wantsNoWebsite = /\b(without|no|lacking)\s+(a\s+)?(standalone\s+)?website(s)?\b|\bwithout\s+(a\s+)?site\b/i.test(query);
  query = query.replace(/\b(without|no|lacking)\s+(a\s+)?(standalone\s+)?website(s)?\b|\bwithout\s+(a\s+)?site\b/gi, '').trim();
  const match = query.match(/^(.*?)\s+(?:in|around|near)\s+(.+)$/i);
  const businessType = clean(match?.[1] || query);
  const location = clean(match?.[2] || 'Lagos, Nigeria');
  return { raw, businessType, location, wantsNoWebsite, keywords: tokenize(businessType) };
}

export function osmClause(type) {
  const normalizedType = type.toLowerCase();
  if (/school|academy|college|university|education|nursery|montessori/.test(normalizedType)) return '["amenity"~"^(school|college|university|kindergarten)$"]';
  if (/real estate|property|realtor|estate agent/.test(normalizedType)) return '["office"="estate_agent"]';
  if (/restaurant|cafe|food|eatery|bakery/.test(normalizedType)) return '["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]';
  if (/clinic|hospital|medical|doctor|dentist|pharmacy|health/.test(normalizedType)) return '["amenity"~"^(clinic|hospital|doctors|dentist|pharmacy)$"]';
  if (/salon|barber|beauty|hair|spa/.test(normalizedType)) return '["shop"~"^(hairdresser|beauty|massage)$"]';
  if (/hotel|guest house|hostel|resort/.test(normalizedType)) return '["tourism"~"^(hotel|guest_house|hostel|resort)$"]';
  if (/gym|fitness/.test(normalizedType)) return '["leisure"="fitness_centre"]';
  if (/computer|electronics/.test(normalizedType)) return '["shop"~"^(computer|electronics|mobile_phone)$"]';
  const safe = type.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 2).slice(0, 3).join('|') || 'business';
  return `["name"~"${safe}",i][~"^(shop|office|amenity|tourism|leisure)$"~"."]`;
}

export function normalizeLead(lead) {
  return {
    id: lead.id || hash(`${lead.title}|${lead.phone}|${lead.website}|${lead.address}`),
    title: clean(lead.title || lead.name || 'Unnamed business'),
    categoryName: clean(lead.categoryName || lead.category || ''),
    address: clean(lead.address || ''),
    city: clean(lead.city || ''),
    state: clean(lead.state || ''),
    countryCode: clean(lead.countryCode || 'NG'),
    phone: clean(lead.phone || ''),
    phoneUnformatted: digits(lead.phone),
    email: clean(lead.email || lead.emails?.[0] || ''),
    website: clean(lead.website || ''),
    sourceUrl: clean(lead.sourceUrl || lead.url || ''),
    description: clean(lead.description || ''),
    latitude: lead.latitude ?? null,
    longitude: lead.longitude ?? null,
    discoverySource: clean(lead.discoverySource || ''),
    rawTags: lead.rawTags || null,
    websiteStatus: lead.websiteStatus || 'unchecked',
    websiteConfidence: lead.websiteConfidence || 0
  };
}

export function dedupeLeads(items) {
  const leads = new Map();
  for (const item of items) {
    const lead = normalizeLead(item);
    const key = lead.phoneUnformatted
      ? `p:${lead.phoneUnformatted}`
      : lead.website
        ? `w:${safeHost(lead.website)}`
        : `n:${norm(lead.title)}:${norm(lead.city || lead.address)}`;
    leads.set(key, leads.has(key) ? merge(leads.get(key), lead) : lead);
  }
  return [...leads.values()];
}

export function relevanceScore(lead, intent) {
  const searchable = `${lead.title} ${lead.categoryName} ${lead.description}`.toLowerCase();
  let score = 0;
  for (const keyword of intent.keywords) if (searchable.includes(keyword)) score += 5;
  if (lead.phone) score += 2;
  if (lead.address || lead.city) score += 1;
  return score || 1;
}

export function opportunityScore(lead) {
  let score = 35;
  if (lead.phone) score += 28;
  else score -= 15;
  if (lead.websiteStatus === 'not_found') score += 28;
  if (lead.websiteStatus === 'uncertain') score += 15;
  if (lead.websiteStatus === 'verified') score -= 18;
  if (lead.address || lead.city) score += 5;
  if (lead.email) score += 3;
  return Math.max(0, Math.min(100, score));
}

export function generateMessage(lead, intent) {
  const type = clean(lead.categoryName || intent.businessType || 'business').toLowerCase();
  const location = clean(lead.city || lead.state || intent.location);
  const angle = businessAngle(type);
  const websiteContext = lead.websiteStatus === 'verified'
    ? 'I also checked your current website and noticed a few opportunities to make the online experience clearer and more conversion-focused.'
    : lead.websiteStatus === 'not_found'
      ? 'I couldn’t find a clear standalone website for the business, so I had an idea that could give customers one reliable place to see what you offer and contact you.'
      : 'I had an idea for improving how the business is presented online.';
  return `Hi 👋\n\nI came across ${lead.title}${location ? ` in ${location}` : ''}. I’m Gojo from GOJO.DEV, and I build practical websites for businesses.\n\n${websiteContext} For a ${type}, a focused site could ${angle}.\n\nWould you be open to me sending a quick idea of what I have in mind? No pressure.`;
}

export function tokenize(value) {
  return [...new Set(String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(word => word.length > 1 && !['the', 'and', 'for', 'with', 'private', 'business', 'businesses'].includes(word)))];
}

export function norm(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function safeHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function merge(first, second) {
  const merged = { ...first };
  for (const key of ['title', 'categoryName', 'address', 'city', 'state', 'countryCode', 'phone', 'email', 'website', 'sourceUrl', 'description', 'discoverySource']) {
    if (clean(second[key]).length > clean(merged[key]).length) merged[key] = second[key];
  }
  if (!merged.latitude && second.latitude) merged.latitude = second.latitude;
  if (!merged.longitude && second.longitude) merged.longitude = second.longitude;
  return merged;
}

function businessAngle(type) {
  if (/school|education|college|academy/.test(type)) return 'present admissions, programmes and enquiry information clearly to parents and students';
  if (/real estate|property|estate/.test(type)) return 'show available properties and turn interested visitors into inspection enquiries';
  if (/restaurant|cafe|food/.test(type)) return 'put menus, location, ordering and customer enquiries in one easy place';
  if (/clinic|medical|hospital|health|pharmacy/.test(type)) return 'make services, location and appointment enquiries easier to find';
  if (/salon|beauty|hair|barber/.test(type)) return 'show services and work clearly while making bookings easier';
  if (/hotel|guest|resort/.test(type)) return 'show rooms, facilities and booking enquiries in a trustworthy mobile-friendly way';
  return 'explain what you offer clearly and turn interested visitors into direct enquiries';
}

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return `lead_${(result >>> 0).toString(36)}`;
}
