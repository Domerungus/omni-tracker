const { NAVIGATION_TIMEOUT_MS, RESULTS_TIMEOUT_MS } = require('./config');
const { hasNegativeKeyword, hasPositiveKeyword, isUsedCondition } = require('./helpers');

const SALIDZINI_SEARCH = 'https://www.salidzini.lv/cena';

async function scrapeSalidzini(page, component, dynamicFloor) {
  const query = component.search_keywords_salidzini;
  const searchUrl = `${SALIDZINI_SEARCH}?q=${encodeURIComponent(query)}`;

  try {
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'lv-LV,lv;q=0.9',
      'Referer': 'https://www.google.com/',
    });

    let response = await page.goto(searchUrl, {
      waitUntil: 'load',
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    // Если получили пустую страницу, пробуем обновить один раз
    const isEmpty = await page.evaluate(() => !document.body || document.body.innerText.trim().length < 10);
    if (isEmpty) {
      console.log('    ⏳ Salidzini.lv: Пустая страница, пробую обновить...');
      await new Promise(r => setTimeout(r, 3000));
      response = await page.reload({ waitUntil: 'load' });
    }

    console.log(`    ℹ️  Salidzini.lv: HTTP ${response?.status() || 'unknown'}`);

    await new Promise(r => setTimeout(r, 3000));

    await page.waitForSelector('.item_box_main', {
      timeout: RESULTS_TIMEOUT_MS,
    });
  } catch (err) {
    const pageTitle = await page.title();
    const content = await page.evaluate(() => document.body?.innerText?.substring(0, 300) || 'EMPTY BODY');
    const url = page.url();
    
    console.log(`    ⚠️  Salidzini.lv: Failed to load results.`);
    console.log(`       URL: ${url}`);
    console.log(`       Title: "${pageTitle}"`);
    console.log(`       Snippet: ${content.replace(/\n/g, ' ')}`);
    return [];
  }

  const offers = await page.evaluate(() => {
    function parsePrice(text) {
      const match = (text || '').match(/(\d[\d\s]*[,.]\d{2})/);
      if (!match) return null;
      const normalized = match[1].replace(/\s/g, '').replace(',', '.');
      return parseFloat(normalized);
    }

    function getShopName(box) {
      const shopNameEl = box.querySelector('.item_shop_name');
      if (shopNameEl?.textContent?.trim()) {
        return shopNameEl.textContent.trim();
      }

      const shopLink = box.querySelector('a.item_shop_frame, a[href*="veikals"]');
      if (!shopLink) return 'Unknown';

      const href = shopLink.getAttribute('href') || '';
      const match = href.match(/veikals\/([^?#/]+)/i);
      if (match) return decodeURIComponent(match[1]);

      const text = (shopLink.textContent || '').trim();
      return text.split(/\s+/)[0] || 'Unknown';
    }

    const items = [];

    for (const box of document.querySelectorAll('.item_box_main')) {
      const priceText = box.querySelector('.item_price')?.innerText || '';
      const priceMatch = priceText.match(/[\d.,]+/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[0].replace(',', '.'));
      if (Number.isNaN(price)) continue;

      const productLink =
        box.querySelector('a[href*="click.php"]') ||
        box.querySelector('a[href*="/rek"]') ||
        box.querySelector('.item_box_sub a[href]');

      let url = productLink?.getAttribute('href') || '';
      if (!url) continue;

      if (url.startsWith('/')) {
        url = `${location.origin}${url}`;
      }

      // Clean title: take first line and remove breadcrumbs
      let title = (productLink?.textContent || '').trim().split('\n')[0];
      title = title.split('«')[0].split('<')[0].trim();

      items.push({
        shop_name: getShopName(box),
        price,
        url,
        title,
        source: 'salidzini.lv',
      });
    }

    return items;
  });

  const validItems = [];
  for (const item of offers) {
    if (dynamicFloor && item.price < dynamicFloor) continue;
    if (isUsedCondition(item.title)) continue;
    validItems.push(item);
  }

  const sortedOffers = validItems.sort((a, b) => a.price - b.price);
  const validOffers = [];

  for (const offer of sortedOffers) {
    try {
      await page.goto(offer.url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      // Wait for dynamic content to render (descriptions, price blocks, etc.)
      await new Promise((r) => setTimeout(r, 2000));

      const pageData = await page.evaluate(() => {
        const h1 = document.querySelector('h1')?.innerText || '';
        const bodyText = document.body.innerText || '';
        return {
          coreText: h1,
          bodyText
        };
      });
      
      const hasPos = hasPositiveKeyword(pageData.bodyText, component.positive_keywords);
      const hasNeg = hasNegativeKeyword(offer.title + ' ' + pageData.coreText, component.negative_keywords);
      const isUsed = isUsedCondition(offer.title + ' ' + pageData.coreText);

      if (hasPos && !hasNeg && !isUsed) {
        validOffers.push(offer);
        if (validOffers.length >= 3) break;
      } else {
        console.log(`      [Skip] ${offer.shop_name}: Failed keyword check. hasPos: ${hasPos}, hasNeg: ${hasNeg}, isUsed: ${isUsed}`);
      }
    } catch (err) {
      console.log(`      [Skip] ${offer.shop_name}: Could not load page.`);
    }
  }

  return validOffers;
}

module.exports = {
  scrapeSalidzini,
};
