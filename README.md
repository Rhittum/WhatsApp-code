# Code Bot

A casual WhatsApp bot built using raw sockets (@whiskeysockets/baileys). It lets you run code straight from your phone, snaps visual previews of links using a headless browser, and throws a couple of chaotic media commands into the chat when you need them.
✨ What it does

💻 Run Code (!run)

--- Executes snippets right from a chat message. It passes the code to a local Piston API engine running on your computer and text-replies with the console output.

You can pass standard user input by using a ---input--- separator line.

🌐 Link Previews (!info)

--- Fires up a hidden Puppeteer browser instance behind the scenes, navigates to the URL you sent, snaps a screenshot, and uploads it as a photo message with the site's title and description.

--- Smart bypass: If you link something heavy like Spotify or YouTube, it skips opening the browser entirely and just grabs the basic text metadata using Axios/Cheerio so your server doesn't lag out.

🪙 Coin Flipper (!cointoss)

--- Generates a 50/50 heads-or-tails result, pulls a local .mp4 animation file (heads-animation.mp4 or tails-animation.mp4), and loops it as an autoplaying WhatsApp GIF.

🐸 Pog Spammer (!pog)

--- Sends a quick stream of pog.mp4 loops based on how many times you mention it in the message. It has a built-in cap of 10 pogs max so you don't accidentally bomb your own chat logs.

--- Auto Terminal Cleaner
--- Wipes your running terminal screen clean every 10 minutes (600000ms) so your log screen stays nice, neat, and readable.

## Things you need installed

Make sure you have these ready on your laptop before running the script:

   Node.js (obviously)
   Piston API Engine running locally on port 2000 (or you can edit the port inside index.js).

   Local files: You need three video files sitting right in your project folder:

   heads-animation.mp4

   tails-animation.mp4

   pog.mp4

## How to set it up

   Grab the dependencies:
   Bash

   npm install @whiskeysockets/baileys qrcode-terminal axios pino puppeteer fs-extra cheerio

   Fire up the bot:
   Bash

   node index.js

   Scan the QR Code:
    The first time you boot it, a QR code made of text blocks will appear right in your terminal window. Open WhatsApp on your phone, go to Linked Devices -> Link a Device, and scan your terminal screen. Your session data will save into a folder called /auth_info so you only have to scan once.

## Cheatsheet for Commands
1. Running Code

```
!run <language>
<your code>
---input---
[optional standard input/inputs]
```

### Example:

```
    !run python
    import sys
    name = sys.stdin.read()
    print(f"Hello, {name}!")
    ---input---
    Rhittum
```

2. Website Previews

```
!info github.com
```

3. Coin Toss
```
!cointoss
```

4. Pog Spammer
```
!pog !pog !pog
```
(Will send exactly 3 looped videos back-to-back).
