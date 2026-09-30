# Dirham: a private, offline expense tracker for iPhone

Dirham tracks your spending from **Emirates NBD / Liv bank SMS** and, if you want, from **PDF statements**. Everything is stored on your iPhone only. There is no server, no account and no bank login.

## 1. Put it online once (free, about 10 minutes)

The iPhone has to download the app one time from a web address. After that it runs fully offline.

1. Go to **github.com** and create a free account (skip this if you already have one).
2. Click **+** at the top right, choose **New repository**, name it `dirham`, set it to **Public**, and click **Create repository**.
3. Click **uploading an existing file**. Unzip `dirham.zip` on your computer and drag **everything inside** the `dirham` folder into the page: `index.html`, `app.js`, `app.css`, `parser.js`, `sw.js`, `manifest.webmanifest`, and the `icons` and `vendor` folders. Click **Commit changes**.
4. Open **Settings**, then **Pages**. Under "Branch", choose **main** and **/(root)**, then click **Save**.
5. Wait about a minute. Your app is now at `https://YOUR-USERNAME.github.io/dirham/`

The repository holds only the app's code. Your transactions never go there.

## 2. Install on your iPhone

1. Open that address in **Safari**. It has to be Safari, not Chrome.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Dirham** from your Home Screen once while you're online. From then on it works offline.

## 3. Set up automatic SMS capture

In the app, go to **Import** and tap **Set up automatic SMS capture**. The guide there shows every step, with copy buttons. In short:

- Open the Shortcuts app, then **Automation**, then **+**, then **Message**.
- Set **Message Contains** to `AED`, choose **Run Immediately**, and turn off notifications.
- Add a **Text** action: `##SMS## ` followed by *Current Date* (in ISO 8601 format, with time), a new line, then *Shortcut Input*.
- Add an **Append to Text File** action that writes to `dirham-sms.txt`, with **Make New Line** turned on.

To pull in new messages: open **Import**, tap **Choose dirham-sms.txt**, then go to **iCloud Drive**, then **Shortcuts**, then `dirham-sms.txt`. Messages you've already imported are skipped automatically.

## Features

- A home screen with the month's spending, income and net total, a daily spending chart, spending by category, budgets and your top merchants
- It understands ENBD and Liv purchase, credit, debit, ATM, refund and card-payment SMS. It ignores OTPs, promotions and declined payments.
- Foreign-currency purchases are converted to AED. You can edit the exchange rates.
- Common UAE merchants are sorted into categories automatically (Carrefour, Talabat, Careem, ENOC, DEWA, noon and others). When you change a transaction's category, Dirham remembers that merchant for next time.
- PDF statement import: account statements and credit card statements, including password-protected ones. You review each line before it's added, and transactions already captured by SMS are flagged as duplicates.
- Back up and restore with a JSON file, and export to CSV
- Supports light and dark mode

## Keep a backup

Deleting the app from your Home Screen also deletes its data. Use **Settings**, then **Back up now**, then **Save to Files** (iCloud Drive) every week or two.

## Updating the app later

Upload the changed files to the same GitHub repository. Before you do, raise the version number in `sw.js` (`VERSION = 'dirham-v1.0.1'`). The iPhone picks up the new version the next time you open the app while online. Your data stays as it is.
