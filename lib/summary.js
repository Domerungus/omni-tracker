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

function findRtxPrice(sessionResults, gpuModel) {
  const item = sessionResults.find((entry) => entry.name.includes(gpuModel));
  return item?.current ?? null;
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
    return;
  }

  const baseItems = sessionResults.filter((entry) => !isRtxComponent(entry.name));
  const targetBaseTotal = baseItems.reduce((sum, entry) => sum + entry.target, 0);
  const currentBaseTotal = baseItems.reduce((sum, entry) => sum + entry.current, 0);
  const baseDiff = currentBaseTotal - targetBaseTotal;

  const rtx3090 = findRtxPrice(sessionResults, '3090');
  const rtx4090 = findRtxPrice(sessionResults, '4090');

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

  // Generate plain text summary for Telegram
  let tgText = `📊 <b>ИТОГИ СБОРКИ (сессия)</b>\n\n`;
  const tgBaseDiff = baseDiff > 0 ? `+${baseDiff.toFixed(2)}` : `${baseDiff.toFixed(2)}`;
  tgText += `Сумма базовой сборки: <b>${formatEuro(currentBaseTotal)}</b> (Цель: ${formatEuro(targetBaseTotal)}) -> ${tgBaseDiff} €\n`;
  if (rtx3090 != null) {
    tgText += `Сборка + RTX 3090: <b>${formatEuro(currentBaseTotal + rtx3090)}</b>\n`;
  } else {
    tgText += `Сборка + RTX 3090: — (нет цены в сессии)\n`;
  }
  if (rtx4090 != null) {
    tgText += `Сборка + RTX 4090: <b>${formatEuro(currentBaseTotal + rtx4090)}</b>\n`;
  } else {
    tgText += `Сборка + RTX 4090: — (нет цены в сессии)\n`;
  }

  return tgText;
}

module.exports = {
  printBuildSummary,
};
