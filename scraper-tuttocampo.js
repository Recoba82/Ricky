const { chromium } = require('playwright');
const fs = require('fs');

const USERNAME = 'sportconsult';
const PASSWORD = 'viterbo1908';
const OUTPUT_FILE = 'societa_sportive.json';
const DETTAGLI_FILE = 'societa_dettagli.json';

const PROVINCE = [
  { nome: 'Viterbo',   base: 'https://www.tuttocampo.it/Lazio/VT' },
  { nome: 'Roma',      base: 'https://www.tuttocampo.it/Lazio/RM' },
  { nome: 'Frosinone', base: 'https://www.tuttocampo.it/Lazio/FR' },
  { nome: 'Latina',    base: 'https://www.tuttocampo.it/Lazio/LT' },
  { nome: 'Rieti',     base: 'https://www.tuttocampo.it/Lazio/RI' },
];

async function getCampionatiLinks(page, baseUrl, provincia) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const CATEGORIE = ['SerieD', 'Eccellenza', 'Promozione', 'PrimaCategoria', 'SecondaCategoria', 'TerzaCategoria'];
  const links = await page.evaluate((base, categorie) => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(h => h.includes(base) && h.includes('/Risultati') && categorie.some(c => h.includes(c)));
  }, baseUrl, CATEGORIE);
  console.log(`  ${provincia}: trovati ${links.length} campionati`);
  return links;
}

async function extractSquadre(page, campionatoUrl, provincia) {
  const squadreUrl = campionatoUrl.replace('/Risultati', '/Squadre');
  try {
    await page.goto(squadreUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    const societa = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('table tbody tr'))
        .map(row => ({
          nome: row.querySelector('a')?.innerText?.trim(),
          link: row.querySelector('a')?.href || '',
          celle: Array.from(row.querySelectorAll('td')).map(c => c.innerText?.trim()).filter(Boolean)
        }))
        .filter(s => s.nome && s.nome.length > 1);
    });

    if (societa.length === 0) {
      const alt = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href*="Societa"], a[href*="Squadra"]'))
          .map(a => ({ nome: a.innerText?.trim(), link: a.href }))
          .filter(s => s.nome && s.nome.length > 1);
      });
      return alt.map(s => ({ ...s, campionato: squadreUrl, provincia }));
    }

    return societa.map(s => ({ ...s, campionato: squadreUrl, provincia }));
  } catch(e) {
    return [];
  }
}

