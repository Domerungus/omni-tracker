const knex = require('knex')({
  client: 'better-sqlite3',
  connection: {
    filename: './tracker.db',
  },
  useNullAsDefault: true,
});

const COMPONENTS_SEED = [
  // --- Компоненты с точными MPN (100% идентификация) ---
  {
    name: 'AMD Ryzen 9 9950X',
    target_price: 417.69,              // Рекорд из логов (iport.lv)
    part_number: '100-100001277WOF',
    search_keywords_salidzini: 'Ryzen 9 9950X',
    search_keywords_amazon: 'AMD Ryzen 9 9950X',
    positive_keywords: '9950x',
    negative_keywords: 'dators, pc, system, datoru, priekš, for, ūdens, dzesētājs',
  },
  {
    name: 'ASUS PROART X870E-CREATOR',
    target_price: 390.99,              // Рекорд из логов (aio.lv)
    part_number: '90MB1IG0-M0EAY0',
    search_keywords_salidzini: 'PROART X870E-CREATOR',
    search_keywords_amazon: 'ASUS ProArt X870E-CREATOR',
    positive_keywords: 'x870e',
    negative_keywords: 'monobloks, monoblock, priekš, for, block, dzesētājs, water',
  },
  {
    name: '64GB (2x32GB) Kingston Fury Beast 6000MHz',
    target_price: 220.00,              // Отличная цена для комплекта 2x32
    part_number: 'KF560C30BBEK2-64',  // Артикул именно комплекта из двух планок
    search_keywords_salidzini: 'Kingston Fury Beast 6000 64GB',
    search_keywords_amazon: 'Kingston Fury Beast 64GB 6000MT/s',
    positive_keywords: '64gb',
    negative_keywords: '32gb, 16gb, 1x64gb, 8gb',
  },
  {
    name: 'Samsung 990 PRO 2TB',
    target_price: 159.99,              // Сильный таргет для скидок Amazon
    part_number: 'MZ-V9P2T0BW',
    search_keywords_salidzini: 'Samsung 990 PRO 2TB',
    search_keywords_amazon: 'Samsung 990 PRO 2TB NVMe',
    positive_keywords: '990',
    negative_keywords: 'heatsink, radiator, cooler, enclosure',
  },
  {
    name: 'be quiet! Dark Power Pro 13 1600W',
    target_price: 363.54,              // Рекорд из логов (itworkshop.lv)
    part_number: 'BN332',
    search_keywords_salidzini: 'Dark Power Pro 13 1600W',
    search_keywords_amazon: 'be quiet Dark Power Pro 13 1600W',
    positive_keywords: '1600w',
    negative_keywords: 'cable, vads, adapter, strāvas',
  },
  {
    name: 'Noctua NH-D15 G2 LBC',
    target_price: 143.25,              // Рекорд из логов (multo.eu)
    part_number: 'NH-D15 G2 LBC',
    search_keywords_salidzini: 'Noctua NH-D15 G2 LBC',
    search_keywords_amazon: 'Noctua NH-D15 G2 LBC',
    positive_keywords: 'g2 lbc',
    negative_keywords: 'mounting, bracket, kit, stiprinājums, hbc, standard',
  },
  {
    name: 'Fractal Design Meshify 3 XL',
    target_price: 109.00,              // Рекорд из логов (buconto.com)
    part_number: 'FD-C-MES3X-02',
    search_keywords_salidzini: 'Meshify 3 XL',
    search_keywords_amazon: 'Fractal Design Meshify 3 XL',
    positive_keywords: 'xl',
    negative_keywords: 'panel, stikls, glass, front, filter',
  },
  {
    name: 'Arctic P14 PWM PST',
    target_price: 6.78,                // Рекорд из логов (amazon.de)
    part_number: 'ACFAN00138A',
    search_keywords_salidzini: 'Arctic P14 PWM PST Black 140mm',
    search_keywords_amazon: 'Arctic P14 PWM PST 140mm',
    positive_keywords: 'p14',
    negative_keywords: 'slim, bionix, 120mm, argb',
  },
  // --- Видеокарты: MPN НЕ используем! ---
  // Nvidia делает только чип. Карты собирают ASUS, MSI, Gigabyte, Palit, Zotac и т.д.
  {
    name: 'Nvidia RTX 3090 (24GB)',
    target_price: 950.00,              // Рекорд из логов (707.lv)
    part_number: '',
    search_keywords_salidzini: 'RTX 3090',
    search_keywords_amazon: 'Nvidia RTX 3090 24GB',
    positive_keywords: '3090',
    negative_keywords: 'dators, pc, system, datoru, block, priekš, for, cable, pad, thermal',
  },
  {
    name: 'Nvidia RTX 4090 (24GB)',
    target_price: 1800.00,             // Жесткий минимум для отсечения ПК
    part_number: '',
    search_keywords_salidzini: 'RTX 4090',
    search_keywords_amazon: 'Nvidia RTX 4090 24GB',
    positive_keywords: '4090',
    negative_keywords: 'dators, pc, system, datoru, block, priekš, for, cable, pad, thermal',
  },
];

