const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const knex = require('knex');
const cron = require('node-cron');
const express = require('express');

const { scrapeSalidzini } = require('./scrapers/salidzini');
const { scrapeSS } = require('./scrapers/ss');
const { scrapeAmazon } = require('./scrapers/amazon');
const { NAVIGATION_TIMEOUT_MS, RESULTS_TIMEOUT_MS } = require('./scrapers/config');
const { BLACKLISTED_SHOPS, applyOfferFilters } = require('./lib/filters');
const { printBuildSummary } = require('./lib/summary');
const { sendTelegramAlert } = require('./telegram');

puppeteer.use(StealthPlugin());

const PAUSE_MIN_MS = 3000;
const PAUSE_MAX_MS = 7000;
const DYNAMIC_FLOOR_RATIO = 0.45;

const BROWSER_ARGS = [
  '--start-maximized',
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-zygote',
  '--js-flags=--max-old-space-size=256',
  '--lang=lv-LV,lv',
  '--no-sandbox',
  '--disable-setuid-sandbox',
];

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: './tracker.db' },
  useNullAsDefault: true,
});

function randomPauseMs() {
  return PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logComponentHeader(component, index, total, dynamicFloor) {
  const line = '═'.repeat(52);
  console.log(`\n${line}`);
  console.log(`🔧 [${index + 1}/${total}] ${component.name}`);
  console.log(`   🎯 Целевая цена: ${component.target_price} €`);
  console.log(`   📉 Динамический порог (45%): ${dynamicFloor.toFixed(2)} €`);
  console.log(`   🔎 Salidzini / SS: «${component.search_keywords_salidzini}»`);
  console.log(`   🔎 Amazon: «${component.search_keywords_amazon || '—'}»`);
  console.log(line);
}

async function saveBestPrice(component, offer) {
  // Find historical minimum before saving the new price
  const minResult = await db('price_logs')
    .min('price as historical_min')
    .where('component_id', component.id)
    .first();
  const historicalMin = minResult?.historical_min;

  await db('price_logs').insert({
    component_id: component.id,
    price: offer.price,
    shop_name: `${offer.source}: ${offer.shop_name}`,
    url: offer.url,
    scraped_at: db.fn.now(),
  });

  const delta = Number(component.target_price) - offer.price;
  const status = delta >= 0 ? '✅ ниже цели' : '⚠️  выше цели';

  console.log(
    `   💾 Лучшая цена: ${offer.price} € @ ${offer.source} / ${offer.shop_name} (${status}, цель ${component.target_price} €)`,
  );

  // Check for price drop and send alert
  if (historicalMin !== null && historicalMin !== undefined) {
    if (offer.price < historicalMin && (historicalMin - offer.price) > 1) {
      const msg = `🚨 Падение цены!\n📦 <b>${component.name}</b>\n📉 Новая цена: <b>${offer.price}</b> € (Было: ${historicalMin} €)\n🏪 Магазин: ${offer.shop_name}\n🔗 <a href="${offer.url}">Ссылка</a>`;
      await sendTelegramAlert(msg);
    }
  }
}

async function runScraper(name, scraperFn, page, component, dynamicFloor) {
  try {
    console.log(`   🌐 ${name}...`);
    const offers = await scraperFn(page, component, dynamicFloor);
    console.log(`   ✅ ${name}: найдено ${offers.length} (топ-3 до общей фильтрации)`);
    return offers;
  } catch (err) {
    console.error(`   ⚠️  ${name}: ${err.message}`);
    return [];
  }
}

async function processComponent(page, component, index, total) {
  const dynamicFloor = Number(component.target_price) * DYNAMIC_FLOOR_RATIO;
  logComponentHeader(component, index, total, dynamicFloor);

  const salidziniOffers = await runScraper('Salidzini.lv', scrapeSalidzini, page, component, dynamicFloor);
  const ssOffers = await runScraper('SS.com', scrapeSS, page, component, dynamicFloor);
  const amazonOffers = await runScraper('Amazon.de', scrapeAmazon, page, component, dynamicFloor);

  const merged = [...salidziniOffers, ...ssOffers, ...amazonOffers];
  console.log(`   📦 Всего предложений от парсеров: ${merged.length}`);

  const { filtered, rejectedShops, rejectedFloor } = applyOfferFilters(merged, dynamicFloor);

  console.log(
    `   🚫 Магазины: -${rejectedShops} | 📉 Ниже порога ${dynamicFloor.toFixed(2)} €: -${rejectedFloor}`,
  );
  console.log(`   🚫 Чёрный список: ${BLACKLISTED_SHOPS.join(', ')}`);

  if (filtered.length === 0) {
    console.log('   ⚠️  После фильтрации ничего не осталось — пропуск записи в price_logs');
    return null;
  }

  const sorted = [...filtered].sort((a, b) => a.price - b.price);
  const best = sorted[0];
  const top3 = sorted.slice(0, 3);

  console.log(`\n   🏆 Топ-${top3.length} (все источники, после фильтров):\n`);
  console.table(
    top3.map((offer, i) => ({
      '#': i + 1,
      Источник: offer.source,
      Магазин: offer.shop_name,
      'Цена (€)': offer.price,
      Ссылка: offer.url,
    })),
  );

  await saveBestPrice(component, best);
  return best.price;
}

async function runTracker() {
  let browser;

  try {
    console.log('🚀 Omni-Tracker — мульти-источник (Salidzini + SS + Amazon)\n');

    const hasComponents = await db.schema.hasTable('components');
    if (!hasComponents) {
      console.log('⚠️ База данных не найдена. Автоматически создаем таблицы...');
      require('child_process').execSync('node db-setup.js', { stdio: 'inherit' });
    }

    const components = await db('components')
      .select(
        'id',
        'name',
        'target_price',
        'search_keywords_salidzini',
        'search_keywords_amazon',
        'positive_keywords',
        'negative_keywords'
      )
      .orderBy('id');

    if (components.length === 0) {
      console.error('❌ В таблице components нет записей. Авто-инициализация не сработала.');
      process.exit(1);
    }

    console.log(`✅ Загружено компонентов: ${components.length}\n`);

    console.log('🥷 Запуск браузера (Stealth mode)...');
    browser = await puppeteer.launch({
      headless: true,
      args: BROWSER_ARGS,
      ignoreDefaultArgs: ['--enable-automation'],
      defaultViewport: null,
    });

    const sessionResults = [];
    let index = 0;

    for (const component of components) {
      if (!component.search_keywords_salidzini) {
        console.log(`\n⚠️  Пропуск «${component.name}»: не задан search_keywords_salidzini`);
        index += 1;
        continue;
      }

      let page;
      try {
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
        page.setDefaultTimeout(RESULTS_TIMEOUT_MS);

        // Оптимизация памяти (важно для 512MB RAM): блокируем картинки и стили
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const type = req.resourceType();
          if (type === 'image' || type === 'stylesheet' || type === 'font' || type === 'media') {
            req.abort();
          } else {
            req.continue();
          }
        });

        const bestPrice = await processComponent(page, component, index, components.length);

        if (bestPrice != null) {
          sessionResults.push({
            name: component.name,
            target: Number(component.target_price),
            current: bestPrice,
          });
        }
      } catch (err) {
        console.error(`   ❌ Ошибка «${component.name}»: ${err.message}`);
      } finally {
        if (page) await page.close();
      }

      const pauseMs = Math.round(randomPauseMs());
      console.log(`   ⏳ Пауза ${(pauseMs / 1000).toFixed(1)} сек...`);
      await sleep(pauseMs);
      index += 1;
    }

    await browser.close();
    browser = null;
    console.log('\n👋 Браузер закрыт. Все компоненты обработаны.');

    const tgSummary = printBuildSummary(sessionResults);
    if (tgSummary) {
      await sendTelegramAlert(tgSummary);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('✅ Итерация runTracker завершена. Ожидание следующего запуска...');
  }
}

// ---------------------------------------------------------
// WEB SERVER (KEEP-ALIVE FOR RENDER/CLOUD)
// ---------------------------------------------------------
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Omni-Tracker is alive');
});

app.listen(port, () => {
  console.log(`🌐 Веб-сервер Keep-Alive запущен на порту ${port}`);
});

// ---------------------------------------------------------
// CRON SCHEDULER
// ---------------------------------------------------------
console.log('🕒 Настройка расписания CRON (каждые 6 часов)...');
cron.schedule('0 */6 * * *', async () => {
  console.log('\n=======================================');
  console.log('⏰ Запуск по расписанию CRON');
  console.log('=======================================');
  await runTracker().catch(err => console.error('❌ Ошибка CRON runTracker:', err));
});

// ---------------------------------------------------------
// STARTUP
// ---------------------------------------------------------
console.log('⚡ Мгновенный запуск при старте...');
runTracker().catch(err => console.error('❌ Ошибка стартового runTracker:', err));
