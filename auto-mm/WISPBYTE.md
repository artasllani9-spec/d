# Host Auto MM on Wispbyte

Wispbyte runs **one Discord bot per server**. Create a dedicated Node.js server for Auto MM (do not stack it with ValueDex).

## 1. Create the server
1. Open [Wispbyte client](https://wispbyte.com/client)
2. Create Server → choose the **Node.js** image
3. Name it e.g. `Auto MM`

## 2. Upload files
Upload the contents of the `auto-mm/` folder (or the provided zip) into the server file root:

- `index.js`
- `package.json`
- `package-lock.json`
- `src/` (entire folder)

Do **not** upload `node_modules/`, `.env`, or `data/`.

## 3. Startup settings
| Setting | Value |
| --- | --- |
| Startup Command | `node index.js` |
| Node version | **22** (required for built-in SQLite) |

Leave “Additional Node Packages” empty — `package.json` / lockfile install everything.

## 4. Environment variables
Set these in **Startup → Environment Variables** (not in a committed `.env`):

| Name | Required | Notes |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | yes | Bot token from a Discord application dedicated to Auto MM |
| `DISCORD_CLIENT_ID` | yes | That application’s client / application id |
| `WALLET_MNEMONIC` | yes | 12 or 24 word escrow recovery phrase |
| `STAFF_ROLE_ID` | no | Staff role added to tickets |
| `ESCROW_CATEGORY_ID` | no | Optional parent category |
| `DEALS_CHANNEL_ID` | no | Completed-deal announcements |

Also accepted aliases: `DISCORD_TOKEN`, `CLIENT_ID`, or `AUTO_MM_*` prefixed names.

## 5. Discord Developer Portal
On the Auto MM application → Bot:
- Enable **Message Content Intent** if you want pasted addresses in chat (optional; buttons work without it)
- Invite with permissions: View Channel, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, Manage Roles

## 6. Start
Console → **Start**. You should see `Logged in as ...` and an invite URL. The SQLite file is created under `data/escrow.db` on the server disk.

## Notes
- Uses Node’s built-in `node:sqlite` (not `better-sqlite3`) because Wispbyte blocks native install scripts.
- Keep a secure offline backup of `WALLET_MNEMONIC`. Anyone with that phrase can move escrow funds.
