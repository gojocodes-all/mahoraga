import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeLeads,
  generateMessage,
  normalizeLead,
  opportunityScore,
  osmClause,
  parseIntent,
  relevanceScore
} from '../src/lead-domain.js';

test('parseIntent separates the business, location, and website requirement', () => {
  assert.deepEqual(parseIntent('private schools in Ikeja without websites'), {
    raw: 'private schools in Ikeja without websites',
    businessType: 'private schools',
    location: 'Ikeja',
    wantsNoWebsite: true,
    keywords: ['schools']
  });
});

test('parseIntent uses the documented default location', () => {
  assert.deepEqual(parseIntent('salons'), {
    raw: 'salons',
    businessType: 'salons',
    location: 'Lagos, Nigeria',
    wantsNoWebsite: false,
    keywords: ['salons']
  });
});

test('osmClause maps known industries and safely builds a generic query', () => {
  assert.equal(osmClause('real estate agents'), '["office"="estate_agent"]');
  assert.equal(osmClause('solar & energy'), '["name"~"solar|energy",i][~"^(shop|office|amenity|tourism|leisure)$"~"."]');
});

test('dedupeLeads merges records with the same phone and keeps richer fields', () => {
  const leads = dedupeLeads([
    { title: 'Ada Cafe', phone: '+234 801 234 5678', city: 'Ikeja' },
    { title: 'Ada Cafe', phone: '+234 801 234 5678', address: '12 Allen Avenue, Ikeja', website: 'https://ada.example' }
  ]);

  assert.equal(leads.length, 1);
  assert.equal(leads[0].address, '12 Allen Avenue, Ikeja');
  assert.equal(leads[0].website, 'https://ada.example');
});

test('normalization, relevance, and opportunity scoring remain deterministic', () => {
  const lead = normalizeLead({
    title: '  Bright   Future School ',
    categoryName: 'Schools',
    phone: '0801 234 5678',
    city: 'Ikeja',
    email: 'hello@example.test',
    websiteStatus: 'not_found'
  });
  const intent = parseIntent('schools in Ikeja');

  assert.equal(lead.title, 'Bright Future School');
  assert.equal(lead.phoneUnformatted, '08012345678');
  assert.equal(relevanceScore(lead, intent), 8);
  assert.equal(opportunityScore(lead), 99);
  assert.equal(opportunityScore({ phone: '08012345678', city: 'Ikeja', websiteStatus: 'verified' }), 50);
});

test('generateMessage uses the matching business context', () => {
  const message = generateMessage(
    { title: 'Bright Future', categoryName: 'School', city: 'Ikeja', websiteStatus: 'not_found' },
    parseIntent('schools in Ikeja without websites')
  );

  assert.match(message, /Bright Future in Ikeja/);
  assert.match(message, /couldn’t find a clear standalone website/);
  assert.match(message, /present admissions, programmes and enquiry information/);
});
