# Chat App Backend

Backend for a chat application: rooms with member roles, real-time messaging over WebSocket, email/password and Google authentication.

## Stack

- **Node.js 22**, **TypeScript**, **Express 5**
- **PostgreSQL** + **Prisma** (via `@prisma/adapter-pg`)
- **Redis** — shared store for rate limiting and Socket.IO horizontal scaling
- **Socket.IO** — real-time message delivery per room
- **JWT** — authentication, **bcrypt** — password and activation token hashing
- **Google OAuth** (`google-auth-library`) — sign-in and sign-up via Google
- **Nodemailer** — email confirmation letters
- **Zod** — input validation
- **Vitest** — unit tests
- **helmet**, **express-rate-limit**, restricted **CORS** — baseline security layer

## Features

- Email/password registration and login, Google registration and login
- Email confirmation via a one-time token sent by mail (login is blocked until the email is confirmed)
- Resending the confirmation email
- Password reset via a one-time emailed token
- Short-lived JWT access tokens (15 min) + long-lived rotating refresh tokens: every `/users/refresh` call issues a new refresh token and invalidates the old one; replaying an already-used refresh token is detected as reuse and revokes the entire session family
- Session management: list active sessions (`GET /users/sessions`), revoke a single session, or log out everywhere (`/users/logout-all`) which also disconnects that user's open WebSocket connections
- Rooms with roles (`OWNER`, `ADMIN`, `MEMBER`): adding/removing members, changing roles, transferring ownership, leaving a room
- Messages: create, edit, delete, with real-time delivery only to the members of that specific room
- Profile updates and password changes, account deletion
- User search by name (cursor-paginated)

## Prerequisites

- Node.js 22.x
- PostgreSQL (locally or via Docker — see below)
- Redis (locally or via Docker — see below)
- An account for sending emails (e.g. Gmail with an app password)
- A Google OAuth Client ID (for Google sign-in)

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on (defaults to `3000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (e.g. `redis://localhost:6379` locally, `redis://redis:6379` under Docker Compose, or a `rediss://` URL with credentials for a managed/hosted Redis) |
| `JWT_SECRET` | Secret used to sign JWTs |
| `EMAIL` | Address that outgoing emails are sent from |
| `EMAIL_PASSWORD` | Password (for Gmail — an app password, not the regular one) |
| `SMTP_HOST` / `SMTP_PORT` | SMTP server settings |
| `CLIENT_HOST` | Frontend address — used to build links in activation emails |
| `GOOGLE_CLIENT_ID` | The app's Client ID in Google Cloud Console |
| `CORS_ORIGIN` | Comma-separated list of allowed CORS origins |
| `TRUST_PROXY` | Set to `true` only when deployed behind a trusted reverse proxy (nginx, ALB, Cloudflare, etc.) that correctly sets `X-Forwarded-For`. Leave `false`/unset for local dev or direct exposure — otherwise the per-IP connection/rate limits become spoofable |

## Running Locally (without Docker)

Make sure Postgres and Redis are both running and reachable at the URLs set in `.env` (e.g. `redis-server` locally, or `docker run -p 6379:6379 redis:8-alpine` if you just want Redis in a container), then:

```
npm ci
npx prisma migrate deploy
npm run dev
```

The server starts on `http://localhost:3000` (or another port set via `PORT`).

## Running via Docker

```
docker compose up -d --build
docker compose --profile tools run --rm migrate
```

The first command starts the app, the database, and Redis. The second runs migrations; it's deliberately kept out of the regular `docker compose up` so migrations don't run automatically on every container restart. The `.env` used by compose should point `DATABASE_URL` and `REDIS_URL` at the `db` and `redis` hosts, not `localhost`:

```
DATABASE_URL=postgresql://user:password@db:5432/node_chat
REDIS_URL=redis://redis:6379
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Runs in development mode with auto-restart |
| `npm run build` | Generates the Prisma client + compiles to `dist/` |
| `npm start` | Runs the compiled app (`dist/app.js`) |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` / `lint:fix` | Lints / auto-fixes with the linter |
| `npm run format` / `format:check` | Formats with Prettier |
| `npm run typecheck` | Type-checks without building |

## Project Structure

```
src/
  controllers/   — request handling, orchestration of services
  services/      — business logic, database access
  middlewares/   — auth, error handling, rate limiting
  routes/        — endpoint definitions
  lib/           — infrastructure (Prisma client, Redis client, Socket.IO, event emitter)
  utils/         — helper utilities (JWT, email, Google, validation)
prisma/
  schema.prisma  — data model
  migrations/    — database migration history
```

## API

Base prefixes: `/users`, `/rooms`, `/messages`. Registration, login, Google login, refresh, logout, activation, and password-reset endpoints are public (they authenticate via credentials/tokens in the request body, not a bearer header); every other endpoint — including all of `/rooms` and `/messages` — requires an `Authorization: Bearer <accessToken>` header, marked below as *(auth required)*.

### Users
- `POST /users/register` — register
- `POST /users/login` — log in (returns an `accessToken` and a `refreshToken`)
- `POST /users/google` — log in / register via Google
- `POST /users/refresh` — exchange a refresh token for a new access + refresh token pair (rotates the refresh token; reused/expired tokens are rejected)
- `POST /users/logout` — revoke a single refresh token
- `POST /users/logout-all` — revoke every session for the current user and disconnect their active sockets *(auth required)*
- `GET /users/activation/:activationToken` — confirm email
- `POST /users/activation` — resend the confirmation email
- `POST /users/password-reset` — request a password reset email
- `POST /users/password-reset/:resetToken` — confirm the new password
- `GET /users/me`, `PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me` *(auth required)*
- `GET /users/sessions` — list the current user's active sessions *(auth required)*
- `DELETE /users/sessions/:sessionId` — revoke a specific session *(auth required)*
- `GET /users/search?query=<name>&limit=<number>&cursor=<userId>` — search users by name *(auth required)*

### Rooms *(all endpoints require auth)*
- `GET /rooms?page=<number>&limit=<number>` — list of all rooms, i.e. a public directory (page pagination)
- `GET /rooms/mine?limit=<number>&cursor=<roomId>` — current user's rooms (cursor pagination)
- `POST /rooms`, `PATCH /rooms/:roomId`, `DELETE /rooms/:roomId`
- `GET /rooms/:roomId/members`, `POST /rooms/:roomId/members`
- `DELETE /rooms/:roomId/members/:userId`, `DELETE /rooms/:roomId/leave`
- `PATCH /rooms/:roomId/members/:userId/role`
- `PATCH /rooms/:roomId/members/:userId/transfer-ownership`

### Messages *(all endpoints require auth)*
- `GET /messages/room/:roomId?limit=<number>&cursor=<messageId>` — room messages (cursor pagination)
- `GET /messages/:messageId`
- `POST /messages`, `PUT /messages/:messageId`, `DELETE /messages/:messageId`

## WebSocket

Connect to Socket.IO passing the token: `io(url, { auth: { token } })`.

**Client → server:** `room:join(roomId)`, `room:leave(roomId)`

**Server → client:** `room:join:error`, `message:created`, `message:updated`, `message:deleted`

Messages are only broadcast to the members of a given room (membership is checked on `room:join`). Connections are rate-limited both by the number of active connections per IP and by the frequency of `room:join`/`room:leave` events.

## Testing

```
npm test
```

Unit tests cover the service layer with a mocked database client (no real database involved).

## License

GPL-3.0
