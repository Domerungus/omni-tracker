require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');
const knex = require('knex');
const { sendTelegramAlert } = require('./telegram');
const { printBuildSummary } = require('./lib/summary');

// Подключаем парсеры
const { scrapeSalidzini } = require('./scrapers/salidzini');
const { scrapeSS } = require('./scrapers/ss');
const { scrapeAmazon } = require('./scrapers/amazon');

puppeteer.use(StealthPlugin());

// --- КОНФИГУРАЦИЯ ---
const BROWSER_ARGS = ['--start-maximized', '--lang=lv-LV,lv'];
const NAVIGATION_TIMEOUT_MS = 60000;
const RESULTS_TIMEOUT_MS = 30000;
const DYNAMIC_FLOOR_RATIO = 0.45; // Игнорим всё, что дешевле 45% от цели (обычно это мусор)

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: './tracker.db' },
  useNullAsDefault: true,
});

/**
 * Логика обработки одного компонента
 */
async function processComponent(page, component, index, total) {
  console.log('════════════════════════════════════════════════════');
  console.log(`🔧 [${index + 1}/${total}] ${component.name}`);
  console.log(`   🎯 Целевая цена: ${component.target_price} €`);
  
  const dynamicFloor = component.target_price ? component.target_price * DYNAMIC_FLOOR_RATIO : null;
  if (dynamicFloor) console.log(`   📉 Динамический порог (45%): ${dynamicFloor.toFixed(2)} €`);
  
  console.log('════════════════════════════════════════════════════');

  const allOffers = [];

  // 1. Salidzini
  console.log('   🌐 Salidzini.lv...');
  try {
    const sResults = await scrapeSalidzini(page, component, dynamicFloor);
    allOffers.push(...sResults);
    console.log(`   ✅ Salidzini.lv: найдено ${sResults.length}`);
  } catch (err) {
    console.log(`   ⚠️  Salidzini.lv ошибка: ${err.message}`);
  }

  // 2. SS.com
  console.log('   🌐 SS.com...');
  try {
    const ssResults = await scrapeSS(page, component, dynamicFloor);
    allOffers.push(...ssResults);
    console.log(`   ✅ SS.com: найдено ${ssResults.length}`);
  } catch (err) {
    console.log(`   ⚠️  SS.com ошибка: ${err.message}`);
  }

  // 3. Amazon
  console.log('   🌐 Amazon.de...');
  try {
    const amzResults = await scrapeAmazon(page, component, dynamicFloor);
    allOffers.push(...amzResults);
    console.log(`   ✅ Amazon.de: найдено ${amzResults.length}`);
  } catch (err) {
    console.log(`   ⚠️  Amazon.de ошибка: ${err.message}`);
  }

  if (allOffers.length === 0) {
    console.log('\n   ❌ Ничего не найдено (или всё отфильтровано).');
    return null;
  }

  // Сортировка по цене
  const sorted = allOffers.sort((a, b) => a.price - b.price);
  const best = sorted[0];

  console.log(`\n   💾 Лучшая цена: ${best.price} € @ ${best.shop_name} (${best.source})`);
  
  // Сохранение в базу
  await db('price_logs').insert({
    component_id: component.id,
    price: best.price,
    shop_name: best.shop_name,
    url: best.url,
  });

  return best;
}

/**
 * Главная функция запуска
 */
async function runTracker() {
  let browser;
  try {
    console.log('\n🚀 Omni-Tracker — Запуск сессии поиска цен...');
    
    const components = await db('components').select('*').orderBy('id');
    if (components.length === 0) {
      console.error('❌ Ошибка: Таблица components пуста. Запустите npm run db:setup');
      return;
    }

    browser = await puppeteer.launch({
      headless: true, // Фоновый режим
      args: BROWSER_ARGS,
      defaultViewport: null
    });

    // Устанавливаем глобальный User-Agent (Desktop), чтобы Amazon не думал, что мы с iPhone
    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://www.amazon.de', ['notifications']);
    
    // Применяем UA ко всем новым страницам
    browser.on('targetcreated', async (target) => {
      const page = await target.page();
      if (page) {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
      }
    });

    const sessionResults = [];

    for (let i = 0; i < components.length; i++) {
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      page.setDefaultTimeout(RESULTS_TIMEOUT_MS);

      try {
        const bestOffer = await processComponent(page, components[i], i, components.length);
        if (bestOffer) {
          sessionResults.push({
            name: components[i].name,
            target: components[i].target_price,
            current: bestOffer.price,
            url: bestOffer.url,
            shop_name: bestOffer.shop_name
          });
        }
      } catch (err) {
        console.error(`   ❌ Критическая ошибка при обработке ${components[i].name}:`, err.message);
      } finally {
        await page.close();
      }

      // Пауза между компонентами
      if (i < components.length - 1) {
        const pause = 5000 + Math.random() * 3000;
        console.log(`   ⏳ Ожидание ${Math.round(pause/1000)} сек...`);
        await new Promise(r => setTimeout(r, pause));
      }
    }

    console.log('\n🏁 Сессия завершена. Формируем отчет...');
    const summaryHtml = printBuildSummary(sessionResults);
    if (summaryHtml) {
      await sendTelegramAlert(summaryHtml);
      console.log('✅ Отчет отправлен в Telegram.');
    }

  } catch (err) {
    console.error('❌ Ошибка в runTracker:', err);
  } finally {
    if (browser) await browser.close();
    console.log('\n💤 Спим до следующего запуска...');
  }
}

// --- ЗАПУСК ПО РАСПИСАНИЮ ---
console.log('🕒 Бот активен. Расписание: каждые 6 часов.');

cron.schedule('0 */6 * * *', () => {
  console.log('\n⏰ [CRON] Время проверять цены!');
  runTracker();
});

// Первый запуск при старте приложения
runTracker();
