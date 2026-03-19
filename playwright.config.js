const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    globalSetup: './tests/e2e/global-setup.js',
    use: {
        baseURL: 'http://localhost:8080',
        storageState: './tests/e2e/.auth/admin.json',
        screenshot: 'only-on-failure',
    },
    timeout: 30000,
});
