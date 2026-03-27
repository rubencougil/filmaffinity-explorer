# Filmaffinity Browser

Small local website to search the films you have rated on Filmaffinity.

## Run it

Install dependencies and create your local config first:

```bash
npm install
cp config.example.json config.json
```

Then start the app:

```bash
npm start
```

Then open `http://127.0.0.1:3000`.

## Configure the account

Edit your local [`config.json`](/Users/cougil/hack/Filmaffinity%20Browser/config.json) (created from [`config.example.json`](/Users/cougil/hack/Filmaffinity%20Browser/config.example.json)) and set:

```json
{
  "filmaffinity": {
    "defaultUser": "Rubén Cougil",
    "users": [
      { "name": "Rubén Cougil", "userId": "297627" },
      { "name": "fiunchinho", "userId": "602754" }
    ]
  }
}
```

## Sync behavior

1. Start the server.
2. On startup, the server loads cached libraries from JSON files in `data/libraries`.
3. Open the app in your browser.
4. Choose a configured user by name from the dropdown.
5. The page loads the latest cached ratings for that user from the server without starting a new sync on reload.
6. Use `Sincronizar ahora` only when you want to refresh a specific user manually.
7. After a successful sync, the server writes one JSON file per user so the next server start reuses that data immediately.

The synced libraries are kept in server memory while the app is running and persisted to `data/libraries/*.json`.

## Search behavior

The search box works on the currently selected user's library. Each card can also show ratings from other configured users for the same title when those users have already been synced and cached locally.

## GitHub-safe files

The project includes a `.gitignore` so personal/local data is not uploaded:

- `data/libraries/*.json` (scraped user libraries)
- `config.json` (local user setup)
- `.playwright/` (persistent browser profile/cookies)
- `node_modules/`

## Challenge fallback

Sync starts in headless Chrome using a persistent Playwright profile.

If Filmaffinity shows a challenge, CAPTCHA, or temporary block, sync automatically retries in visible Chrome with the same profile so you can complete the verification manually. Once the ratings page becomes available, scraping continues automatically.
