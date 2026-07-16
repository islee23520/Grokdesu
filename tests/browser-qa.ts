import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const base = process.env.OMONATIVE_BASE_URL ?? 'http://127.0.0.1:8791';
const codes = (process.env.OMONATIVE_PAIRING_CODES ?? '').split(',').map(code => code.trim()).filter(Boolean);
const title = 'Omonative final live Senpi';
if (codes.length < 2) throw new Error('OMONATIVE_PAIRING_CODES requires two comma-separated one-use codes; they are never written to evidence');

await mkdir('.omo/evidence/omonative/C5-ui', {recursive: true});
for (const [index, [name, viewport]] of Object.entries({desktop: {width: 1440, height: 900}, mobile: {width: 390, height: 844}}).entries()) {
  const code = codes[index]!;
  const browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport});
  const log: string[] = [];
  page.on('console', message => log.push(`console ${message.type()}: ${message.text()}`));
  page.on('pageerror', error => log.push(`pageerror: ${error.message}`));
  page.on('requestfailed', request => log.push(`requestfailed: ${request.failure()?.errorText ?? 'unknown'} ${request.method()} ${request.url()}`));
  try {
    await page.goto(base, {waitUntil: 'networkidle'});
    await page.getByLabel('Pairing code').fill(code);
    await page.getByRole('button', {name: 'Pair this device'}).click();
    const sessionButtons = page.getByRole('button', {name: /Omonative final live Senpi/i});
    await sessionButtons.first().waitFor({state: 'visible'});
    const sessionCount = await sessionButtons.count();
    let selectedSession = false;
    for (let i = sessionCount - 1; i >= 0; i--) {
      const candidate = sessionButtons.nth(i);
      await candidate.waitFor({state: 'visible'});
      await candidate.click();
      try {
        await page.getByText('REMOTE_OK', {exact: true}).last().waitFor({state: 'visible', timeout: 1500});
        selectedSession = true;
        break;
      } catch {
        continue;
      }
    }
    if (!selectedSession) throw new Error(`no Senpi session with REMOTE_OK transcript found among ${sessionCount} candidates`);
    await page.getByRole('textbox', {name: 'Message'}).waitFor({state: 'visible'});
    await page.getByRole('button', {name: 'Cancel'}).waitFor({state: 'visible'});
    await page.getByText('senpi', {exact: true}).last().waitFor({state: 'visible'});
    await page.getByText('Ready', {exact: true}).waitFor({state: 'visible'});
    const noHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    if (!noHorizontalOverflow) throw new Error('viewport has horizontal overflow');
    await page.screenshot({path: `.omo/evidence/omonative/C5-ui/${name === 'desktop' ? 'final-desktop' : 'final-mobile'}.png`, fullPage: true});
    await Bun.write(`.omo/evidence/omonative/C5-ui/${name}-actions.txt`, [
      `viewport ${viewport.width}x${viewport.height}`,
      `selected ${title}`,
      'observed REMOTE_OK transcript, composer, Senpi provider badge, Ready connection state, and Cancel visibility',
      `no horizontal overflow: ${noHorizontalOverflow}`,
      ...log,
    ].join('\n'));
    const unexpected = log.filter(entry => !entry.startsWith('console '));
    if (unexpected.some(entry => entry.startsWith('pageerror:') || entry.startsWith('requestfailed:'))) {
      throw new Error(`unexpected browser errors: ${unexpected.join(' | ')}`);
    }
  } finally {
    await browser.close();
  }
}
