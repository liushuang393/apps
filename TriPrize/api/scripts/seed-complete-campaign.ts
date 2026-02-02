import { pool } from '../src/config/database.config';
import { generateUUID } from '../src/utils/crypto.util';

/**
 * Create a complete test campaign with all related data
 */
async function seedCompleteCampaign() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Creating complete test campaign...');

    // Campaign data
    const campaignId = generateUUID();
    const baseLength = 5; // 5層の三角形
    const positionsTotal = (baseLength * (baseLength + 1)) / 2; // 15 positions

    // Layer prices (上層ほど高い)
    const layerPrices: { [key: string]: number } = {
      '1': 10000, // Layer 1: 1 position
      '2': 8000,  // Layer 2: 2 positions
      '3': 6000,  // Layer 3: 3 positions
      '4': 4000,  // Layer 4: 4 positions
      '5': 2000,  // Layer 5: 5 positions
    };

    // Insert campaign
    await client.query(
      `INSERT INTO campaigns (
        campaign_id, name, description, base_length, positions_total,
        layer_prices, profit_margin_percent, purchase_limit,
        status, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
      [
        campaignId,
        '豪華賞品抽選キャンペーン',
        '合計15ポジションの三角形抽選！豪華賞品が当たるチャンス！',
        baseLength,
        positionsTotal,
        JSON.stringify(layerPrices),
        25.5, // profit margin
        8,    // purchase limit per user
        'published', // 公開状態
        'a0000000-0000-0000-0000-000000000001', // creator (existing admin)
      ]
    );

    console.log(`✓ Campaign created: ${campaignId}`);

    // Create layers
    const layerIdMap: { [key: number]: string } = {};
    for (let layerNumber = 1; layerNumber <= baseLength; layerNumber++) {
      const layerId = generateUUID();
      const positionsCount = layerNumber; // Layer 1 has 1, Layer 2 has 2, etc.
      const price = layerPrices[layerNumber.toString()];

      await client.query(
        `INSERT INTO layers (
          layer_id, campaign_id, layer_number, positions_count, price,
          positions_sold, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW())`,
        [layerId, campaignId, layerNumber, positionsCount, price]
      );

      layerIdMap[layerNumber] = layerId;
      console.log(`✓ Layer ${layerNumber} created: ${positionsCount} positions at ¥${price}`);
    }

    // Create positions
    let positionCount = 0;
    for (let layerNumber = 1; layerNumber <= baseLength; layerNumber++) {
      const layerId = layerIdMap[layerNumber];
      const price = layerPrices[layerNumber.toString()];

      for (let col = 0; col < layerNumber; col++) {
        await client.query(
          `INSERT INTO positions (
            position_id, campaign_id, layer_id, layer_number,
            row_number, col_number, price, status,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'available', NOW(), NOW())`,
          [
            generateUUID(),
            campaignId,
            layerId,
            layerNumber,
            layerNumber, // row_number same as layer_number
            col,
            price,
          ]
        );
        positionCount++;
      }
    }

    console.log(`✓ Created ${positionCount} positions`);

    // Create prizes
    const prizes = [
      {
        name: '特賞: 最新スマートフォン',
        description: '最新モデルのスマートフォン',
        rank: 1,
        quantity: 1,
        value: 100000,
      },
      {
        name: '1等: ワイヤレスイヤホン',
        description: 'ノイズキャンセリング付き高級イヤホン',
        rank: 2,
        quantity: 2,
        value: 30000,
      },
      {
        name: '2等: Amazonギフト券5,000円分',
        description: 'オンラインショッピングに使える',
        rank: 3,
        quantity: 3,
        value: 5000,
      },
      {
        name: '3等: スタバカード1,000円分',
        description: 'お好きな飲み物をどうぞ',
        rank: 4,
        quantity: 5,
        value: 1000,
      },
    ];

    for (const prize of prizes) {
      await client.query(
        `INSERT INTO prizes (
          prize_id, campaign_id, name, description, rank, quantity, value,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          generateUUID(),
          campaignId,
          prize.name,
          prize.description,
          prize.rank,
          prize.quantity,
          prize.value,
        ]
      );
      console.log(`✓ Prize created: ${prize.name} (x${prize.quantity})`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Complete test campaign created successfully!');
    console.log(`Campaign ID: ${campaignId}`);
    console.log(`Total positions: ${positionsTotal}`);
    console.log(`Status: published`);
    console.log('\nYou can now test the mobile app with this campaign.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating campaign:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the seed script
seedCompleteCampaign()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
