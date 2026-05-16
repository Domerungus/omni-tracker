const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { hasPositiveKeyword, hasNegativeKeyword } = require('./scrapers/helpers');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://www.zauers.lv/search?q=9950x');
  try {
    const link = await page.evaluate(() => document.querySelector('.product-item a')?.href || document.querySelector('a[href*=\"product\"]')?.href);
    console.log('Zauers link:', link);
    if(link) {
        await page.goto(link);
        await new Promise(r => setTimeout(r, 2000));
        const pageData = await page.evaluate(() => {
            const h1 = document.querySelector('h1')?.innerText || '';
            const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
            const bodyText = document.body.innerText || '';
            return { coreText: document.title + ' ' + h1 + ' ' + metaDesc, bodyText };
        });
        const hasPos = hasPositiveKeyword(pageData.bodyText, '9950x');
        const hasNeg = hasNegativeKeyword('Ryzen 9 9950X ' + pageData.coreText, 'dators, datoru, priekš, ūdens, dzesētājs, monoblock, waterblock');
        console.log('Pos?', hasPos);
        console.log('Neg?', hasNeg);
        if (hasNeg) {
             const negWords = 'dators, datoru, priekš, ūdens, dzesētājs, monoblock, waterblock'.split(',').map(s=>s.trim());
             for(const w of negWords) if(hasNegativeKeyword('Ryzen 9 9950X ' + pageData.coreText, w)) console.log('Matched Neg:', w);
        }
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
  await browser.close();
})();
