const knex = require('knex')({
  client: 'better-sqlite3',
  connection: {
    filename: './tracker.db',
  },
  useNullAsDefault: true,
});

const COMPONENTS_SEED = [
  { name: 'AMD Ryzen 9 9950X',            target_price: 650,  part_number: '100-100001277WOF', search_keywords_salidzini: 'Ryzen 9 9950X',              search_keywords_amazon: 'AMD Ryzen 9 9950X',            positive_keywords: '9950x',     negative_keywords: 'dators, datoru, priekš, ūdens, dzesētājs, monoblock, waterblock' },
  { name: 'ASUS PROART X870E-CREATOR',    target_price: 425,  part_number: '90MB1SC0-M0EAY0', search_keywords_salidzini: 'PROART X870E-CREATOR',         search_keywords_amazon: 'ASUS ProArt X870E-CREATOR',    positive_keywords: 'x870e',     negative_keywords: 'monobloks, monoblock, priekš, block, dzesētājs, water' },
  { name: '64GB Kingston Fury Beast 6000MHz', target_price: 220, part_number: '',             search_keywords_salidzini: 'Kingston Fury Beast 6000 64GB', search_keywords_amazon: 'Kingston Fury Beast 64GB 6000MT/s', positive_keywords: '64gb',  negative_keywords: '32gb, 16gb' },
  { name: 'Samsung 990 PRO 2TB',          target_price: 170,  part_number: 'MZ-V9P2T0BW',   search_keywords_salidzini: 'Samsung 990 PRO 2TB',           search_keywords_amazon: 'Samsung 990 PRO 2TB NVMe',     positive_keywords: '990, 2tb',  negative_keywords: 'heatsink, radiator, cooler' },
  { name: 'be quiet! Dark Power Pro 13 1600W', target_price: 370, part_number: 'BN333',      search_keywords_salidzini: 'Dark Power Pro 13 1600W',        search_keywords_amazon: 'be quiet Dark Power Pro 13 1600W', positive_keywords: '1600w', negative_keywords: 'cable, vads, adapter' },
  { name: 'Noctua NH-D15 G2 LBC',         target_price: 152,  part_number: 'NH-D15 G2 LBC', search_keywords_salidzini: 'Noctua NH-D15 G2 LBC',          search_keywords_amazon: 'Noctua NH-D15 G2 LBC',         positive_keywords: 'g2',        negative_keywords: 'mounting, bracket, kit, stiprinājums' },
  { name: 'Fractal Design Meshify 3 XL',  target_price: 174,  part_number: '',               search_keywords_salidzini: 'Meshify 3 XL',                  search_keywords_amazon: 'Fractal Design Meshify 3 XL',  positive_keywords: 'xl',        negative_keywords: 'panel, stikls, glass' },
  { name: 'Arctic P14 PWM PST',           target_price: 8,    part_number: 'ACFAN00138A',   search_keywords_salidzini: 'Arctic P14 PWM PST Black 140mm', search_keywords_amazon: 'Arctic P14 PWM PST 140mm',     positive_keywords: 'p14',       negative_keywords: 'slim, bionix, 120mm' },
  { name: 'Nvidia RTX 3090 (24GB)',        target_price: 700,  part_number: '',               search_keywords_salidzini: 'RTX 3090',                      search_keywords_amazon: 'Nvidia RTX 3090 24GB',         positive_keywords: '3090',      negative_keywords: 'dators, datoru, block, priekš, cable, waterblock' },
  { name: 'Nvidia RTX 4090 (24GB)',        target_price: 1800, part_number: '',               search_keywords_salidzini: 'RTX 4090',                      search_keywords_amazon: 'Nvidia RTX 4090 24GB',         positive_keywords: '4090',      negative_keywords: 'dators, datoru, block, priekš, cable, waterblock' },
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
  const hasComponents = await knex.schema.hasTable('components');
  if (!hasComponents) {
    await createTables();
  }
  await seedComponents();

  console.log('✅ База tracker.db готова (таблицы: components, price_logs, alerts_history).');
  await knex.destroy();
}

setup().catch((err) => {
  console.error('Ошибка при создании базы:', err);
  process.exit(1);
});
