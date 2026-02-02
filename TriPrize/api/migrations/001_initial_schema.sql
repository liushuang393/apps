-- TriPrize Database Schema
-- Migration: 001_initial_schema
-- Created: 2025-11-11

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =======================
-- 1. Users Table
-- =======================
CREATE TABLE users (
  user_id UUID PRIMARY KEY,

  -- Profile
  display_name VARCHAR(255),
  email VARCHAR(255) NOT NULL UNIQUE,
  phone_number VARCHAR(20),
  photo_url VARCHAR(500),

  -- Role
  role VARCHAR(20) NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),

  -- Push Notifications
  fcm_token VARCHAR(500),
  notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- Statistics
  total_purchases INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  prizes_won INTEGER NOT NULL DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_fcm_token ON users(fcm_token) WHERE fcm_token IS NOT NULL;

-- =======================
-- 2. Campaigns Table
-- =======================
CREATE TABLE campaigns (
  campaign_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Basic Info
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  image_url VARCHAR(500) NOT NULL,

  -- Triangle Structure
  base_length INTEGER NOT NULL CHECK (base_length BETWEEN 3 AND 50),
  positions_total INTEGER NOT NULL,
  positions_sold INTEGER NOT NULL DEFAULT 0,

  -- Pricing
  layer_prices JSONB NOT NULL,
  total_revenue INTEGER NOT NULL DEFAULT 0,
  profit_margin_percent DECIMAL(5,2) NOT NULL,

  -- Purchase Limit
  purchase_limit INTEGER CHECK (purchase_limit > 0),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'published', 'active', 'sold_out', 'drawn', 'completed', 'cancelled')
  ),

  -- Timestamps
  start_date TIMESTAMP NOT NULL,
  end_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  published_at TIMESTAMP,
  sold_out_at TIMESTAMP,
  drawn_at TIMESTAMP,

  -- Creator
  created_by UUID NOT NULL REFERENCES users(user_id),

  -- Constraints
  CONSTRAINT positions_sold_not_exceed_total CHECK (positions_sold <= positions_total),
  CONSTRAINT start_before_end CHECK (start_date < end_date),
  CONSTRAINT profit_margin_valid CHECK (profit_margin_percent >= 0 AND profit_margin_percent <= 100)
);

CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_dates ON campaigns(start_date, end_date);
CREATE INDEX idx_campaigns_created_by ON campaigns(created_by);
CREATE INDEX idx_campaigns_sold_out ON campaigns(sold_out_at) WHERE sold_out_at IS NOT NULL;

-- =======================
-- 3. Layers Table
-- =======================
CREATE TABLE layers (
  layer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,

  -- Layer Info
  layer_number INTEGER NOT NULL CHECK (layer_number > 0),
  positions_count INTEGER NOT NULL CHECK (positions_count > 0),
  price INTEGER NOT NULL CHECK (price >= 100),

  -- Statistics
  positions_sold INTEGER NOT NULL DEFAULT 0,
  positions_available INTEGER NOT NULL,

  -- Constraints
  CONSTRAINT positions_sold_not_exceed_count CHECK (positions_sold <= positions_count),
  CONSTRAINT positions_available_consistent CHECK (positions_available = positions_count - positions_sold),
  UNIQUE(campaign_id, layer_number)
);

CREATE INDEX idx_layers_campaign ON layers(campaign_id);
CREATE INDEX idx_layers_available ON layers(campaign_id, positions_available) WHERE positions_available > 0;

-- =======================
-- 4. Positions Table
-- =======================
CREATE TABLE positions (
  position_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  layer_id UUID NOT NULL REFERENCES layers(layer_id) ON DELETE CASCADE,

  -- Coordinates
  layer_number INTEGER NOT NULL,
  row_number INTEGER NOT NULL,
  col_number INTEGER NOT NULL,

  -- Price
  price INTEGER NOT NULL CHECK (price >= 100),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (
    status IN ('available', 'reserved', 'sold', 'expired')
  ),

  -- Owner
  user_id UUID REFERENCES users(user_id),
  reserved_at TIMESTAMP,
  sold_at TIMESTAMP,

  -- Constraints
  UNIQUE(campaign_id, row_number, col_number),
  CONSTRAINT position_user_consistency CHECK (
    (status = 'available' AND user_id IS NULL) OR
    (status IN ('reserved', 'sold') AND user_id IS NOT NULL)
  ),
  CONSTRAINT sold_timestamp_consistency CHECK (
    (status = 'sold' AND sold_at IS NOT NULL) OR
    (status != 'sold' AND sold_at IS NULL)
  )
);

CREATE INDEX idx_positions_campaign_layer ON positions(campaign_id, layer_number);
CREATE INDEX idx_positions_allocation ON positions(campaign_id, layer_number, status) WHERE status = 'available';
CREATE INDEX idx_positions_user ON positions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_positions_reserved ON positions(reserved_at) WHERE status = 'reserved';

-- =======================
-- 5. Prizes Table
-- =======================
CREATE TABLE prizes (
  prize_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,

  -- Prize Info
  rank INTEGER NOT NULL CHECK (rank > 0),
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  image_url VARCHAR(500),
  value INTEGER NOT NULL CHECK (value >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),

  -- Winning
  winning_layer_number INTEGER CHECK (winning_layer_number > 0),
  winning_position_id UUID REFERENCES positions(position_id),
  winner_user_id UUID REFERENCES users(user_id),

  -- Status
  awarded BOOLEAN NOT NULL DEFAULT FALSE,
  awarded_at TIMESTAMP,

  UNIQUE(campaign_id, rank)
);

CREATE INDEX idx_prizes_campaign ON prizes(campaign_id);
CREATE INDEX idx_prizes_winner ON prizes(winner_user_id) WHERE winner_user_id IS NOT NULL;

