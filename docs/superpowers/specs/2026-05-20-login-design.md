# OAuth Login System Design

## Overview

Add minimal OAuth login (GitHub + Google) with a landing page for unauthenticated users. Three-tier access: landing page (public) → OAuth → lobby (authenticated).

## Architecture

```
Landing Page (public)
  ├─ Brand intro + highlights showcase
  ├─ GitHub login button → /api/auth/login?provider=github
  └─ Google login button → /api/auth/login?provider=google

OAuth Flow (Next.js API Routes)
  /api/auth/login    GET  → 302 redirect to provider
  /api/auth/callback GET  → exchange code, upsert user, set JWT cookie, 302 to /
  /api/auth/logout   POST → clear cookie
  /api/auth/me       GET  → return current user from JWT

Lobby (authenticated)
  └─ Existing pages: Lobby, AgentSetup, TableWaitingRoom, TableView, History
```

## OAuth Flow Detail

1. User clicks "GitHub Login" or "Google Login" on landing page
2. Browser redirects to `/api/auth/login?provider=github` (or `google`)
3. API route builds provider OAuth URL with `client_id`, `redirect_uri`, `state` (CSRF), 302 redirects
4. User authorizes on provider's site
5. Provider redirects to `/api/auth/callback?provider=github&code=xxx&state=yyy`
6. Callback route:
   - Validates `state` against cookie-stored value (CSRF protection)
   - POSTs `code` to provider token endpoint
   - GETs user info from provider API (id, name/username, avatar)
   - Creates or finds user: `userId = "github:12345"` or `"google:12345"`
   - Signs JWT with `userId` + `provider` + `name` + `avatar` in payload
   - Sets JWT as HttpOnly cookie (`cybercasino-token`, SameSite=Lax, Path=/)
   - 302 redirects to `/`
7. Frontend reads auth state from `/api/auth/me` on mount, shows lobby or landing page

## Data Model

### UserIdentity (extend existing)

```typescript
// Current (in shared types)
interface UserIdentity {
  userId: string;
  createdAt: number;
}

// After OAuth — add fields
interface UserIdentity {
  userId: string;       // "github:12345" or "google:12345"
  name: string;         // provider display name
  avatar: string;       // provider avatar URL
  provider: "github" | "google";
  createdAt: number;
}
```

### User persistence

File-based: `apps/server/src/data/users.json` — read on startup, write on new user.

## Auth on Socket.IO

Current flow: client reads `localStorage(cybercasino-userId)` → emits `user:register(existingUserId)` → server returns `UserIdentity`.

New flow: client calls `GET /api/auth/me` on mount → if authenticated, receives JWT payload → stores `userId` in memory → emits `user:register(userId)` as before.

The server-side `user:register` handler stays mostly unchanged — it still creates/returns a `UserIdentity`. The trust boundary shifts: userId is now a verified claim from the JWT (extracted by the API route), not a localStorage string.

### Backward compatibility

The old anonymous user flow (`localStorage(cybercasino-userId)` → server generates `user-{timestamp}-{random}`) is **removed**. All users must log in via OAuth to access the lobby. Existing in-memory agent configs are lost on server restart anyway, so no migration is needed.

### JWT_SECRET sharing

Both Next.js API routes and the Bun WebSocket server need `JWT_SECRET`. Set the same value in both `.env` files (`apps/web/.env.local` and `apps/server/.env`).

## API Route Implementation

### `GET /api/auth/login`
- Read `provider` from query params (validate: "github" | "google")
- Generate random `state` string, store in short-lived cookie (5 min)
- Build provider OAuth URL with env vars (`GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`, redirect URI)
- 302 redirect

### `GET /api/auth/callback`
- Validate `state` parameter against cookie
- Exchange `code` for access token (POST to provider)
- Fetch user info from provider
- Upsert user in `users.json`
- Sign JWT (HS256, secret from `JWT_SECRET` env var, 30-day expiry)
- Set HttpOnly cookie
- 302 redirect to `/`

