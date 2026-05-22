const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const pino = require('pino')
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs-extra');
const { exec } = require('child_process');

async function generateVisualPreview(url) {
	const browser = await puppeteer.launch();
	const page = await browser.newPage();

	await page.goto(url, { waitUntil: 'networkidle0' });

	// Capture a screenshot for the preview
	await page.screenshot({ path: 'preview.png', fullPage: false });

	const metadata = await page.evaluate(() => {
		// Helper to easily grab content from meta tags
		const getMeta = (propertyOrName) => {
			const element = document.querySelector(`meta[property="${propertyOrName}"], meta[name="${propertyOrName}"]`);
			return element ? element.getAttribute('content') : null;
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

	return { metadata, screenshotPath: 'preview.png' };
}

async function startBot() {
	// 1. Set up authentication state (Saves session inside the "auth_info" folder)
	const { state, saveCreds } = await useMultiFileAuthState('auth_info');

	// 2. Initialize the direct WebSocket connection
	const sock = makeWASocket({
		auth: state,
		printQRInTerminal: false, // We'll handle QR printing manually with qrcode-terminal

		logger: pino({ level: 'fatal' }),
		syncFullHistory: false,               // Stops WhatsApp from sending full history
		maxHistoryReplyMs: 1000
	});

	// 3. Listen for connection updates (QR code generation & Reconnects)
	sock.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect, qr } = update;

		// Print the QR code in your terminal when generated
		if (qr) {
			qrcode.generate(qr, { small: true });
		}

		if (connection === 'close') {
			const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
			console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting: ', shouldReconnect);
			// Reconnect if not logged out intentionally
			if (shouldReconnect) startBot();
		} else if (connection === 'open') {
			console.log('Bot is ready to fight nonsense via raw sockets!');
		}
	});

	// 4. Save credentials whenever they update (keeps you logged in)
	sock.ev.on('creds.update', saveCreds);

	// 5. Listen for incoming messages
	sock.ev.on('messages.upsert', async (m) => {
		if (m.type !== 'notify') return;

		const msg = m.messages[0];
		if (!msg.message) return;

		const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

		console.log(`\x1b[32m[LIVE MESSAGE CATCH]\x1b[0m From: ${msg.key.remoteJid} -> "${body}"`);

		if (!body) return;

		if (body.startsWith('!run ')) {
			// 1. Isolate code block and input block cleanly
			const parts = body.split('---input---');
			const rawCodePart = parts[0].trim();
			const userInputData = parts[1] ? (parts[2] ? parts.slice(1).join('---input---').trim() : parts[1].trim()) : '';

			// 2. Safely grab the first line to extract the language
			const lines = rawCodePart.split('\n');
			const firstLine = lines[0].trim(); // This is your "!run python" line

			// Extract the language name by dropping the "!run" command word
			const language = firstLine.replace('!run', '').trim().split(' ')[0];

			// 3. Extract the clean code (everything after the first newline)
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

				// Construct clean metadata text string dynamically
				let captionText = `*${result.metadata.title || 'No Web Title Available'}*\n`;
				if (result.metadata.siteName) captionText += `_Site: ${result.metadata.siteName}_\n`;
				if (result.metadata.description) captionText += `\n${result.metadata.description}\n`;
				captionText += `\n_Generated via Code Bot_`;

				// Fix: Scope variable targeted correctly, metadata object unpacked cleanly
				await sock.sendMessage(msg.key.remoteJid, {
					image: { url: `./${result.screenshotPath}` },
					caption: captionText
				}, { quoted: msg });

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
	});
}

startBot();

