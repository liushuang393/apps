import { pool } from '../config/database.config';
import logger from './logger.util';
// import { hashPassword } from './crypto.util';
import { generatePositions } from './position-calculator.util';

/**
 * Seed development data
 */
export async function seedDatabase(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    logger.info('Starting database seeding...');

    // Check if data already exists
    const { rows: existingUsers } = await client.query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE role = $1',
      ['customer']
    );

    if (parseInt(existingUsers[0].count, 10) > 1) {
      logger.info('Database already seeded, skipping...');
      await client.query('ROLLBACK');
      return;
    }

    // Create test users
    const testUsers = [
      {
        user_id: '11111111-1111-1111-1111-111111111111',
        email: 'test.user1@example.com',
        display_name: 'Test Customer 1',
        role: 'customer',
      },
      {
        user_id: '22222222-2222-2222-2222-222222222222',
        email: 'test.user2@example.com',
        display_name: 'Test Customer 2',
        role: 'customer',
      },
      {
        user_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        email: 'admin@triprize.com',
        display_name: 'Admin User',
        role: 'admin',
      },
    ];

    for (const user of testUsers) {
      await client.query(
        `INSERT INTO users (user_id, email, display_name, role, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [user.user_id, user.email, user.display_name, user.role]
      );
    }

    logger.info(`✓ Created ${testUsers.length} test users`);

    // Create sample campaigns
    const campaigns = [
      {
        campaign_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: 'Summer Grand Prize Campaign',
        description: 'Win amazing prizes this summer!',
        base_length: 5,
        layer_prices: {
          '1': 500,
          '2': 400,
          '3': 300,
          '4': 200,
          '5': 100,
        },
        profit_margin_percent: 30.0,
        purchase_limit: 10,
        status: 'published',
      },
      {
        campaign_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        name: 'Winter Holiday Special',
        description: 'Holiday prizes await!',
        base_length: 4,
        layer_prices: {
          '1': 1000,
          '2': 800,
          '3': 600,
          '4': 400,
        },
        profit_margin_percent: 25.0,
        purchase_limit: 5,
        status: 'published',
      },
      {
        campaign_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        name: 'Test Draft Campaign',
        description: 'This is a draft campaign',
        base_length: 3,
        layer_prices: {
          '1': 300,
          '2': 200,
          '3': 100,
        },
        profit_margin_percent: 20.0,
        purchase_limit: null,
        status: 'draft',
      },
    ];

    for (const campaign of campaigns) {
      const positionsTotal = (campaign.base_length * (campaign.base_length + 1)) / 2;

      await client.query(
        `INSERT INTO campaigns (campaign_id, name, description, base_length, positions_total, layer_prices, profit_margin_percent, purchase_limit, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (campaign_id) DO NOTHING`,
        [
          campaign.campaign_id,
          campaign.name,
          campaign.description,
          campaign.base_length,
          positionsTotal,
          JSON.stringify(campaign.layer_prices),
          campaign.profit_margin_percent,
          campaign.purchase_limit,
          campaign.status,
        ]
      );

      // Create layers
      for (let layerNumber = 1; layerNumber <= campaign.base_length; layerNumber++) {
        const positionsInLayer = campaign.base_length - layerNumber + 1;
        const price = campaign.layer_prices[layerNumber.toString() as '1' | '2' | '3' | '4' | '5'];

        await client.query(
          `INSERT INTO layers (campaign_id, layer_number, positions_count, price, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (campaign_id, layer_number) DO NOTHING`,
          [campaign.campaign_id, layerNumber, positionsInLayer, price]
        );
      }

      // Create positions
      const positions = generatePositions(campaign.base_length);
      for (const pos of positions) {
        const price = campaign.layer_prices[pos.layerNumber.toString() as '1' | '2' | '3' | '4' | '5'];

        await client.query(
          `INSERT INTO positions (campaign_id, layer_number, row_number, col_number, price, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'available', NOW(), NOW())
           ON CONFLICT (campaign_id, row_number, col_number) DO NOTHING`,
          [campaign.campaign_id, pos.layerNumber, pos.rowNumber, pos.colNumber, price]
        );
      }

      logger.info(`✓ Created campaign: ${campaign.name} with ${positionsTotal} positions`);
    }

    // Create prizes for first campaign
    const prizes = [
      {
        campaign_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: 'Grand Prize - PlayStation 5',
        description: 'Latest gaming console',
        rank: 1,
        quantity: 1,
        image_url: 'https://via.placeholder.com/400x300?text=PS5',
      },
      {
        campaign_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: '2nd Prize - Nintendo Switch',
        description: 'Portable gaming system',
        rank: 2,
        quantity: 2,
        image_url: 'https://via.placeholder.com/400x300?text=Switch',
      },
      {
        campaign_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: '3rd Prize - AirPods Pro',
        description: 'Wireless earbuds',
        rank: 3,
        quantity: 3,
        image_url: 'https://via.placeholder.com/400x300?text=AirPods',
      },
    ];

    for (const prize of prizes) {
      await client.query(
        `INSERT INTO prizes (campaign_id, name, description, rank, quantity, image_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
        [prize.campaign_id, prize.name, prize.description, prize.rank, prize.quantity, prize.image_url]
      );
    }

    logger.info(`✓ Created ${prizes.length} prizes`);

    // Create some sample purchases for first campaign
    const samplePurchases = [
      {
        user_id: '11111111-1111-1111-1111-111111111111',
        row: 0,
        col: 0,
      },
      {
        user_id: '11111111-1111-1111-1111-111111111111',
        row: 0,
        col: 1,
      },
      {
        user_id: '22222222-2222-2222-2222-222222222222',
        row: 1,
        col: 0,
      },
    ];

    for (const purchase of samplePurchases) {
      // Get position
      const { rows: posRows } = await client.query<{ position_id: string; price: number }>(
        'SELECT position_id, price FROM positions WHERE campaign_id = $1 AND row_number = $2 AND col_number = $3',
        ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', purchase.row, purchase.col]
      );

      if (posRows.length > 0) {
        const position = posRows[0];

        // Update position status
        await client.query(
          'UPDATE positions SET status = $1, user_id = $2, updated_at = NOW() WHERE position_id = $3',
          ['sold', purchase.user_id, position.position_id]
        );

        // Create purchase record
        await client.query(
          `INSERT INTO purchases (purchase_id, user_id, campaign_id, position_id, quantity, price_per_position, total_amount, status, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 1, $4, $4, 'completed', NOW(), NOW())`,
          [purchase.user_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', position.position_id, position.price]
        );

        // Update campaign positions_sold
        await client.query(
          'UPDATE campaigns SET positions_sold = positions_sold + 1, updated_at = NOW() WHERE campaign_id = $1',
          ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']
        );
      }
    }

    logger.info(`✓ Created ${samplePurchases.length} sample purchases`);

    await client.query('COMMIT');
    logger.info('Database seeding completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Database seeding failed', error);
    throw error;
  } finally {
    client.release();
  }
}

// CLI execution
if (require.main === module) {
  seedDatabase()
    .then(() => {
      logger.info('Seed command completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Seed command failed', error);
      process.exit(1);
    });
}

export default { seedDatabase };
