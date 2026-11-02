# nodebb-plugin-reactions
Reactions plugin for NodeBB

This plugin requires nodebb-plugin-emoji to be active.

# Installation
Install via one-click activation in the Admin Control Panel or run the following command:

    npm i git+https://github.com/ClickAndGoScript/nodebb-plugin-reactions

# Behavior

- Post authors can't react to their own posts (can be allowed in the ACP: "Allow users to react to their own posts"). Reacting to your own post never gives reaction reputation.
- Hover (desktop) on a reaction shows who reacted. Right-click (desktop) or long-press (touch devices) opens the full list of users.
- Several users reacting with the same emoji to the same post or chat message are merged into a single notification. Different emojis on the same post keep separate notifications.
- Reaction notifications show the emoji as an image (not the `:name:` text).
- When a user removes their reaction, the notification that was sent to the author for it is deleted. Controlled by the ACP switch "Delete the notification when the reaction is removed" (block "Notifications", applies to posts and chats; on by default).
- A reaction notification that the author has already read is never deleted.

# Emojis in Topic Titles and Notifications

In the admin settings of nodebb-plugin-emoji, turn on "Parse emojis in topic titles" to see emojis as images in topic titles and notifications.
![](https://private-user-images.githubusercontent.com/2583394/586759879-5b4e6cc9-3568-48fa-a556-83bdb24bd8f2.png?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3Nzc3NDAwNzAsIm5iZiI6MTc3NzczOTc3MCwicGF0aCI6Ii8yNTgzMzk0LzU4Njc1OTg3OS01YjRlNmNjOS0zNTY4LTQ4ZmEtYTU1Ni04M2JkYjI0YmQ4ZjIucG5nP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9QUtJQVZDT0RZTFNBNTNQUUs0WkElMkYyMDI2MDUwMiUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNjA1MDJUMTYzNjEwWiZYLUFtei1FeHBpcmVzPTMwMCZYLUFtei1TaWduYXR1cmU9NmJkY2ZhZDE0N2ZiMzRjODMyOGM2ODg1NTlkNWU1NDg5ZmEyNGI1MzlkYjg4ODZlNDFjZWUzNmU0Zjk0ZDUwMCZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QmcmVzcG9uc2UtY29udGVudC10eXBlPWltYWdlJTJGcG5nIn0.PoBRMpH7ByDbA-uXoyHAoHFr3eiiN4IYy-Wvqy3p2pM)

# Screenshots

## Reactions:
![demo](./assets/demo.png)

## ACP:
![acp](./assets/acp.png)
