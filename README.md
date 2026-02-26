# OnSiteWebApp

Mobile-first web app that mirrors the iOS app layout and uses the same backend services.

## Features (initial scaffold)
- Top tabs: Feed / Home / Drawings / Documents
- Chat UI similar to iOS Home tab
- Calls FeedHandler `POST /chat_with_documents/`
- Shows returned response + related document cards + source links
- Session persistence in browser (`localStorage`)

## Setup
1. Copy env file:
   - `cp .env.example .env`
2. Install deps:
   - `npm install`
3. Run dev server:
   - `npm run dev`

## Env vars
- `VITE_FEEDHANDLER_BASE_URL` (use `/api` in local dev)
- `VITE_PROXY_TARGET` (FeedHandler URL used by Vite proxy)
- `VITE_DEFAULT_JOBSITE_ID` (default `twujobsite`)
- `VITE_DEFAULT_USER_EMAIL` (optional)

## Next steps for parity
- Add auth/session with Firebase
- Implement Feed tab endpoints
- Implement Drawings/Documents list + filters
- Preserve exact iOS visual tokens and spacing
- Add PWA manifest/offline caching
