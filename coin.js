const path = require('path');
const puppeteer = require('puppeteer');

async function renderLiveCoinFlip(resultOutcome) {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Set a matching square aspect viewport matching the code styling setup
    await page.setViewport({ width: 400, height: 400 });

    // Load the local template file cleanly into the headless tab context
    const fileUrl = `file://${path.resolve(__dirname, 'assets/coin.html')}`;
    await page.goto(fileUrl);

    console.log(`🎬 Animating coin rotation sequence for: ${resultOutcome}`);
    
    // Execute the global exposed handler function directly inside the webpage scope
    // page.evaluate will pause here until the internal animation promise resolves!
    await page.evaluate(async (outcome) => {
        await window.flipCoin(outcome);
    }, resultOutcome);

    // Grab a pristine snapshot of the finished, settled coin frame!
    await page.screenshot({ path: 'coin-final.png', omitBackground: true });
    
    await browser.close();
    console.log('🏁 Render complete! File saved to coin-final.png');
}

renderLiveCoinFlip();
