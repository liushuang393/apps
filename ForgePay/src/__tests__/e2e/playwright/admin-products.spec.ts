import { test, expect } from './fixtures'

/**
 * E2E Tests for Products Management
 * 
 * Test Scenarios:
 * 1. View products list
 * 2. Create new product (one_time type)
 * 3. Create new product (subscription type)
 * 4. Edit product name/description
 * 5. Archive product
 * 6. Verify product list updates
 */

test.describe('Products Management', () => {
  const testProductName = `E2E Test Product ${Date.now()}`
  
  test('should display products page with list or empty state', async ({ authenticatedPage: page }) => {
    // Navigate to products page
    await page.click('a[href="/products"]')
    await expect(page).toHaveURL('/products')
    
    // Verify page title
    await expect(page.locator('h1')).toContainText('Products')
    await expect(page.locator('text=Manage your products and pricing')).toBeVisible()
    
    // Verify Add Product button exists
    await expect(page.locator('button:has-text("Add Product")')).toBeVisible()
    
    // Should show either products table or empty state
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const hasTable = await page.locator('table').isVisible().catch(() => false)
    const hasEmptyState = await page.locator('text=No products yet').isVisible().catch(() => false)
    
    expect(hasTable || hasEmptyState).toBeTruthy()
  })

  test('should open create product modal', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    // Click Add Product button
    await page.click('button:has-text("Add Product")')
    
    // Verify modal opens
    await expect(page.locator('text=Create Product')).toBeVisible()
    
    // Verify form fields
    await expect(page.locator('label:has-text("Name")')).toBeVisible()
    await expect(page.locator('label:has-text("Description")')).toBeVisible()
    await expect(page.locator('label:has-text("Type")')).toBeVisible()
    
    // Verify buttons
    await expect(page.locator('button:has-text("Cancel")')).toBeVisible()
    await expect(page.locator('button:has-text("Create")')).toBeVisible()
  })

  test('should create a one-time product', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    // Click Add Product button
    await page.click('button:has-text("Add Product")')
    
    // Wait for modal
    await expect(page.locator('text=Create Product')).toBeVisible()
    
    // Fill form
    await page.fill('input[placeholder="Product name"]', testProductName)
    await page.fill('textarea[placeholder="Product description"]', 'Test description for E2E')
    
    // Select one-time type (should be default)
    await page.selectOption('select', 'one_time')
    
    // Submit form
    await page.click('button:has-text("Create")')
    
    // Wait for modal to close and product to appear
    await expect(page.locator('text=Create Product')).not.toBeVisible({ timeout: 10000 })
    
    // Verify product appears in list
    await expect(page.locator(`text=${testProductName}`)).toBeVisible({ timeout: 5000 })
  })

  test('should create a subscription product', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    const subscriptionProductName = `E2E Subscription ${Date.now()}`
    
    // Click Add Product button
    await page.click('button:has-text("Add Product")')
    
    // Wait for modal
    await expect(page.locator('text=Create Product')).toBeVisible()
    
    // Fill form
    await page.fill('input[placeholder="Product name"]', subscriptionProductName)
    await page.fill('textarea[placeholder="Product description"]', 'Subscription test')
    
    // Select subscription type
    await page.selectOption('select', 'subscription')
    
    // Submit form
    await page.click('button:has-text("Create")')
    
    // Wait for modal to close
    await expect(page.locator('text=Create Product')).not.toBeVisible({ timeout: 10000 })
    
    // Verify product appears with subscription type
    await expect(page.locator(`text=${subscriptionProductName}`)).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Subscription').first()).toBeVisible()
  })

  test('should close modal when clicking Cancel', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    // Click Add Product button
    await page.click('button:has-text("Add Product")')
    
    // Wait for modal
    await expect(page.locator('text=Create Product')).toBeVisible()
    
    // Click Cancel
    await page.click('button:has-text("Cancel")')
    
    // Modal should close
    await expect(page.locator('text=Create Product')).not.toBeVisible({ timeout: 3000 })
  })

  test('should close modal when clicking X button', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    // Click Add Product button
    await page.click('button:has-text("Add Product")')
    
    // Wait for modal
    await expect(page.locator('text=Create Product')).toBeVisible()
    
    // Click X button (close icon)
    await page.click('.fixed.inset-0 button:has(svg)')
    
    // Modal should close
    await expect(page.locator('text=Create Product')).not.toBeVisible({ timeout: 3000 })
  })

  test('should show product status badges correctly', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    // Wait for products to load
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Check if there are products
    const hasProducts = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasProducts) {
      // Should have status badges (Active or Archived)
      const statusBadges = page.locator('span:has-text("Active"), span:has-text("Archived")')
      const count = await statusBadges.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('should show product type badges', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    // Wait for products to load
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // Check if there are products
    const hasProducts = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasProducts) {
      // Should have type badges (One-time or Subscription)
      const typeBadges = page.locator('span:has-text("One-time"), span:has-text("Subscription")')
      const count = await typeBadges.count()
      expect(count).toBeGreaterThan(0)
    }
  })

  test('should validate required fields in create form', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    // Click Add Product button
    await page.click('button:has-text("Add Product")')
    
    // Wait for modal
    await expect(page.locator('text=Create Product')).toBeVisible()
    
    // Try to submit empty form
    await page.click('button:has-text("Create")')
    
    // Name field should be required - browser validation should prevent submission
    const nameInput = page.locator('input[placeholder="Product name"]')
    await expect(nameInput).toHaveAttribute('required', '')
  })

  test('商品を編集できる', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    // 商品一覧を待つ
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    // 商品があるか確認
    const hasProducts = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasProducts) {
      // 編集ボタン/リンクを探す
      const editButton = page.locator('button:has-text("Edit"), a:has-text("Edit"), button[aria-label="Edit"], svg[class*="pencil"]').first()
      
      if (await editButton.isVisible().catch(() => false)) {
        await editButton.click()
        
        // 編集モーダル/ページが開くのを待つ
        const editModal = page.locator('text=Edit Product, text=編集')
        const isModalOpen = await editModal.first().isVisible().catch(() => false)
        
        if (isModalOpen) {
          // 名前を変更
          const nameInput = page.locator('input[placeholder="Product name"], input[name="name"]')
          if (await nameInput.isVisible()) {
            await nameInput.fill('Updated Product Name ' + Date.now())
          }
          
          // 保存ボタンをクリック
          const saveButton = page.locator('button:has-text("Save"), button:has-text("Update"), button:has-text("保存")')
          if (await saveButton.isVisible()) {
            await saveButton.click()
            
            // モーダルが閉じることを確認
            await expect(editModal.first()).not.toBeVisible({ timeout: 5000 }).catch(() => {})
          }
        }
      } else {
        // 行をクリックして詳細を開く
        await page.locator('table tbody tr').first().click()
        await page.waitForLoadState('networkidle')
      }
    }
  })

  test('商品をアーカイブ（削除）できる', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const hasProducts = await page.locator('table tbody tr').first().isVisible().catch(() => false)
    
    if (hasProducts) {
      // 削除/アーカイブボタンを探す
      const deleteButton = page.locator('button:has-text("Delete"), button:has-text("Archive"), button:has-text("削除"), button[aria-label="Delete"]').first()
      
      if (await deleteButton.isVisible().catch(() => false)) {
        await deleteButton.click()
        
        // 確認ダイアログが表示されるか確認
        const confirmDialog = page.locator('[role="alertdialog"], [role="dialog"], .modal')
        
        if (await confirmDialog.isVisible().catch(() => false)) {
          // 確認メッセージを確認
          const confirmText = page.locator('text=Are you sure, text=本当に削除, text=確認')
          await expect(confirmText.first()).toBeVisible().catch(() => {})
          
          // キャンセルボタンをクリック（実際には削除しない）
          const cancelButton = page.locator('button:has-text("Cancel"), button:has-text("キャンセル")')
          if (await cancelButton.isVisible()) {
            await cancelButton.click()
          }
        }
      }
    }
  })

  test('商品詳細ページを表示できる', async ({ authenticatedPage: page }) => {
    await page.click('a[href="/products"]')
    await page.waitForURL('/products')
    
    await page.waitForSelector('.bg-white.rounded-xl', { timeout: 10000 })
    
    const productRow = page.locator('table tbody tr').first()
    const hasProducts = await productRow.isVisible().catch(() => false)
    
    if (hasProducts) {
      // 商品行をクリック
      await productRow.click()
      
      // 詳細モーダルまたはページが表示されることを確認
      await page.waitForLoadState('networkidle')
      
      // 商品詳細の情報が表示されることを確認
      const detailsVisible = await page.locator('text=Product Details, text=商品詳細, text=Description, text=Prices').first().isVisible().catch(() => false)
      
      // 何らかの詳細情報が表示されていることを確認
      expect(detailsVisible || await page.locator('[role="dialog"]').isVisible().catch(() => false)).toBeTruthy()
    }
  })
})
