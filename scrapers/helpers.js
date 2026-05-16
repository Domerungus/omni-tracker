function pickTop3(offers) {
  const seen = new Set();
  const top3 = [];

  for (const offer of [...offers].sort((a, b) => a.price - b.price)) {
    const key = `${offer.shop_name}|${offer.price}|${offer.url}|${offer.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    top3.push(offer);
    if (top3.length >= 3) break;
  }

  return top3;
}

function parseEuroPrice(text) {
  if (!text) return null;
  let clean = String(text).replace(/\s/g, '');
  const match = clean.match(/[\d.,]+/);
  if (!match) return null;
  let numStr = match[0];
  
  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');
  const lastSeparatorIndex = Math.max(lastComma, lastDot);
  
  if (lastSeparatorIndex !== -1) {
    const afterSeparator = numStr.substring(lastSeparatorIndex + 1);
    if (afterSeparator.length === 2 || afterSeparator.length === 1) {
      const beforeSeparator = numStr.substring(0, lastSeparatorIndex).replace(/[.,]/g, '');
      const value = parseFloat(beforeSeparator + '.' + afterSeparator);
      return Number.isNaN(value) ? null : value;
    } else {
      const value = parseFloat(numStr.replace(/[.,]/g, ''));
      return Number.isNaN(value) ? null : value;
    }
  }
  const value = parseFloat(numStr);
  return Number.isNaN(value) ? null : value;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasNegativeKeyword(text, negativeKeywordsStr) {
  if (!negativeKeywordsStr) return false;
  const negWords = negativeKeywordsStr.split(',').map((s) => s.trim()).filter(Boolean);
  
  for (const word of negWords) {
    const regex = new RegExp(`(?<!\\p{L}|\\p{N})${escapeRegExp(word)}(?!\\p{L}|\\p{N})`, 'ui');
    if (regex.test(text)) {
      console.log(`      [Debug] Match Neg: "${word}" in "${text.substring(0, 50)}..."`);
      return true;
    }
  }
  return false;
}

function hasPositiveKeyword(text, positiveKeywordsStr) {
  if (!positiveKeywordsStr) return true;
  const posWords = positiveKeywordsStr.split(',').map((s) => s.trim()).filter(Boolean);
  if (posWords.length === 0) return true;

  for (const word of posWords) {
    const regex = new RegExp(`(?<!\\p{L}|\\p{N})${escapeRegExp(word)}(?!\\p{L}|\\p{N})`, 'ui');
    if (!regex.test(text)) return false; // Mandatory keyword missing
  }
  return true; // All keywords found
}

const USED_KEYWORDS = [
  'used',
  'mazlietots', 'mazlietota',
  'lietots', 'lietota',
  'atjaunots', 'atjaunota',
  'refurbished',
  'renewed',
  'gebraucht'
];

function isUsedCondition(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  
  if (lowerText.includes('b/u') || lowerText.includes('b.u.') || lowerText.includes('б/у')) {
    console.log(`      [Skip] Used condition detected (b/u)`);
    return true;
  }
  
  for (const word of USED_KEYWORDS) {
    let pattern = word === 'used' ? `(?<!\\p{L})used` : `(?<!\\p{L}|\\p{N})${word}(?!\\p{L}|\\p{N})`;
    const regex = new RegExp(pattern, 'ui');
    if (regex.test(text)) {
      console.log(`      [Skip] Used condition detected: "${word}"`);
      return true;
    }
  }
  return false;
}

module.exports = {
  pickTop3,
  parseEuroPrice,
  hasNegativeKeyword,
  hasPositiveKeyword,
  isUsedCondition,
};