async function extractDettagliSocieta(page, societa) {
  if (!societa.link || !societa.link.includes('tuttocampo')) return societa;

  try {
    await page.goto(societa.link, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1500);

    const dettagli = await page.evaluate(() => {
      const get = (sel) => document.querySelector(sel)?.innerText?.trim() || '';

      const info = {};

      // Nome / intestazione
      info.nome_completo = get('h1, .team-name, .club-name, [class*="title"]');

      // Indirizzo
      const indirizzoEl = document.querySelector('[class*="address"], [class*="indirizzo"], [itemprop="address"]');
      info.indirizzo = indirizzoEl?.innerText?.trim() || '';

      // Telefono e cellulare (tutti i link tel: nel documento)
      const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
      const numeri = telLinks.map(a => a.getAttribute('href').replace('tel:', '').trim()).filter(Boolean);
      info.telefono = numeri[0] || '';
      info.cellulare = numeri[1] || '';
      if (!info.telefono) {
        const telEl = document.querySelector('[class*="phone"], [class*="telefono"], [class*="tel"]');
        info.telefono = telEl?.innerText?.trim() || '';
      }

      // Email
      const emailEl = document.querySelector('a[href^="mailto:"], [class*="email"]');
      info.email = emailEl?.innerText?.trim() || emailEl?.getAttribute('href')?.replace('mailto:', '') || '';

      // Sito web
      const sitoEl = document.querySelector('a[href^="http"]:not([href*="tuttocampo"])');
      info.sito_web = sitoEl?.href || '';

      // Presidente / dirigenti
      const presEl = document.querySelector('[class*="president"], [class*="presidente"], [class*="dirigent"]');
      info.presidente = presEl?.innerText?.trim() || '';

      // Colori sociali — cerca label "Colori" e legge valore accanto
      let colori = '';
      document.querySelectorAll('td, li, div, span').forEach(el => {
        const txt = el.innerText?.trim().toLowerCase();
        if (txt && (txt === 'colori' || txt === 'colori sociali' || txt.startsWith('colori:'))) {
          const next = el.nextElementSibling;
          colori = colori || (next?.innerText?.trim()) || el.innerText?.replace(/colori\s*(sociali)?[:]*\s*/i, '').trim() || '';
        }
      });
      if (!colori) {
        const coloriEl = document.querySelector('[class*="color"], [class*="colori"]');
        colori = coloriEl?.innerText?.trim() || '';
      }
      info.colori_sociali = colori;

      // Sponsor tecnico
      let sponsor = '';
      document.querySelectorAll('td, li, div, span').forEach(el => {
        const txt = el.innerText?.trim().toLowerCase();
        if (txt && (txt === 'sponsor tecnico' || txt.startsWith('sponsor tecnico:') || txt === 'fornitore tecnico')) {
          const next = el.nextElementSibling;
          sponsor = sponsor || (next?.innerText?.trim()) || el.innerText?.replace(/sponsor\s*tecnico[:]*\s*/i, '').trim() || '';
        }
      });
      if (!sponsor) {
        const sponsorImg = document.querySelector('[class*="sponsor"] img, [alt*="sponsor"], [alt*="kit"], [title*="sponsor"]');
        sponsor = sponsorImg?.getAttribute('alt') || sponsorImg?.getAttribute('title') || '';
      }
      info.sponsor_tecnico = sponsor;

      // Anno fondazione
      const fondEl = document.querySelector('[class*="found"], [class*="fondaz"], [class*="anno"]');
      info.fondazione = fondEl?.innerText?.trim() || '';

      // Tutte le righe info come fallback grezzo
      const tuttiInfo = Array.from(document.querySelectorAll('.info-row, .detail-row, .team-info tr, [class*="info"] td'))
        .map(el => el.innerText?.trim())
        .filter(Boolean);
      info.info_aggiuntive = tuttiInfo;

      return info;
    });

    return { ...societa, ...dettagli };
  } catch(e) {
    return societa;
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await (await browser.newContext({ locale: 'it-IT' })).newPage();
  const tutteSocieta = [];

  try {
    console.log('Apro tuttocampo.it - fai il LOGIN...');
    await page.goto('https://www.tuttocampo.it/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loginLink = page.locator('a:has-text("Accedi"), a:has-text("Login"), a[href*="login"]').first();
    if (await loginLink.count() > 0) {
      await loginLink.click();
      await page.waitForTimeout(1500);
      await page.fill('input[name="username"], input[type="text"]', USERNAME);
      await page.fill('input[type="password"]', PASSWORD);
      await page.click('button[type="submit"], input[type="submit"]');
      await page.waitForTimeout(2000);
    }
    await page.waitForFunction(() => !!document.querySelector('a[href*="Logout"]'), { timeout: 30000 })
      .catch(() => console.log('Login non rilevato - procedo comunque...'));
    console.log('Login OK!\n');

    console.log('=== FASE 1: Raccolta lista società ===');
    for (const { nome, base } of PROVINCE) {
      console.log(`\n--- ${nome} ---`);
      const campionati = await getCampionatiLinks(page, base, nome);
      for (const url of campionati) {
        const societa = await extractSquadre(page, url, nome);
        if (societa.length > 0) {
          console.log(`  ${url.split('/').slice(-2).join('/')}: ${societa.length} società`);
          tutteSocieta.push(...societa);
        }
      }
    }

    const uniche = Object.values(
      tutteSocieta.reduce((acc, s) => {
        const key = s.link || s.nome;
        if (key && !acc[key]) acc[key] = s;
        return acc;
      }, {})
    );

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(uniche, null, 2));
    console.log(`\n✓ Fase 1 completa: ${uniche.length} società uniche trovate`);

    console.log('\n=== FASE 2: Estrazione dettagli società ===');
    const conDettagli = [];
    for (let i = 0; i < uniche.length; i++) {
      const s = uniche[i];
      if (i % 50 === 0) console.log(`  Progresso: ${i}/${uniche.length}...`);
      const dettaglio = await extractDettagliSocieta(page, s);
      conDettagli.push(dettaglio);

      if (i % 100 === 99) {
        fs.writeFileSync(DETTAGLI_FILE, JSON.stringify(conDettagli, null, 2));
      }
    }

    fs.writeFileSync(DETTAGLI_FILE, JSON.stringify(conDettagli, null, 2));
    console.log(`\n✓ Fatto! Dettagli di ${conDettagli.length} società salvati in ${DETTAGLI_FILE}`);

  } catch(e) {
    console.error('Errore:', e.message);
  } finally {
    await browser.close();
  }
}

main();