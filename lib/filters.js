const BLACKLISTED_SHOPS = ['joom.com', 'joom', 'aliexpress', 'wish'];

function isBlacklistedShop(shopName) {
  const normalized = (shopName || '').toLowerCase();
  return BLACKLISTED_SHOPS.some((term) => normalized.includes(term));
}

function applyOfferFilters(offers, dynamicFloor) {
  const afterShop = offers.filter((offer) => !isBlacklistedShop(offer.shop_name));
  const rejectedShops = offers.length - afterShop.length;

  const filtered = afterShop.filter((offer) => offer.price >= dynamicFloor);
  const rejectedFloor = afterShop.length - filtered.length;

  return {
    filtered,
    rejectedShops,
    rejectedFloor,
  };
}

module.exports = {
  BLACKLISTED_SHOPS,
  isBlacklistedShop,
  applyOfferFilters,
};
