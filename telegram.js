require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

let bot = null;
if (token && token !== 'твой_токен_здесь') {
  bot = new TelegramBot(token, { polling: false });
}

async function sendTelegramAlert(message) {
  if (!bot || !chatId || chatId === 'твой_id_здесь') {
    console.log('[Telegram] Уведомление пропущено: не настроен токен или chat_id.');
    return;
  }

  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: false });
    console.log('[Telegram] Сообщение успешно отправлено!');
  } catch (error) {
    console.error('[Telegram] Ошибка при отправке сообщения:', error.message);
  }
}

/**
 * Мгновенный алерт когда цена УПАЛА НИЖЕ целевой.
 * Отправляется сразу после нахождения, без каких-либо задержек и фильтров.
 *
 * @param {object} component  — запись из таблицы components
 * @param {object} bestOffer  — { price, shop_name, url, source }
 * @param {number} saving     — экономия в евро (target - current)
 */
async function sendPriceDropAlert(component, bestOffer, saving) {
  if (!bot || !chatId || chatId === 'твой_id_здесь') return;

  const savingStr = saving > 0
    ? `💚 Экономия: <b>${saving.toFixed(2)} €</b>`
    : `⚡ Цена достигла цели!`;

  const message =
    `🚨 <b>ЦЕНА УПАЛА ПОД ЦЕЛЬ!</b>\n\n` +
    `🔧 <b>${component.name}</b>\n` +
    `💰 Цена: <b>${bestOffer.price.toFixed(2)} €</b>  (Цель: ${Number(component.target_price).toFixed(2)} €)\n` +
    `${savingStr}\n` +
    `🏪 Магазин: ${bestOffer.shop_name}\n\n` +
    `👉 <a href="${bestOffer.url}">Купить сейчас →</a>`;

  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: false });
    console.log(`[Telegram] 🚨 Price Drop Alert отправлен: ${component.name}`);
  } catch (error) {
    console.error('[Telegram] Ошибка при отправке Price Drop Alert:', error.message);
  }
}

module.exports = { sendTelegramAlert, sendPriceDropAlert };
