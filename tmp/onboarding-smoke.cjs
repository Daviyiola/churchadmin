const { chromium } = require('playwright');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();await page.goto('http://localhost:3000/get-started');await page.screenshot({path:'tmp/onboarding-before-qa.png',fullPage:true});console.log(await page.title());await browser.close();})().catch(e=>{console.error(e);process.exitCode=1});
