const { test, expect } = require('@playwright/test');

test.describe('Admin Template Management', () => {
    test('can view template list', async ({ page }) => {
        await page.goto('/wp-admin/admin.php?page=product-designer');
        await expect(page.locator('.wp-list-table')).toBeVisible();
    });

    test('can navigate to template builder', async ({ page }) => {
        await page.goto('/wp-admin/admin.php?page=pd-template-builder');
        await expect(page.locator('#pd-template-builder-root')).toBeVisible();
    });
});
