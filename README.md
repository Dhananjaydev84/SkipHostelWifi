# SkipHostelWifi

One-click WiFi authentication for Rajagiri hostels and campus networks.

SkipHostelWifi is a Chrome/Brave/Chromium extension that saves you from repeatedly opening the captive portal and logging in manually. Enter your User ID once, press **Connect**, and the extension submits the login request to the hostel/campus WiFi portal.

## Current Status

This extension is currently distributed as an **unpacked extension**.

A Chrome Web Store link will be added later.

## Setup

1. Download or clone this repository.
2. Open your Chromium-based browser.
3. Go to `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the project folder that contains `manifest.json`.
7. Pin the extension if you want quick access from the toolbar.

Keep this project folder on your device after loading it. If you delete or move the folder, the unpacked extension may stop working until you load it again.

## How To Use

1. Connect to the supported Rajagiri hostel/campus WiFi network.
2. Open the SkipHostelWifi extension.
3. Enter your **User ID**.
4. Press **Connect**.

The login should complete quickly. Your User ID is stored locally so reconnecting is faster the next time.

## Privacy

Your User ID is stored locally on your device.

This extension does not send your ID to any third-party server; it only submits it to the hostel/campus login portal.

For the full privacy policy, refer to [privacy-policy.html](privacy-policy.html).

## Features

- One-click WiFi authentication
- Local User ID storage
- Fast reconnect support
- Works with Rajagiri hostel and campus WiFi login portals

## Credits

Built by Dhananjay Dev and Arjun Satheesh
