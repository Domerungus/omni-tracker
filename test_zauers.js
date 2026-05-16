const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { hasPositiveKeyword, hasNegativeKeyword } = require('./scrapers/helpers');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // URL from salidzini for Ryzen 9 9950X zauers.lv
  // I'll try to find it from salidzini results first
  console.log('Searching Salidzini for Ryzen 9 9950X...');
  await page.goto('https://www.salidzini.lv/cena?q=Ryzen+9+9950X', { waitUntil: 'networkidle2' });
  
  const offers = await page.evaluate(() => {
    return [...document.querySelectorAll('.item_box_main')].map(el => {
      const shop = el.querySelector('.item_shop_name')?.innerText.trim();
      const title = el.querySelector('.item_name a')?.innerText.trim();
      const href = el.querySelector('.item_name a')?.href;
      return { shop, title, href };
    });
  });
  
  const zauersOffer = offers.find(o => o.shop && o.shop.toLowerCase().includes('zauers'));
  
  if (!zauersOffer) {
    console.log('Zauers.lv not found in Salidzini results.');
    await browser.close();
    return;
  }
  
  console.log('Found Zauers.lv offer:', zauersOffer);
  
  console.log('Navigating to product page...');
  await page.goto(zauersOffer.href, { waitUntil: 'domcontentloaded' });
  // Wait a bit for async content just in case
  await new Promise(r => setTimeout(r, 2000));
  
  const pageData = await page.evaluate(() => {
    const h1 = document.querySelector('h1')?.innerText || '';
    const bodyText = document.body.innerText || '';
    return {
      title: document.title,
      h1,
      bodyText
    };
  });
  
  const posKeywords = '9950x';
  const negKeywords = 'dators, datoru, priekš, ūdens, dzesētājs, monoblock, waterblock';
  
  const hasPos = hasPositiveKeyword(pageData.bodyText, posKeywords);
  const hasNeg = hasNegativeKeyword(zauersOffer.title + ' ' + pageData.h1, negKeywords);
  
  console.log('Results:');
  console.log('- Title from Salidzini:', zauersOffer.title);
  console.log('- H1 from Page:', pageData.h1);
  console.log('- Body text length:', pageData.bodyText.length);
  console.log('- Has Positive (9950x):', hasPos);
  console.log('- Has Negative:', hasNeg);
  
  if (hasNeg) {
    const negWords = negKeywords.split(',').map(s => s.trim());
    for (const word of negWords) {
      const regex = new RegExp(`(?<!\\p{L}|\\p{N})${word}(?!\\p{L}|\\p{N})`, 'ui');
      if (regex.test(zauersOffer.title + ' ' + pageData.h1)) {
        console.log('  Matched negative word:', word);
      }
    }
  }
  
  // Print a snippet of body text where 9950x might be
  const index = pageData.bodyText.toLowerCase().indexOf('9950x');
  if (index !== -1) {
    console.log('Snippet around 9950x:', pageData.bodyText.substring(index - 20, index + 20));
  } else {
    console.log('9950x NOT FOUND in body text.');
    // Check if it's there without word boundaries
    if (pageData.bodyText.toLowerCase().includes('9950x')) {
       console.log('9950x IS FOUND but maybe regex failed?');
    }
  }

  await browser.close();
})();
