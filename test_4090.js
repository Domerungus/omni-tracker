const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { scrapeSalidzini } = require('./scrapers/salidzini');
const { scrapeSS } = require('./scrapers/ss');
const { scrapeAmazon } = require('./scrapers/amazon');

const component = {
  name: 'Nvidia RTX 4090 (24GB)',
  target_price: 1800,
  search_keywords_salidzini: 'RTX 4090',
  search_keywords_amazon: 'Nvidia RTX 4090 24GB',
  positive_keywords: '4090',
  negative_keywords: 'dators, datoru, block, priekš, cable, waterblock'
};

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  
  const dynamicFloor = 810;
  
  console.log('Testing Salidzini...');
  const salidzini = await scrapeSalidzini(page, component, dynamicFloor);
  console.log('Salidzini Offers:', salidzini);
  
  console.log('Testing SS...');
  const ss = await scrapeSS(page, component, dynamicFloor);
  console.log('SS Offers:', ss);

  console.log('Testing Amazon...');
  const amazon = await scrapeAmazon(page, component, dynamicFloor);
  console.log('Amazon Offers:', amazon);

  await browser.close();
})();
