# Prompt: Universal Links / App Links for invite redeem

Paste this as a task for an agent with backend/infra access (it needs to host files on a domain and likely touch signing/deploy config, which is out of scope for a frontend-only session).

---

## Context

This is a monorepo shopping-list app (Expo/React Native frontend in `frontend/`, Go backend in `backend/`). Owners of a synced list can generate invite links (`frontend/app/(home)/share_shopping_list.tsx` → `frontend/api/sharing/invite-link.ts`'s `buildInviteLink()`). Redeeming now works in the app (`frontend/app/(home)/redeem_invite.tsx`, added in this session), but **only via manually pasting the link or token** — there is a "Join a shared list" entry point on the home screen (`frontend/app/(home)/index.tsx`) that opens a paste field. The backend endpoint is already implemented: `POST /api/v1/invites/redeem`.

**The actual goal that's still open:** tapping a shared invite link (in a messaging app, email, or a mobile browser) should open the app directly, ideally straight to the redeem screen with the token pre-filled. Today it does nothing, verified by testing: `buildInviteLink()` produces a **custom-scheme** link (`de.lightdevsolutions.sholist://invite?token=...` in prod, `.dev` suffix in dev builds), and mobile browsers don't offer to open arbitrary custom-scheme URIs from a tapped link.

## Why this wasn't just wired up in the frontend session that found this

A custom URL scheme is **not domain-verified** — any other app installed on the device can register an intent-filter for the same scheme and win the OS's resolution, or at minimum trigger a chooser. That's an accepted risk for this app's *existing* use of the custom scheme (the OIDC login redirect, `frontend/api/auth/redirect-uri.ts`), but only because RFC 8252 (cited in `app.config.js`'s scheme comment) considers it safe specifically thanks to PKCE — an intercepted authorization code is useless without the code verifier that never left the device. **The invite token has no equivalent protection**: it's a bare bearer credential, and whoever redeems it joins the list. Auto-opening the app from a tapped custom-scheme link would mean trusting the OS to hand that token to the right app, which isn't guaranteed. So: no `+native-intent.ts` rewriting, no route auto-matched against the custom-scheme `invite` path was added — deliberately deferred to here, where it can be done with actual domain verification.

## What "verified" means and what to build

Real Universal Links (iOS) / App Links (Android) are what's needed — `https://` links backed by files the OS fetches directly from the domain to confirm this exact app is allowed to handle that domain's paths, which is exactly the guarantee a custom scheme can't give:

1. **Pick a domain.** Candidate: `api.shopping-list.ops.light-dev-solutions.de` (already the backend's domain, per `frontend/.env.production`), or a new subdomain if serving `.well-known` files from the API host is awkward. This is a real decision with infra implications — confirm it with the user rather than assuming.
2. **Host, over HTTPS, from that domain:**
   - `/.well-known/apple-app-site-association` — no file extension, served as `application/json` (some CDNs need an explicit override for this). Needs the Apple Developer Team ID and both bundle identifiers (`de.lightdevsolutions.sholist` prod, `de.lightdevsolutions.sholist.dev` dev).
   - `/.well-known/assetlinks.json` — needs the Android package names (same two ids) and the **SHA-256 signing certificate fingerprints** for every keystore that can produce an installed build: the release keystore, and whatever EAS/Expo uses for dev/internal builds. Get these via `keytool -list -v` or `eas credentials`.
3. **Frontend changes once the domain and files are live** (do these together with the hosting, not before — an unverified `associatedDomains`/`intentFilters` entry just breaks the fallback without adding anything):
   - `frontend/app.config.js`: add `ios.associatedDomains: ["applinks:<domain>"]` and an `android.intentFilters` entry for `https://<domain>/invite` with `autoVerify: true`.
   - `frontend/api/sharing/invite-link.ts`: change `buildInviteLink()` to emit `https://<domain>/${INVITE_PATH}?${INVITE_TOKEN_PARAM}=<token>` instead of the custom-scheme URL. Leave `INVITE_PATH`/`INVITE_TOKEN_PARAM` as-is — `extractInviteToken()` (same file) already parses either form for the manual-paste fallback, so it keeps working either way.
   - Add the actual route that receives the opened link. Expo Router matches a path to a file automatically (that's why `+native-intent.ts` only special-cases the OIDC path today, to *stop* auto-navigation, not enable it) — a root-level `app/invite.tsx` matching `/invite` is probably enough; have it read the `token` query param and either redirect into `redeem_invite.tsx`'s flow or reuse `useRedeemInvite` (`frontend/hooks/useRedeemInvite.ts`) directly. Keep the existing confirm-before-joining behavior (`redeem_invite.tsx`'s "Join list" button) rather than auto-redeeming on open — a link opened by mistake shouldn't silently add someone to a list.
4. **Verify for real**, not just in a simulator:
   - Android: install the built app, then `adb shell pm get-app-links de.lightdevsolutions.sholist` (or `.dev`) to confirm verification succeeded, then tap a real link in Chrome/a messaging app.
   - iOS: Universal Links need a physical device (the simulator doesn't do AASA verification reliably); tap a real link in Safari/Messages.

## Explicitly out of scope for you to re-derive

The redeem screen, its API client method, and the sync-after-join flow (enable `list_sync_settings`, then `SyncEngine.pullList`) already exist and are tested (`frontend/app/(home)/redeem_invite.tsx`, `frontend/hooks/useRedeemInvite.ts`, `frontend/api/sharing/sharing-client.ts`'s `redeemInvite`). You don't need to touch or re-review that logic — this task is purely about the transport (verified https links) and wiring the OS-level open into the app, not about how redeeming itself works.
