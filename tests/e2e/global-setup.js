const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

module.exports = async () => {
    const authDir = path.join(__dirname, '.auth');
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto('http://localhost:8080/wp-login.php');
    await page.fill('#user_login', 'admin');
    await page.fill('#user_pass', 'admin');
    await page.click('#wp-submit');
    await page.waitForURL('**/wp-admin/**');

    await page.context().storageState({ path: path.join(authDir, 'admin.json') });
    await browser.close();
};
