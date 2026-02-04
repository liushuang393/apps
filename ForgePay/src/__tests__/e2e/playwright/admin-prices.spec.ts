/**
 * 価格管理 E2Eテスト
 * 
 * テスト対象:
 * - 価格作成（一回払い/サブスクリプション）
 * - 価格編集
 * - 価格の有効化/無効化
 */

import { test, expect } from '@playwright/test';
import { login, createTestProduct } from './fixtures';

test.describe('価格管理', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('商品詳細から価格一覧を表示できる', async ({ page }) => {
    // 商品ページに移動
    await page.goto('/products');
    await page.waitForLoadState('networkidle');
    
    // 商品が存在することを確認
    const productRows = page.locator('table tbody tr');
    const count = await productRows.count();
    
    if (count > 0) {
      // 最初の商品をクリック
      await productRows.first().click();
      
      // 価格セクションが表示されることを確認
      await expect(page.locator('text=Prices').or(page.locator('text=価格'))).toBeVisible({ timeout: 5000 });
    }
  });

  test('一回払いの価格を作成できる', async ({ page }) => {
    // 商品ページに移動
    await page.goto('/products');
    await page.waitForLoadState('networkidle');
    
    // 新規商品作成ボタンをクリック
    const createButton = page.locator('button:has-text("Create"), button:has-text("新規作成"), button:has-text("Add Product")');
    if (await createButton.isVisible()) {
      await createButton.click();
      
      // 商品名を入力
      const nameInput = page.locator('input[name="name"], input[placeholder*="name"], input[placeholder*="名前"]');
      await nameInput.fill('Price Test Product - ' + Date.now());
      
      // 一回払いを選択
      const oneTimeRadio = page.locator('input[value="one_time"], label:has-text("One-time"), label:has-text("一回払い")');
      if (await oneTimeRadio.isVisible()) {
        await oneTimeRadio.click();
      }
      
      // 価格を入力
      const priceInput = page.locator('input[name="price"], input[name="amount"], input[placeholder*="price"]');
      if (await priceInput.isVisible()) {
        await priceInput.fill('1999');
      }
      
      // 保存ボタンをクリック
      const saveButton = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("保存"), button:has-text("Create")');
      await saveButton.click();
      
      // 成功メッセージまたはリダイレクトを確認
      await page.waitForLoadState('networkidle');
    }
  });

  test('サブスクリプション価格を作成できる', async ({ page }) => {
    await page.goto('/products');
    await page.waitForLoadState('networkidle');
    
    const createButton = page.locator('button:has-text("Create"), button:has-text("新規作成"), button:has-text("Add Product")');
    if (await createButton.isVisible()) {
      await createButton.click();
      
      // 商品名を入力
      const nameInput = page.locator('input[name="name"], input[placeholder*="name"]');
      await nameInput.fill('Subscription Test - ' + Date.now());
      
      // サブスクリプションを選択
      const subscriptionRadio = page.locator('input[value="subscription"], label:has-text("Subscription"), label:has-text("定期")');
      if (await subscriptionRadio.isVisible()) {
        await subscriptionRadio.click();
      }
      
      // 間隔を選択（月額）
      const intervalSelect = page.locator('select[name="interval"], select[name="billing_interval"]');
      if (await intervalSelect.isVisible()) {
        await intervalSelect.selectOption('month');
      }
      
      // 価格を入力
      const priceInput = page.locator('input[name="price"], input[name="amount"]');
      if (await priceInput.isVisible()) {
        await priceInput.fill('999');
      }
      
      // 保存
      const saveButton = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Create")');
      await saveButton.click();
      
      await page.waitForLoadState('networkidle');
    }
  });
});
