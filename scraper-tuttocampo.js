const { chromium } = require('playwright');
const fs = require('fs');

const USERNAME = 'Sportconsult';
const PASSWORD = 'viterbo1908';
const OUTPUT_FILE = 'societa_sportive.json';

async function login(page) {
  await page.goto('https://www.tuttocampo.it/', { waitUntil: 'networkidle' });
  const loginLink = page.locator('a[href*="login"], a:has-text("Accedi"), a:has-text("Login")').first();
  await loginLink.click();
  await page.waitForLoadState('networkidle');
  await page.fill('input[name="username"], input[type="text"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"], input[type="submit"]');
  await page.waitForLoadState('networkidle');
}

async function extractSocieta(page) {
  const societa = [];
  let pagina = 1;
  while (true) {
    await page.waitForTimeout(1000);
    const items = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('table tbody tr, [class*="societa"], [class*="team"]')).map(row => ({
        dati: Array.from(row.querySelectorAll('td, span, h3, h4')).map(c => c.innerText?.trim()).filter(Boolean),
        link: row.querySelector('a')?.href || ''
      })).filter(i => i.dati.length > 0);
    });
    if (items.length === 0) { fs.writeFileSync('debug.html', await page.content()); break; }
    societa.push(...items);
    console.log(`Pagina ${pagina}: ${items.length} società (tot: ${societa.length})`);
    const next = page.locator('a:has-text("Successiva"), a:has-text("Avanti"), a[rel="next"]').first();
    if (!await next.count()) break;
    if (await next.evaluate(el => el.classList.contains('disabled'))) break;
    await next.click();
    await page.waitForLoadState('networkidle');
    if (++pagina > 100) break;
  }
  return societa;
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await (await browser.newContext({ locale: 'it-IT' })).newPage();
  try {
    await login(page);
    await page.goto('https://www.tuttocampo.it/Web/Societa/Index', { waitUntil: 'networkidle' });
    const societa = await extractSocieta(page);
    if (societa.length) { fs.writeFileSync(OUTPUT_FILE, JSON.stringify(societa, null, 2)); console.log(`Done! ${societa.length} società → ${OUTPUT_FILE}`); }
    else console.log('Nessun dato. Vedi debug.html');
  } catch(e) { console.error(e.message); await page.screenshot({ path: 'error.png' }); }
  finally { await browser.close(); }
}

main();
