-- admin@triprize.comの権限確認用SQL
-- 目的: 指定されたメールアドレスのユーザーの現在の権限を確認

SELECT 
    user_id,
    email,
    role,
    display_name,
    created_at,
    updated_at
FROM users 
WHERE email = 'admin@triprize.com';