### `POST /api/auth/logout`
- Clear `cybercasino-token` cookie
- Return `{ ok: true }`

### `GET /api/auth/me`
- Read and verify JWT from cookie
- Return `{ userId, name, avatar, provider }` or `{ authenticated: false }`

## Environment Variables

```
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
JWT_SECRET=xxx
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## New Files

| File | Purpose |
|------|---------|
| `apps/web/src/app/api/auth/login/route.ts` | OAuth login redirect |
| `apps/web/src/app/api/auth/callback/route.ts` | OAuth callback handler |
| `apps/web/src/app/api/auth/logout/route.ts` | Logout (clear cookie) |
| `apps/web/src/app/api/auth/me/route.ts` | Current user endpoint |
| `apps/web/src/components/LandingPage.tsx` | Public landing page |
| `apps/server/src/auth.ts` | JWT sign/verify utilities |
| `apps/server/src/data/` | User JSON persistence directory |

## Modified Files

| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | Extend `UserIdentity` with `name`, `avatar`, `provider` |
| `apps/server/src/stores.ts` | `UserStore` supports OAuth users (load from JSON, persist) |
| `apps/web/src/app/page.tsx` | Route to LandingPage when unauthenticated |
| `apps/web/src/components/Lobby.tsx` | Add logout button, show user info |
| `apps/web/src/components/ClientLayout.tsx` | Move LanguageSwitcher, add auth state provider |
| `apps/web/src/locales/zh.json` | Add `landing` and `auth` namespaces |
| `apps/web/src/locales/en.json` | Add `landing` and `auth` namespaces |

## Landing Page Design

Concise single-page layout:

```
┌─────────────────────────────┐
│         ♠️ ♥️ ♣️ ♦️          │
│       CyberCasino           │
│  AI Agent Texas Hold'em     │
│                             │
│  Watch AIs bluff, raise,    │
│  and battle at the table.   │
│                             │
│   ┌─────────────────────┐   │
│   │  Sign in with GitHub │   │
│   └─────────────────────┘   │
│   ┌─────────────────────┐   │
│   │  Sign in with Google │   │
│   └─────────────────────┘   │
│                             │
│     [中] language toggle    │
└─────────────────────────────┘
```

No highlights preview in V1 — defer to follow-up optimization. Just brand, tagline, and two login buttons.

## Auth State Management

New context: `AuthContext` (similar pattern to `LanguageContext`).

```typescript
interface AuthState {
  loading: boolean;
  user: { userId: string; name: string; avatar: string; provider: string } | null;
  login: (provider: "github" | "google") => void;
  logout: () => void;
}
```

`AuthProvider` calls `/api/auth/me` on mount, exposes user state. `login()` redirects to `/api/auth/login?provider=X`. `logout()` POSTs to `/api/auth/logout` then clears state.

## Implementation Order

1. Create `apps/web/src/app/api/auth/login/route.ts`
2. Create `apps/web/src/app/api/auth/callback/route.ts`
3. Create `apps/web/src/app/api/auth/me/route.ts`
4. Create `apps/web/src/app/api/auth/logout/route.ts`
5. Create `apps/server/src/auth.ts` (JWT utilities)
6. Extend `UserIdentity` in shared types
7. Update `UserStore` to support OAuth user fields
8. Create `AuthContext` (`apps/web/src/contexts/AuthContext.tsx`)
9. Create `LandingPage` component
10. Update `page.tsx` to route unauthenticated users to LandingPage
11. Add translations (`landing`, `auth` namespaces)
12. Add logout button to Lobby

## Testing

- OAuth flow: manual E2E (requires real GitHub/Google OAuth apps — use dev credentials)
- JWT verification: unit test `auth.ts` sign/verify
- Auth state: verify landing page shown when no cookie, lobby shown when cookie present
- Logout: verify cookie cleared, redirected to landing page
- i18n: verify all landing page text in both zh/en