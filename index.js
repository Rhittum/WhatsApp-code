const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino')
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');
const cheerio = require('cheerio');

const CLEAR_INTERVAL_MS = 600000;

setInterval(() => {
    try {
        process.stdout.write('\u001b[2J\u001b[0;0H\u001b[3J');
        
        console.log(`=============================================`);
        console.log(`🤖 Bot Runtime Terminal Cleared Automatically`);
        console.log(`📅 Timestamp: ${new Date().toLocaleTimeString()}`);
        console.log(`=============================================`);
    } catch (error) {
        console.error("Failed to clear terminal:", error.message);
    }
}, CLEAR_INTERVAL_MS);

async function fetchMetadataOnly(url) {
	try {
		const response = await axios.get(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*,q=0.8',
				'Accept-Language': 'en=US,en,q=0.5'
			},
			timeout: 7000,
			maxRedirects: 5
		});
		const $ = cheerio.load(response.data);

		const metadata = {
			title: $('meta[property="og:title"]').attr('content') || $('title').text() || 'Webpage Preview',
			siteName: $('meta[property="og:site_name"]').attr('content') || 'Link',
			description: $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '',
			image: $('meta[property="og:image"]').attr('content') || '', 
			themeColor: $('meta[name="theme-color"]').attr('content') || '#1DB954'
		};

		return { metadata, screenshotPath: null, useMetaImage: true };
	} catch (err) {
		console.error("Axios fallback scraping failed:", err.message);
		return {
			metadata: { title: 'Web Link Snapshot', siteName: 'External URL', description: url, image: '', themeColor: '#666666' }
		}; }
}

