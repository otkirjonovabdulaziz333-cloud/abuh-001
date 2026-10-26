# SafeReply MTProto — Anti-Ban Telegram Userbot & 24/7 DM Auto-Reply

A privacy-first full-stack Next.js (App Router) + GramJS (`telegram`) application designed to protect your personal Telegram account from SpamBlock, FloodWait, and bans while providing 24/7 DM auto-replies, strict **Reply-Once** enforcement, and **Tanlangan Odamlar (VIP)** contact segmentation.

## 1. Anti-Ban & Safety Architecture

Every incoming Telegram message passes through a strict priority-ordered interceptor pipeline in [`src/lib/mtproto-engine.ts`](./src/lib/mtproto-engine.ts):

1. **Private Chat & Anti-Bot Filter:** Strictly ignores groups, supergroups, channels, forwarded messages, official Telegram service messages (`777000`), and bots.
2. **Blacklist & Per-User Pause Check:** Silently drops messages from contacts in the `Blacklist` segment or contacts with their individual pause switch enabled.
3. **Reply-Once Enforcement (`RepliedHistory`):** Checks if the sender has already received an auto-reply under the active cooldown policy (`NEVER`, `AFTER_24H`, `AFTER_7D`, `AFTER_1H`). Repeat messages are skipped with `0` replies.
4. **Strict Hourly Rate-Limit Shield:** Enforces a hard cap of **max 15 auto-replies per hour** across all chats to prevent MTProto flood limits.
5. **Humanized Delay & Typing Simulation:**
   - Waits a randomized reading delay of **4 to 9 seconds** (`randomDelay(4000, 9000)`).
   - Dispatches `Api.messages.SetTyping` (`sendChatAction(peer, 'typing')`) for **2 to 4 seconds** before sending the reply text.
6. **Safe 24/7 Online Presence:** Sends soft `Api.account.UpdateStatus({ offline: false })` touches at randomized human-like intervals (**every 4 to 7 minutes**) with an instant toggle to turn off 24/7 presence while keeping DM auto-reply active.
7. **Local AES-256-GCM Security:** Encrypts `api_hash` and `StringSession` tokens via [`src/lib/crypto.ts`](./src/lib/crypto.ts). Raw credentials are never returned to the frontend or API responses.

## 2. Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.
