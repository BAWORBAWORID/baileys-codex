# AlwaysCodex Baileys - Project Guidelines

This file contains the core architecture, rules, and custom implementations for the AlwaysCodex Baileys WhatsApp Bot library. AI assistants reading this repository must adhere to the following guidelines.

## 1. Project Context
- **Name:** AlwaysCodex Baileys
- **Type:** WhatsApp Web API (WebSocket)
- **Primary Goal:** Advanced, anti-block interactive features and modern native-flow implementations.

## 2. Interactive Messages (Native Flow)
We have injected a custom auto-interceptor into `lib/Utils/messages.js` and `lib/Socket/messages-send.js`.
- **DO NOT** manually construct complex `additionalNodes` or `<biz>` tags for buttons.
- The library automatically intercepts standard `buttons`, `templateButtons`, and `sections` and wraps them securely into `Native Flow` (v9 mixed) to bypass WhatsApp client blocks.
- **Handling Responses:** When parsing button responses, use the standard `message.interactiveResponseMessage.nativeFlowResponseMessage`.

## 3. Custom Native Methods (God-Tier Functions)
The `sock` object has been extended with custom native methods. Use these directly instead of building raw stanzas:
- **`sock.sendPremiumSticker(jid, buffer, metadata, options)`**: Automatically manipulates WebP EXIF using `node-webpmux` and injects `isAvatar` and `limitSharingV2` metadata for anti-forwarding and AI badges.
- **`sock.sendStatusMention(jids, content)`**: Sends a ghost-mention broadcast status message.
- **`sock.sendAICard(jid, text, images, options)`**: Constructs a highly-structured `AIRichResponseMessage` (Meta AI UI).

## 4. Data Store Policy
- **WARNING:** The built-in `makeInMemoryStore` (Store module) causes massive memory leaks for large bots.
- **Rule:** Never recommend or use `makeInMemoryStore` for production data caching. All chats, messages, and contacts must be routed to a dedicated database (SQLite, MySQL, MongoDB, or JSON files). 
- *Note:* The `lib/Store` directory was manually re-added to support legacy compatibility, but its usage is strictly discouraged.

## 5. Coding Standards
- Use modern ES6+ features (`async/await`, destructuring).
- Do not add unnecessary external dependencies; stick to built-ins or existing optional dependencies (`sharp`, `fluent-ffmpeg`).
- When sending interactive messages, always test against standard WhatsApp clients to ensure no "Message not supported" errors occur.

## 6. UPDATE PROTOCOL (CRITICAL)
If you are instructed to "Update Baileys" or merge upstream code into this repository, you **MUST ABSOLUTELY PRESERVE** the custom button and interactive features. 
- **DO NOT OVERWRITE OR DELETE** the Native Flow auto-interceptors in `lib/Socket/messages-send.js`.
- **DO NOT REMOVE** the injected God-Tier functions (`sendPremiumSticker`, `sendStatusMention`, `sendAICard`).
- **DO NOT DELETE** the embedded helper classes (`Button`, `Carousel`, `AIRich`) in `lib/Utils/messages.js`.
The legacy code that supports the modern Native Flow buttons **must remain untouched** so that existing bot scripts using older button formats continue to work flawlessly.