async function generateVisualPreview(url) {
	const domain = new URL(url).hostname.toLowerCase();

	if (domain.includes('spotify.com') || domain.includes('youtube.com') || domain.includes('youtu.be')) {
		console.log(`🥷 Bypassing heavy browser layout engine for media domain: ${domain}`);
		return await fetchMetadataOnly(url);
	}

	console.log(`🌐 Launching headless browser rendering pipeline for: ${domain}`);
	const browser = await puppeteer.launch({
		headless: 'new',
		args: ['--no-sandbox', '--disable-setuid-sandbox'],
	});

	try {
		const page = await browser.newPage();
		await page.setViewport({ width: 1000, height: 600 });

		await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

		const screenshotPath = `temp_preview_${Date.now()}.png`;
		await page.screenshot(setTimeout(3000), { path: screenshotPath, fullPage: false });

		const metadata = await page.evaluate(() => {
			const getMeta = (prop) => {
				const el = document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`);
				return el ? el.getAttribute('content') : null;
			};
			return {
				title: document.title,
				siteName: getMeta('og:site_name'),
				description: getMeta('og:description') || getMeta('description'),
				image: getMeta('og:image'),
				themeColor: getMeta('theme-color')
			};
		});

		await browser.close();
		return { metadata, screenshotPath, useMetaImage: false };

	} catch (err) {
		await browser.close();
		console.error("Puppeteer rendering failure, attempting hard text extraction fallback...");
		return await fetchMetadataOnly(url); 
	}
}

async function startBot() {
	const { state, saveCreds } = await useMultiFileAuthState('auth_info');

	const sock = makeWASocket({
		auth: state,
		printQRInTerminal: false, 

		logger: pino({ level: 'fatal' }),
		syncFullHistory: false,               
		maxHistoryReplyMs: 1000
	});

	sock.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect, qr } = update;

		if (qr) {
			qrcode.generate(qr, { small: true });
		}

		if (connection === 'close') {
			const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
			console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting: ', shouldReconnect);
			if (shouldReconnect) startBot();
		} else if (connection === 'open') {
			console.log('Bot is ready to fight nonsense via raw sockets!');
		}
	});

	sock.ev.on('creds.update', saveCreds);

	sock.ev.on('messages.upsert', async (m) => {
		if (m.type !== 'notify') return;

		const msg = m.messages[0];
		if (!msg.message) return;

		const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

		console.log(`\x1b[32m[LIVE MESSAGE CATCH]\x1b[0m From: ${msg.key.remoteJid} -> "${body}"`);

		if (!body) return;

		if (body.startsWith('!run ')) {
			const parts = body.split('---input---');
			const rawCodePart = parts[0].trim();
			const userInputData = parts[1] ? (parts[2] ? parts.slice(1).join('---input---').trim() : parts[1].trim()) : '';

			const lines = rawCodePart.split('\n');
			const firstLine = lines[0].trim();
			const language = firstLine.replace('!run', '').trim().split(' ')[0];

			const code = lines.slice(1).join('\n').trim();

			if (!language || !code) {
				await sock.sendMessage(msg.key.remoteJid, { text: 'Usage: !run <language>\n<code>' }, { quoted: msg });
				return;
			}

			try {
				console.log(`Sending execution request to Piston for: ${language}`);
				const response = await axios.post('http://localhost:2000/api/v2/execute', {
					language: language,
					version: '*',
					files: [{ content: code }],
					stdin: userInputData
				});

				const output = response.data.run.output || 'No output (Code executed successfully).';
				const replyText = `*Language:* ${language}\n*output:*\n\`\`\`\n${output}\`\`\``;

				await sock.sendMessage(msg.key.remoteJid, { text: replyText }, { quoted: msg });
			} catch (error) {
				const errMsg = error.response?.data?.message || error.message;
				await sock.sendMessage(
					msg.key.remoteJid,
					{ text: `Error: ${errMsg}` },
					{ quoted: msg }
				);
			}
		}

		// --- PREVIEW WEBPAGE SNAPSHOT ---
		if (body.startsWith('!info ')) {
			// Fix: Correctly strip the '!info ' command word
			let url = body.replace('!info', '').trim().split(' ')[0];

			if (!url) {
				await sock.sendMessage(chatTarget, { text: 'Usage: !info <url>' }, { quoted: msg });
				return;
			}
			if (!url.startsWith("https://") && !url.startsWith("http://")) url = "https://"+url;

			try {
				console.log(`Launching Puppeteer viewport engine for URL: ${url}`);
				const result = await generateVisualPreview(url);

				if (!result || !result.metadata) {
					return await sock.sendMessage(msg.key.remoteJid, { 
						text: `Could not fetch preview data for this link. The host timed out or refused the connection.` 
					}, { quoted: msg });
				}

				// Construct clean metadata text string dynamically
				let captionText = `*${result.metadata.title || 'No Web Title Available'}*\n`;
				if (result.metadata.siteName) captionText += `_Site: ${result.metadata.siteName}_\n`;
				if (result.metadata.description) captionText += `\n${result.metadata.description}\n`;
				captionText += `\n_Generated via Code Bot_`;

				let options = {};

				if (result.screenshotPath) {
					// Option A: Local PNG screenshot available
					options = {
						image: { url: result.screenshotPath },
						caption: captionText
					};
				} else if (result.metadata.image) {
					// Option B: Fallback to hotlinked OpenGraph image (e.g., Spotify album cover)
					options = {
						image: { url: result.metadata.image },
						caption: captionText
					};
				} else {
					// Option C: No visual imagery found anywhere, fall back to standard text markdown
					options = {
						text: captionText
					};
				}

				// 1. TRANSMIT FIRST - Let Baileys safely process and upload the stream
				await sock.sendMessage(msg.key.remoteJid, options, { quoted: msg });

				// 2. CLEAN UP SECOND - Now that it's sent, it is completely safe to wipe the local file
				if (result.screenshotPath) {
					try {
						await fs.remove(result.screenshotPath);
						console.log(`Successfully cleaned up local cache file: ${result.screenshotPath}`);
					} catch (cleanupErr) {
						console.error("Non-fatal storage cleanup error:", cleanupErr.message);
					}
				}
			} catch (error) {
				console.error("Puppeteer failure processing payload:", error);
				await sock.sendMessage(msg.key.remoteJid, { text: `Failed to compile webpage preview: ${error.message}` }, { quoted: msg });
			}
		}

		if (body.startsWith('!cointoss')) {
			const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
			console.log(`🪙 Triggered toss. Logic decided: ${result}`);
			const outputVideoPath = result == 'Heads' ? path.resolve(__dirname, 'heads-animation.mp4') : path.resolve(__dirname, 'tails-animation.mp4');


			// --- Send Video via Baileys ---
			await sock.sendMessage(msg.key.remoteJid, {
				video: fs.readFileSync(outputVideoPath),
				caption: `🪙 It spun through the air and landed on *${result}*!`,
				gifPlayback: true // Force WhatsApp to autoplay/loop as an animation
			}, { quoted: msg });



		}

		if (body.startsWith('!pog') || body.startsWith('!POG')) {
			const matches = body.match(/!pog/gi);

			let pogCount = matches ? matches.length : 0;

			console.log('Pog requested!');

			const MAX_ALLOWED_POGS = 10; 
			if (pogCount > MAX_ALLOWED_POGS) {
				await sock.sendMessage(msg.key.remoteJid, { 
					text: `⚠️ Max limit is ${MAX_ALLOWED_POGS} pogs at once.` 
				}, { quoted: msg });
				pogCount = MAX_ALLOWED_POGS;
			}

			const gifSource = 'pog.mp4'; 

			for (let i = 0; i < pogCount; i++) {
				await new Promise(resolve => setTimeout(resolve, 200));

				await sock.sendMessage(msg.key.remoteJid, {
					video: { url: gifSource },
					gifPlayback: true, 
				});
			}
		}


	});

}

startBot();

