const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function formatEuro(value) {
  return `${Number(value).toFixed(2)} €`;
}

function isRtxComponent(name) {
  return name.includes('RTX');
}

function findRtxEntry(sessionResults, gpuModel) {
  return sessionResults.find((entry) => entry.name.includes(gpuModel)) || null;
}

function colorizePrice(current, target) {
  if (current <= target) {
    return `${ANSI.bold}${ANSI.green}${formatEuro(current)}${ANSI.reset}`;
  }
  return `${ANSI.bold}${ANSI.red}${formatEuro(current)}${ANSI.reset}`;
}

function colorizeDiff(diff) {
  const sign = diff > 0 ? '+' : '';
  const text = `${sign}${diff.toFixed(2)} €`;
  if (diff <= 0) {
    return `${ANSI.green}${text}${ANSI.reset}`;
  }
  return `${ANSI.red}${text}${ANSI.reset}`;
}

/**
 * @param {Array} sessionResults — массив объектов:
 *   { name, target, current, url, shop_name, trend, prevPrice, shouldAlert }
 */
function printBuildSummary(sessionResults) {
  const width = 54;
  const border = '═'.repeat(width);
  const padLine = (text) => {
    const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
    const padding = Math.max(0, width - visible.length);
    return `${text}${' '.repeat(padding)}`;
  };

  console.log(`\n╔${border}╗`);
  console.log(`║${padLine(`${ANSI.bold}${ANSI.cyan}  📊 ИТОГИ СБОРКИ (сессия)${ANSI.reset}`)}║`);
  console.log(`╠${border}╣`);

  if (sessionResults.length === 0) {
    console.log(`║${padLine('  Нет данных — ни один компонент не найден.')}║`);
    console.log(`╚${border}╝\n`);
    return null;
  }

  const baseItems = sessionResults.filter((entry) => !isRtxComponent(entry.name));
  const targetBaseTotal = baseItems.reduce((sum, entry) => sum + entry.target, 0);
  const currentBaseTotal = baseItems.reduce((sum, entry) => sum + entry.current, 0);
  const baseDiff = currentBaseTotal - targetBaseTotal;

  const rtx3090entry = findRtxEntry(sessionResults, '3090');
  const rtx4090entry = findRtxEntry(sessionResults, '4090');
  const rtx3090 = rtx3090entry?.current ?? null;
  const rtx4090 = rtx4090entry?.current ?? null;

  const baseLine = `  Сумма базовой сборки: ${colorizePrice(currentBaseTotal, targetBaseTotal)} ${ANSI.dim}(Цель: ${formatEuro(targetBaseTotal)})${ANSI.reset} -> ${colorizeDiff(baseDiff)}`;
  console.log(`║${padLine(baseLine)}║`);

  if (rtx3090 != null) {
    const line3090 = `  Сборка + RTX 3090: ${ANSI.bold}${ANSI.yellow}${formatEuro(currentBaseTotal + rtx3090)}${ANSI.reset}`;
    console.log(`║${padLine(line3090)}║`);
  } else {
    console.log(`║${padLine('  Сборка + RTX 3090: — (нет цены в сессии)')}║`);
  }

  if (rtx4090 != null) {
    const line4090 = `  Сборка + RTX 4090: ${ANSI.bold}${ANSI.yellow}${formatEuro(currentBaseTotal + rtx4090)}${ANSI.reset}`;
    console.log(`║${padLine(line4090)}║`);
  } else {
    console.log(`║${padLine('  Сборка + RTX 4090: — (нет цены в сессии)')}║`);
  }

  console.log(`╚${border}╝\n`);

  // ─── Telegram HTML ───────────────────────────────────────────
  let tgText = `📊 <b>ИТОГИ СБОРКИ (сессия)</b>\n\n`;

  tgText += `📦 <b>Цены по компонентам:</b>\n`;
  for (const entry of sessionResults) {
    // Строка тренда
    let trendTag = '';
    if (entry.trend) {
      if (entry.trend.startsWith('↓')) {
        trendTag = ` <code>${entry.trend} 🔥</code>`;
      } else if (entry.trend.startsWith('↑')) {
        trendTag = ` <code>${entry.trend}</code>`;
      } else {
        trendTag = ` <code>${entry.trend}</code>`;
      }
    }

    // Иконка по сравнению с целью
    const goalIcon = entry.current <= entry.target ? '✅' : '🔸';

    if (entry.url) {
      tgText += `${goalIcon} <a href="${entry.url}">${entry.name}</a>: <b>${entry.current.toFixed(2)} €</b>${trendTag} (Цель: ${entry.target} €)\n`;
    } else {
      tgText += `${goalIcon} ${entry.name}: <b>${entry.current.toFixed(2)} €</b>${trendTag} (Цель: ${entry.target} €)\n`;
    }
  }
  tgText += `\n`;

  // Лучшая сделка (максимальная экономия от цели)
  let bestDeal = null;
  let maxSavings = -Infinity;
  for (const entry of sessionResults) {
    if (entry.url) {
      const savings = entry.target - entry.current;
      if (savings > maxSavings) {
        maxSavings = savings;
        bestDeal = entry;
      }
    }
  }

  if (bestDeal) {
    const savingsText = maxSavings > 0
      ? `экономия: <b>${maxSavings.toFixed(2)} €</b> 🔥`
      : `разница: ${maxSavings.toFixed(2)} €`;
    tgText += `🔥 <b>ЛУЧШАЯ СДЕЛКА СЕССИИ:</b>\n`;
    tgText += `👉 <a href="${bestDeal.url}">${bestDeal.name} — ${bestDeal.current.toFixed(2)} € @ ${bestDeal.shop_name}</a> (${savingsText})\n\n`;
  }

  // Итоги конфигураций
  tgText += `💳 <b>Итоговые конфигурации:</b>\n`;
  const tgBaseDiff = baseDiff > 0 ? `+${baseDiff.toFixed(2)}` : `${baseDiff.toFixed(2)}`;
  tgText += `Базовая сборка: <b>${formatEuro(currentBaseTotal)}</b> (Цель: ${formatEuro(targetBaseTotal)}) → ${tgBaseDiff} €\n`;

  if (rtx3090 != null) {
    tgText += `Сборка + RTX 3090: <b>${formatEuro(currentBaseTotal + rtx3090)}</b>\n`;
  } else {
    tgText += `Сборка + RTX 3090: — (нет цены)\n`;
  }
  if (rtx4090 != null) {
    tgText += `Сборка + RTX 4090: <b>${formatEuro(currentBaseTotal + rtx4090)}</b>\n`;
  } else {
    tgText += `Сборка + RTX 4090: — (нет цены)\n`;
  }

  return tgText;
}

module.exports = {
  printBuildSummary,
};
