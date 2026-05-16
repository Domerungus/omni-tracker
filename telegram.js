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
    await bot.sendMessage(chatId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
    console.log('[Telegram] Сообщение успешно отправлено!');
  } catch (error) {
    console.error('[Telegram] Ошибка при отправке сообщения:', error.message);
  }
}

module.exports = { sendTelegramAlert };
