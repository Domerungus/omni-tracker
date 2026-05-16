const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://www.ss.com/ru/search-result/?q=Ryzen+9+9950X');
  try {
    await page.waitForSelector('tr[id^="tr_"]', { timeout: 3000 });
    const link = await page.evaluate(() => document.querySelector('tr[id^="tr_"] a[href*="/msg/"]').href);
    if (link) {
      await page.goto(link);
      const text = await page.evaluate(() => document.querySelector('#msg_div_msg')?.innerText || '');
      const body = await page.evaluate(() => document.body.innerText || '');
      console.log('Ad text:', text.substring(0, 100));
      console.log('Pos 9950x in body?', /(?<!\p{L}|\p{N})9950x(?!\p{L}|\p{N})/ui.test(body));
      console.log('Pos 9950x in text?', /(?<!\p{L}|\p{N})9950x(?!\p{L}|\p{N})/ui.test(text));
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
  await browser.close();
})();
