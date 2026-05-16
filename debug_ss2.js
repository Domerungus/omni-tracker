const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { hasPositiveKeyword, hasNegativeKeyword } = require('./scrapers/helpers');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://www.ss.com/ru/search-result/?q=Ryzen+9+9950X');
  try {
    await page.waitForSelector('tr[id^="tr_"]', { timeout: 3000 });
    const rowLink = await page.evaluate(() => document.querySelector('tr[id^="tr_"] a[href*="/msg/"]')?.href);
    const rowTitle = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('tr[id^="tr_"]')[0].querySelectorAll('td')].map((cell) => cell.innerText?.trim() || '');
        return cells.find((cell) => cell.length > 20 && !/\\d+\\s*€/.test(cell)) || '';
    });
    
    if (rowLink) {
      await page.goto(rowLink);
      const text = await page.evaluate(() => document.querySelector('#msg_div_msg')?.innerText || '');
      const body = await page.evaluate(() => document.body.innerText || '');
      const hasPos = hasPositiveKeyword(body, '9950x');
      const hasNeg = hasNegativeKeyword(rowTitle + ' ' + text, 'dators, datoru, desktop, priekš, ūdens, dzesētājs, monoblock, waterblock');
      console.log('Pos?', hasPos);
      console.log('Neg?', hasNeg);
      if(hasNeg) {
          const negWords = 'dators, datoru, desktop, priekš, ūdens, dzesētājs, monoblock, waterblock'.split(',').map(s=>s.trim());
          for (const word of negWords) {
              if (hasNegativeKeyword(rowTitle + ' ' + text, word)) console.log('MATCHED NEG:', word);
          }
      }
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
  await browser.close();
})();
