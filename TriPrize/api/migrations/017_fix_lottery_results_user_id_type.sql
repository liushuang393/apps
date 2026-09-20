-- Migration: 017_fix_lottery_results_user_id_type.sql
-- 目的: lottery_results.user_id を users.user_id と同じ UUID 型に揃える
-- 背景: 009 で users.user_id を UUID 化したが lottery_results は VARCHAR のままで、
--       抽選結果取得 API の JOIN が "operator does not exist: character varying = uuid" で必ず失敗していた
-- 注意点: 既存値は UUID 文字列として格納されているため USING 句でキャストする。
--         UUID として解釈できない行があると変換に失敗するので、事前に不正データを除去する

BEGIN;

-- UUID 形式でない行は参照不能なデータなので削除する
DELETE FROM lottery_results
WHERE user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

ALTER TABLE lottery_results
ALTER COLUMN user_id TYPE UUID USING user_id::uuid;

COMMENT ON COLUMN lottery_results.user_id IS '当選者のユーザーID（users.user_id と同じ UUID 型）';

COMMIT;