async function resetDevTables() {
  await knex.raw('DROP TABLE IF EXISTS price_logs');
  await knex.raw('DROP TABLE IF EXISTS components');
  console.log('🗑️  Dev reset: удалены price_logs и components (история цен очищена).');
}

async function createTables() {
  await knex.schema.createTable('components', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable().unique();
    table.decimal('target_price', 10, 2);
    table.text('part_number');
    table.text('search_keywords_salidzini');
    table.text('search_keywords_amazon');
    table.text('positive_keywords');
    table.text('negative_keywords');
  });

  await knex.schema.createTable('price_logs', (table) => {
    table.increments('id').primary();
    table.integer('component_id').unsigned().references('id').inTable('components').onDelete('CASCADE');
    table.decimal('price', 10, 2).notNullable();
    table.string('shop_name');
    table.text('url');
    table.timestamp('scraped_at').defaultTo(knex.fn.now());
  });

  const hasAlertsHistory = await knex.schema.hasTable('alerts_history');
  if (!hasAlertsHistory) {
    await knex.schema.createTable('alerts_history', (table) => {
      table.increments('id').primary();
      table.integer('component_id').unsigned().references('id').inTable('components').onDelete('CASCADE');
      table.decimal('price_found', 10, 2);
      table.text('message');
      table.timestamp('sent_at').defaultTo(knex.fn.now());
    });
  }
}

async function seedComponents() {
  // Миграция: добавляем колонку part_number если её ещё нет (для существующих БД)
  const hasPartNumber = await knex.schema.hasColumn('components', 'part_number');
  if (!hasPartNumber) {
    console.log('🔧 Миграция: добавляем колонку part_number...');
    await knex.schema.alterTable('components', (table) => {
      table.text('part_number');
    });
  }

  for (const item of COMPONENTS_SEED) {
    await knex('components')
      .insert({
        name: item.name,
        part_number: item.part_number || '',
        search_keywords_salidzini: item.search_keywords_salidzini,
        search_keywords_amazon: item.search_keywords_amazon,
        target_price: item.target_price,
        positive_keywords: item.positive_keywords,
        negative_keywords: item.negative_keywords,
      })
      .onConflict('name')
      .merge(['part_number', 'search_keywords_salidzini', 'search_keywords_amazon', 'target_price', 'positive_keywords', 'negative_keywords']);
  }

  const { count } = await knex('components').count({ count: '*' }).first();
  console.log(`🌱 Seed: в таблице components — ${count} записей.`);
}

async function setup() {
  await resetDevTables(); // Полная пересборка: удаляем старые записи и создаем заново
  await createTables();
  await seedComponents();

  console.log('✅ База tracker.db готова (таблицы: components, price_logs, alerts_history).');
  await knex.destroy();
}

setup().catch((err) => {
  console.error('Ошибка при создании базы:', err);
  process.exit(1);
});
