const { NAVIGATION_TIMEOUT_MS, RESULTS_TIMEOUT_MS } = require('./config');
const { hasNegativeKeyword, hasPositiveKeyword, parseEuroPrice, isUsedCondition } = require('./helpers');

const AMAZON_SEARCH = 'https://www.amazon.de/s?k=';
const AMAZON_ORIGIN = 'https://www.amazon.de';


function normalizeAmazonUrl(href) {
  if (!href || href.includes('/sspa/')) {
    return null;
  }

  let url = href;

  if (url.startsWith('/')) {
    url = `${AMAZON_ORIGIN}${url}`;
  }

  return url;
}

async function scrapeAmazon(page, component, dynamicFloor) {
  const query = component.search_keywords_amazon;
  if (!query) return [];

  const searchUrl = `${AMAZON_SEARCH}${encodeURIComponent(query).replace(/%20/g, '+')}`;

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  await page.waitForSelector('.s-result-item', { timeout: RESULTS_TIMEOUT_MS });

  const rawItems = await page.evaluate(() => {
    const items = [];

    for (const item of document.querySelectorAll('.s-result-item[data-asin]')) {
      const asin = item.getAttribute('data-asin');
      if (!asin) continue;

      const titleLink = item.querySelector('h2 a') || item.querySelector('a.a-link-normal');
      if (!titleLink) continue;

      const href = titleLink.getAttribute('href') || '';
      if (href.includes('/sspa/')) continue;

      const titleEl = item.querySelector('h2 a span') || item.querySelector('.a-text-normal') || item.querySelector('h2');
      const title = titleEl ? titleEl.textContent.trim() : '';

      const priceEl = item.querySelector('span.a-price > span.a-offscreen') || item.querySelector('.a-price');
      if (!priceEl) continue;
      
      const priceText = priceEl.textContent || priceEl.innerText || '';
      // We can't access parseEuroPrice here because this code runs INSIDE the browser (page.evaluate)!
      // So we must use a client-side parser, or extract the raw text and parse it outside.
      
      items.push({
        href,
        title,
        priceText: priceText.trim(),
        asin
      });
    }

    return items;
  });

  const validItems = [];

  for (const item of rawItems) {
    const price = parseEuroPrice(item.priceText);
    if (!price || Number.isNaN(price)) continue;
    item.price = price;
    
    if (dynamicFloor && item.price < dynamicFloor) continue;
    // Pre-filter based on search result title to avoid obvious wrong variants (e.g. 1TB when searching 2TB)
    if (!hasPositiveKeyword(item.title, component.positive_keywords)) {
      continue;
    }

    const url = normalizeAmazonUrl(item.href);
    if (!url) continue;

    validItems.push({
      shop_name: 'amazon.de',
      price: item.price,
      url,
      source: 'amazon.de',
      title: item.title,
    });
  }

  const sortedOffers = validItems.sort((a, b) => a.price - b.price);
  const finalOffers = [];

  for (const offer of sortedOffers) {
    try {
      await page.goto(offer.url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      // Wait for variations and descriptions to load
      await new Promise((r) => setTimeout(r, 2000));

      const pageData = await page.evaluate(() => {
        const title = document.querySelector('#productTitle')?.innerText || '';
        const bullets = document.querySelector('#feature-bullets')?.innerText || '';
        const desc = document.querySelector('#productDescription')?.innerText || '';
        
        // Extract price from product page (more reliable for variations)
        let priceText = '';
        const priceSelectors = [
          '#corePriceDisplay_desktop_feature_div .a-price-whole',
          '#corePrice_desktop .a-price-whole',
          '#priceblock_ourprice',
          '#priceblock_dealprice',
          'span.a-price-whole'
        ];
        
        for (const selector of priceSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            priceText = el.innerText || el.textContent || '';
            const fractionEl = el.closest('.a-price')?.querySelector('.a-price-fraction');
            if (fractionEl) {
               priceText += '.' + fractionEl.innerText;
            }
            break;
          }
        }

        return { title, bullets, desc, priceText };
      });

      // Update price if found on product page
      const pagePrice = parseEuroPrice(pageData.priceText);
      if (pagePrice) {
        offer.price = pagePrice;
      }

      const fullText = `${pageData.title}\n${pageData.bullets}\n${pageData.desc}`;
      
      // Strict check: Title must contain positive keywords if we are dealing with variants (like 1TB/2TB)
      const titleHasPos = hasPositiveKeyword(pageData.title, component.positive_keywords);
      const bodyHasPos = hasPositiveKeyword(fullText, component.positive_keywords);
      const hasNeg = hasNegativeKeyword(fullText, component.negative_keywords);
      const isUsed = isUsedCondition(fullText);

      if (titleHasPos && bodyHasPos && !hasNeg && !isUsed) {
        finalOffers.push(offer);
        if (finalOffers.length >= 3) break;
      } else {
        console.log(`      [Skip] amazon.de: Failed keyword check. Title has pos: ${titleHasPos}, Body has pos: ${bodyHasPos}, hasNeg: ${hasNeg}, isUsed: ${isUsed}`);
      }
    } catch (err) {
      console.log(`      [Skip] amazon.de: Could not load page.`);
    }
  }

  return finalOffers;
}

module.exports = {
  scrapeAmazon,
};
