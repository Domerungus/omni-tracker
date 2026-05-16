const { NAVIGATION_TIMEOUT_MS, RESULTS_TIMEOUT_MS } = require('./config');
const { hasNegativeKeyword, hasPositiveKeyword, parseEuroPrice, isUsedCondition } = require('./helpers');

const SS_SEARCH_RESULT = 'https://www.ss.com/ru/search-result/';

function isNewCondition(value) {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === 'новая' || normalized === 'jauns' || normalized === 'нов.' || normalized === 'нов';
}

async function readConditionFromDetail(page) {
  return page.evaluate(() => {
    for (const row of document.querySelectorAll('tr')) {
      const cells = [...row.querySelectorAll('td')].map((cell) => cell.innerText?.trim() || '');
      const labelIndex = cells.findIndex((cell) => cell === 'Состояние' || cell === 'Stāvoklis');
      if (labelIndex >= 0 && cells[labelIndex + 1]) {
        return cells[labelIndex + 1];
      }
    }

    const match = document.body.innerText.match(/(?:Stāvoklis|Состояние)[:\s\t]*([^\n]+)/i);
    return match?.[1]?.trim() || null;
  });
}

async function scrapeSS(page, component, dynamicFloor) {
  const query = component.search_keywords_salidzini;

  const searchUrl = `${SS_SEARCH_RESULT}?q=${encodeURIComponent(query)}`;

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  try {
    await page.waitForSelector('tr[id^="tr_"]', { timeout: 3000 });
  } catch {
    console.log('SS.com: Нет объявлений');
    return [];
  }

  const rows = await page.evaluate(() => {
    function isNewConditionLocal(value) {
      const normalized = (value || '').trim().toLowerCase();
      return normalized === 'новая' || normalized === 'jauns' || normalized === 'нов.' || normalized === 'нов';
    }

    return [...document.querySelectorAll('tr[id^="tr_"]')].slice(0, 20).map((row) => {
      const cells = [...row.querySelectorAll('td')].map((cell) => cell.innerText?.trim() || '');
      const link = row.querySelector('a[href*="/msg/"]')?.href || '';
      const priceCell = cells.find((cell) => /\d+\s*€/.test(cell)) || '';
      const title = cells.find((cell) => cell.length > 20 && !/\d+\s*€/.test(cell)) || '';
      const conditionFromRow =
        cells.find((cell) => isNewConditionLocal(cell)) ||
        (() => {
          const labelIndex = cells.findIndex((cell) => cell === 'Состояние' || cell === 'Stāvoklis');
          return labelIndex >= 0 ? cells[labelIndex + 1] : null;
        })();

      return {
        link,
        priceText: priceCell,
        title,
        conditionFromRow,
        cells,
      };
    });
  });

  const sortedRows = rows
    .map(row => ({ ...row, price: parseEuroPrice(row.priceText) }))
    .filter(row => row.price != null && row.link)
    .sort((a, b) => a.price - b.price);

  const validOffers = [];

  for (const row of sortedRows) {
    try {
      await page.goto(row.link, {
        waitUntil: 'domcontentloaded',
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      // Wait for ad content to load
      await new Promise((r) => setTimeout(r, 2000));

      const pageData = await page.evaluate(() => {
        const msg = document.querySelector('#msg_div_msg')?.innerText || '';
        const bodyText = document.body.innerText || '';
        return { msg, bodyText };
      });
      
      const hasPos = hasPositiveKeyword(pageData.bodyText, component.positive_keywords);
      const hasNeg = hasNegativeKeyword(row.title + ' ' + pageData.msg, component.negative_keywords);
      const isUsed = isUsedCondition(pageData.bodyText);

      if (!hasPos || hasNeg || isUsed) {
        console.log(`      [Skip] ss.com: Failed keyword/condition check.`);
        continue;
      }

      let condition = row.conditionFromRow;
      if (!isNewCondition(condition)) {
        condition = await readConditionFromDetail(page);
      }

      if (!isNewCondition(condition)) {
        console.log(`      [Skip] ss.com: Not new condition.`);
        continue;
      }

      validOffers.push({
        shop_name: 'ss.com',
        price: row.price,
        url: row.link,
        source: 'ss.com',
        title: row.title,
      });

      if (validOffers.length >= 3) break;
    } catch (err) {
      console.log(`      [Skip] ss.com: Could not load page.`);
    }
  }

  return validOffers;
}

module.exports = {
  scrapeSS,
};
