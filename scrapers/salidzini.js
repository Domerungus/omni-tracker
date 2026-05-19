const { NAVIGATION_TIMEOUT_MS, RESULTS_TIMEOUT_MS } = require('./config');
const { hasNegativeKeyword, hasPositiveKeyword, isUsedCondition } = require('./helpers');

const SALIDZINI_SEARCH = 'https://www.salidzini.lv/cena';

async function scrapeSalidzini(page, component, dynamicFloor) {
  const query = component.search_keywords_salidzini;
  const searchUrl = `${SALIDZINI_SEARCH}?q=${encodeURIComponent(query)}`;
  const mpn = (component.part_number || '').trim().toLowerCase();

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

  // Магазины, которые не проходят фильтр: ненадёжные маркетплейсы, Китай, дропшипперы
  const SHOP_BLACKLIST = [
    'joom.com', 'joom',
    'aliexpress', 'ali express',
    'wish.com', 'wish',
    'banggood', 'banggood.com',
    'gearbest', 'dhgate',
    'ebay',     // объявления, не фикс. цена
  ];

  const validItems = [];
  for (const item of offers) {
    const shopLower = item.shop_name.toLowerCase();
    if (SHOP_BLACKLIST.some(b => shopLower.includes(b))) {
      console.log(`      [Skip] Salidzini: магазин в блэклисте — ${item.shop_name}`);
      continue;
    }
    if (dynamicFloor && item.price < dynamicFloor) continue;
    if (isUsedCondition(item.title)) continue;
    validItems.push(item);
  }

  // Посещаем ВСЕ валидные страницы магазинов и собираем живые цены.
  // Только потом сортируем по реальной цене — иначе кэш Salidzini может исказить порядок.
  const candidateOffers = [];

  validItems.sort((a, b) => a.price - b.price); // предварительная сортировка по кэшу Salidzini

  for (const offer of validItems) {
    try {
      await page.goto(offer.url, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      await new Promise((r) => setTimeout(r, 2000));

      // Захватываем реальный URL магазина после редиректа с click.php
      const realUrl = page.url();
      if (realUrl && !realUrl.includes('salidzini.lv')) {
        offer.url = realUrl;
      }

      const pageData = await page.evaluate(() => {
        const h1 = document.querySelector('h1')?.innerText || '';
        const bodyText = document.body.innerText || '';

        // --- Читаем РЕАЛЬНУЮ цену со страницы магазина ---
        // Используем только надёжные структурированные источники.
        // CSS-селекторы исключены: слишком много ложных срабатываний.
        let livePrice = null;

        // 1. JSON-LD Schema.org (самый надёжный)
        const EU_VAT = 1.21; // НДС Латвии 21%
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const data = JSON.parse(script.textContent);
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
              const offers = item?.offers;
              if (!offers) continue;
              const offerList = Array.isArray(offers) ? offers : [offers];
              for (const o of offerList) {
                const p = parseFloat(o?.price);
                if (isNaN(p) || p <= 0) continue;
                // valueAddedTaxIncluded: false → цена БЕЗ НДС → умножаем на 1.21
                const taxIncluded = o?.valueAddedTaxIncluded;
                livePrice = (taxIncluded === false) ? Math.round(p * EU_VAT * 100) / 100 : p;
                break;
              }
              if (livePrice) break;
            }
          } catch {}
          if (livePrice) break;
        }

        // 2. Open Graph / meta price
        if (!livePrice) {
          const metaPrice = document.querySelector(
            'meta[property="product:price:amount"], meta[name="price"]'
          );
          if (metaPrice) {
            const p = parseFloat(metaPrice.getAttribute('content'));
            if (!isNaN(p) && p > 0) livePrice = p;
          }
        }

        // 3. itemprop="price" — Schema.org inline атрибут (надёжнее чем CSS)
        if (!livePrice) {
          const el = document.querySelector('[itemprop="price"][content]');
          if (el) {
            const p = parseFloat(el.getAttribute('content'));
            if (!isNaN(p) && p > 0) livePrice = p;
          }
        }

        return { coreText: h1, bodyText, livePrice };
      });

      // --- Санитарная проверка live-цены ---
      const cachedPrice = offer.price; // цена из Salidzini-кэша
      if (pageData.livePrice && pageData.livePrice > 0) {
        const ratio = pageData.livePrice / cachedPrice;
        // Цена не может отличаться более чем в 10 раз от кэша — это явно артефакт
        if (ratio > 10 || ratio < 0.1) {
          console.log(`      [⚠️  Sanity] ${offer.shop_name}: live=${pageData.livePrice}€ слишком далека от кэша ${cachedPrice}€ → используем кэш`);
        } else {
          let adjustedPrice = pageData.livePrice;

          // Эвристика: если live / cached ≈ 1/1.21, магазин забыл указать
          // valueAddedTaxIncluded=false — применяем НДС 21% автоматически
          const VAT = 1.21;
          const expectedExVat = cachedPrice / VAT;
          if (Math.abs(pageData.livePrice - expectedExVat) / expectedExVat < 0.03) {
            adjustedPrice = Math.round(pageData.livePrice * VAT * 100) / 100;
            console.log(`      [🧾 VAT] ${offer.shop_name}: цена без НДС ${pageData.livePrice}€ → с НДС ${adjustedPrice}€`);
          } else if (Math.abs(adjustedPrice - cachedPrice) > 0.5) {
            console.log(`      [💰 Live] ${offer.shop_name}: кэш=${cachedPrice}€ → реальная=${adjustedPrice}€`);
          }

          offer.price = adjustedPrice;
        }
      }

      // --- Проверка dynamicFloor по РЕАЛЬНОЙ цене ---
      if (dynamicFloor && offer.price < dynamicFloor) {
        console.log(`      [Skip] ${offer.shop_name}: цена ${offer.price}€ ниже порога ${dynamicFloor.toFixed(2)}€`);
        continue;
      }

      const pageTextLower = (offer.title + ' ' + pageData.bodyText).toLowerCase();

      // === MPN BYPASS ===
      if (mpn && pageTextLower.includes(mpn)) {
        console.log(`      [✅ MPN Match] ${offer.shop_name}: партийник "${component.part_number}" найден.`);
        candidateOffers.push(offer);
        continue;
      }

      // === Стандартная проверка (для компонентов без MPN — видеокарты) ===
      const hasPos = hasPositiveKeyword(pageData.bodyText, component.positive_keywords);
      const hasNeg = hasNegativeKeyword(offer.title + ' ' + pageData.coreText, component.negative_keywords);
      const isUsed = isUsedCondition(offer.title + ' ' + pageData.coreText);

      if (hasPos && !hasNeg && !isUsed) {
        candidateOffers.push(offer);
      } else {
        console.log(`      [Skip] ${offer.shop_name}: hasPos: ${hasPos}, hasNeg: ${hasNeg}, isUsed: ${isUsed}`);
      }
    } catch (err) {
      console.log(`      [Skip] ${offer.shop_name}: Could not load page.`);
    }
  }

  // Сортируем по РЕАЛЬНОЙ цене и возвращаем топ-3
  candidateOffers.sort((a, b) => a.price - b.price);
  return candidateOffers.slice(0, 3);
}

module.exports = {
  scrapeSalidzini,
};