-- =======================
-- 6. Purchases Table
-- =======================
CREATE TABLE purchases (
  purchase_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relations
  user_id UUID NOT NULL REFERENCES users(user_id),
  campaign_id UUID NOT NULL REFERENCES campaigns(campaign_id),
  position_id UUID NOT NULL REFERENCES positions(position_id),

  -- Purchase Info
  price INTEGER NOT NULL CHECK (price >= 100),
  purchase_method VARCHAR(20) NOT NULL CHECK (
    purchase_method IN ('credit_card', 'debit_card', 'konbini')
  ),

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'reserved', 'completed', 'failed', 'refunded', 'cancelled')
  ),

  -- Idempotency
  request_id VARCHAR(255) NOT NULL,
  request_body_hash VARCHAR(64) NOT NULL,

  -- Stripe
  payment_intent_id VARCHAR(255),

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reserved_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,

  -- Constraints
  UNIQUE(request_id),
  UNIQUE(position_id)
);

CREATE INDEX idx_purchases_user ON purchases(user_id);
CREATE INDEX idx_purchases_campaign ON purchases(campaign_id);
CREATE INDEX idx_purchases_user_campaign ON purchases(user_id, campaign_id)
  WHERE status IN ('reserved', 'completed');
CREATE INDEX idx_purchases_request_id ON purchases(request_id);
CREATE INDEX idx_purchases_payment_intent ON purchases(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE INDEX idx_purchases_status ON purchases(status);

-- =======================
-- 7. Payment Transactions Table
-- =======================
CREATE TABLE payment_transactions (
  transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relations
  purchase_id UUID NOT NULL REFERENCES purchases(purchase_id),

  -- Stripe Info
  stripe_payment_intent_id VARCHAR(255) NOT NULL,
  stripe_charge_id VARCHAR(255),
  stripe_customer_id VARCHAR(255),

  -- Payment Info
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'JPY',
  payment_method_type VARCHAR(50) NOT NULL,

  -- Status
  status VARCHAR(50) NOT NULL CHECK (
    status IN ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'refunded')
  ),

  -- Konbini Info
  konbini_store_name VARCHAR(50),
  konbini_confirmation_number VARCHAR(20),
  konbini_payment_deadline TIMESTAMP,
  konbini_receipt_url VARCHAR(500),

  -- Webhook
  webhook_received_at TIMESTAMP,
  webhook_event_id VARCHAR(255),

  -- Error Info
  failure_code VARCHAR(100),
  failure_message TEXT,

  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  succeeded_at TIMESTAMP,
  failed_at TIMESTAMP,

  UNIQUE(stripe_payment_intent_id)
);

CREATE INDEX idx_payment_transactions_purchase ON payment_transactions(purchase_id);
CREATE INDEX idx_payment_transactions_stripe_id ON payment_transactions(stripe_payment_intent_id);
CREATE INDEX idx_payment_transactions_status ON payment_transactions(status);
CREATE INDEX idx_payment_transactions_webhook ON payment_transactions(webhook_event_id)
  WHERE webhook_event_id IS NOT NULL;
CREATE INDEX idx_payment_transactions_konbini_deadline ON payment_transactions(konbini_payment_deadline)
  WHERE konbini_payment_deadline IS NOT NULL AND status = 'pending';

-- =======================
-- 8. Notifications Table
-- =======================
CREATE TABLE notifications (
  notification_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Recipient
  user_id UUID NOT NULL REFERENCES users(user_id),

  -- Content
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  notification_type VARCHAR(50) NOT NULL CHECK (
    notification_type IN ('purchase_confirmed', 'payment_pending', 'lottery_drawn',
                          'prize_won', 'campaign_ending', 'admin_message')
  ),

  -- Relations
  campaign_id UUID REFERENCES campaigns(campaign_id),
  purchase_id UUID REFERENCES purchases(purchase_id),
  prize_id UUID REFERENCES prizes(prize_id),

  -- Data
  data JSONB,

  -- Sending
  sent BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at TIMESTAMP,
  fcm_message_id VARCHAR(255),

  -- Error
  error_code VARCHAR(100),
  error_message TEXT,

  -- Read Status
  read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX idx_notifications_sent ON notifications(sent, sent_at);
CREATE INDEX idx_notifications_type ON notifications(notification_type);
CREATE INDEX idx_notifications_campaign ON notifications(campaign_id) WHERE campaign_id IS NOT NULL;

-- =======================
-- Triggers
-- =======================

-- Update campaigns.updated_at
CREATE OR REPLACE FUNCTION update_campaign_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_campaign_updated_at
BEFORE UPDATE ON campaigns
FOR EACH ROW
EXECUTE FUNCTION update_campaign_timestamp();

-- Update layers.positions_available
CREATE OR REPLACE FUNCTION update_layer_availability()
RETURNS TRIGGER AS $$
BEGIN
  NEW.positions_available = NEW.positions_count - NEW.positions_sold;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_layer_availability
BEFORE INSERT OR UPDATE ON layers
FOR EACH ROW
EXECUTE FUNCTION update_layer_availability();

-- Update payment_transactions.updated_at
CREATE OR REPLACE FUNCTION update_payment_transaction_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_transaction_updated_at
BEFORE UPDATE ON payment_transactions
FOR EACH ROW
EXECUTE FUNCTION update_payment_transaction_timestamp();

-- Update users.updated_at
CREATE OR REPLACE FUNCTION update_user_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_user_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_user_timestamp();

-- =======================
-- Initial Data
-- =======================
-- 注意: 管理者ユーザーは手動で登録する
-- admin@triprize.com で登録すると、自動的に role='admin' になる
-- （後端コードで制御：user.controller.ts の effectiveRole ロジック参照）

-- Commit
COMMIT;
