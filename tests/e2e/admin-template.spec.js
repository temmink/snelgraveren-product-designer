const { test, expect } = require('@playwright/test');

test.describe('Admin Template Management', () => {
    test('can view template list', async ({ page }) => {
        await page.goto('/wp-admin/admin.php?page=productforge');
        await expect(page.locator('.wp-list-table')).toBeVisible();
    });

    test('can navigate to template builder', async ({ page }) => {
        await page.goto('/wp-admin/admin.php?page=pf-template-builder');
        await expect(page.locator('#pf-template-builder-root')).toBeVisible();
    });
});
