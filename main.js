require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cron = require('node-cron');
const knex = require('knex');
const { sendTelegramAlert, sendPriceDropAlert } = require('./telegram');
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
const DYNAMIC_FLOOR_RATIO = 0.45;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 */6 * * *';
const PRICE_CHANGE_THRESHOLD_PCT = parseFloat(process.env.PRICE_CHANGE_THRESHOLD_PCT || '1');

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: './tracker.db' },
  useNullAsDefault: true,
});

/**
 * Получить последнюю сохранённую цену для компонента из БД.
 * Возвращает число или null.
 */
async function getPreviousPrice(componentId) {
  const row = await db('price_logs')
    .where({ component_id: componentId })
    .orderBy('scraped_at', 'desc')
    .first();
  return row ? Number(row.price) : null;
}

/**
 * Логика обработки одного компонента.
 * Возвращает объект best offer или null.
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

    // --- Загружаем предыдущие цены ДО запуска браузера ---
    const previousPrices = {};
    for (const c of components) {
      previousPrices[c.id] = await getPreviousPrice(c.id);
    }

    browser = await puppeteer.launch({
      headless: true,
      args: BROWSER_ARGS,
      defaultViewport: null,
    });

    // Глобальный Desktop User-Agent
    browser.on('targetcreated', async (target) => {
      const page = await target.page();
      if (page) {
        await page.setUserAgent(
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        );
      }
    });

    const sessionResults = [];

    for (let i = 0; i < components.length; i++) {
      const component = components[i];
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      page.setDefaultTimeout(RESULTS_TIMEOUT_MS);

      try {
        const bestOffer = await processComponent(page, component, i, components.length);

        if (bestOffer) {
          const prevPrice = previousPrices[component.id];
          const currentPrice = bestOffer.price;
          const target = Number(component.target_price);

          // --- Вычисляем тренд ---
          let trend = '→';
          let delta = null;

          if (prevPrice != null) {
            delta = prevPrice - currentPrice; // >0 = цена упала (хорошо), <0 = выросла
            if (Math.abs(delta) < 0.005) {
              trend = '→'; // без изменений
            } else if (delta > 0) {
              trend = '↓'; // цена упала
            } else {
              trend = '↑'; // цена выросла
            }
          }

          const trendStr = delta != null
            ? `${trend} ${delta > 0 ? '-' : '+'}${Math.abs(delta).toFixed(2)} €`
            : trend;

          console.log(`   📈 Тренд: ${trendStr}${prevPrice != null ? ` (было: ${prevPrice.toFixed(2)} €)` : ' (первая запись)'}`);

          // --- 🏆 Динамический таргет: лучшая найденная цена → новый базис ---
          // Каждую сессию target_price = текущая лучшая цена.
          // Следующая сессия сравнивает с этим базисом: дешевеет рынок (↓) или дорожает (↑)?
          if (currentPrice < target) {
            // Новый рекорд — отправляем алерт ДО обновления target в объекте,
            // чтобы алерт показал правильную "старую цель" и сэкономию
            const saving = target - currentPrice;
            console.log(`   🏆 Новый рекорд! ${currentPrice.toFixed(2)} € (было: ${target.toFixed(2)} €) — цель обновлена.`);
            console.log(`   🚨 НОВЫЙ РЕКОРД ЦЕНЫ! Отправляем алерт...`);
            await sendPriceDropAlert(component, bestOffer, saving);
          }

          // Всегда обновляем target_price в БД до текущей цены (для тренда в следующей сессии)
          await db('components')
            .where({ id: component.id })
            .update({ target_price: currentPrice });
          component.target_price = currentPrice;

          // --- Дедупликация: блокируем обычный алерт если изменение < порога ---
          let shouldAlert = true;
          if (prevPrice != null && delta != null) {
            const changePct = (Math.abs(delta) / prevPrice) * 100;
            if (changePct < PRICE_CHANGE_THRESHOLD_PCT) {
              console.log(`   🔕 Изменение цены (${changePct.toFixed(2)}%) ниже порога ${PRICE_CHANGE_THRESHOLD_PCT}% — алерт заблокирован.`);
              shouldAlert = false;
            }
          }

          sessionResults.push({
            name: component.name,
            target: Number(component.target_price), // актуальный таргет (мог обновиться)
            current: currentPrice,
            url: bestOffer.url,
            shop_name: bestOffer.shop_name,
            trend: trendStr,
            prevPrice,
            shouldAlert,
          });
        }
      } catch (err) {
        console.error(`   ❌ Критическая ошибка при обработке ${component.name}:`, err.message);
      } finally {
        await page.close();
      }

      // Пауза между компонентами
      if (i < components.length - 1) {
        const pause = 5000 + Math.random() * 3000;
        console.log(`   ⏳ Ожидание ${Math.round(pause / 1000)} сек...`);
        await new Promise((r) => setTimeout(r, pause));
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
console.log(`🕒 Бот активен. Расписание: "${CRON_SCHEDULE}"`);

cron.schedule(CRON_SCHEDULE, () => {
  console.log('\n⏰ [CRON] Время проверять цены!');
  runTracker();
});

// Первый запуск при старте приложения
runTracker();
