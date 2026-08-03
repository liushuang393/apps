-- ルール管理基盤（シナリオ#3）が使う自前テーブル。
--
-- LiteFlow は履歴を持たない。lf_chain / lf_script は (application_name, target_id) で
-- 1行しか持たず、発行のたびに el_data / script_data を上書きするため、前の版は復元できない。
-- lf_change_log は seq / target / op / version だけでペイロードを持たない。
-- したがって履歴・差分・ロールバック・承認・監査はすべてここで自前に持つ。
--
-- 接頭辞は rm_（rule management）。LiteFlow 側の既定接頭辞 lf_ と衝突させないこと。
-- MariaDB と H2（MODE=MySQL）の両方で通る書き方に限定している。

CREATE TABLE IF NOT EXISTS rm_rule_revision (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_name VARCHAR(64)  NOT NULL,
  target_type      VARCHAR(16)  NOT NULL,
  target_id        VARCHAR(128) NOT NULL,
  version          BIGINT       NOT NULL,
  body             TEXT,
  attrs            VARCHAR(512),
  content_md5      VARCHAR(32),
  actor            VARCHAR(64),
  comment_text     VARCHAR(512),
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rm_revision_target
  ON rm_rule_revision (application_name, target_type, target_id, version);

CREATE TABLE IF NOT EXISTS rm_approval (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_name VARCHAR(64)  NOT NULL,
  target_type      VARCHAR(16)  NOT NULL,
  target_id        VARCHAR(128) NOT NULL,
  body             TEXT,
  attrs            VARCHAR(512),
  expected_version BIGINT,
  applied_version  BIGINT,
  status           VARCHAR(16)  NOT NULL,
  requested_by     VARCHAR(64),
  decided_by       VARCHAR(64),
  comment_text     VARCHAR(512),
  decision_note    VARCHAR(512),
  requested_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  decided_at       TIMESTAMP    NULL
);

CREATE INDEX IF NOT EXISTS idx_rm_approval_status
  ON rm_approval (application_name, status);

CREATE TABLE IF NOT EXISTS rm_audit (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  application_name VARCHAR(64)  NOT NULL,
  actor            VARCHAR(64),
  action           VARCHAR(32)  NOT NULL,
  target_type      VARCHAR(16),
  target_id        VARCHAR(128),
  version          BIGINT,
  detail           VARCHAR(1024),
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rm_audit_created
  ON rm_audit (application_name, id);
