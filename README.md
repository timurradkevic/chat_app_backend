# Chat App Backend

Backend for a chat application: rooms with member roles, real-time messaging over WebSocket, email/password and Google authentication.

## Stack

- **Node.js 22**, **TypeScript**, **Express 5**
- **PostgreSQL** + **Prisma** (via `@prisma/adapter-pg`)
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
- Rooms with roles (`OWNER`, `ADMIN`, `MEMBER`): adding/removing members, changing roles, transferring ownership, leaving a room
- Messages: create, edit, delete, with real-time delivery only to the members of that specific room
- Profile updates and password changes, account deletion

## Prerequisites

- Node.js 22.x
- PostgreSQL (locally or via Docker — see below)
- An account for sending emails (e.g. Gmail with an app password)
- A Google OAuth Client ID (for Google sign-in)

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on (defaults to `3000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret used to sign JWTs |
| `EMAIL` | Address that outgoing emails are sent from |
| `EMAIL_PASSWORD` | Password (for Gmail — an app password, not the regular one) |
| `SMTP_HOST` / `SMTP_PORT` | SMTP server settings |
| `CLIENT_HOST` | Frontend address — used to build links in activation emails |
| `GOOGLE_CLIENT_ID` | The app's Client ID in Google Cloud Console |
| `CORS_ORIGIN` | Comma-separated list of allowed CORS origins |

## Running Locally (without Docker)

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

The first command starts the app and the database. The second runs migrations; it's deliberately kept out of the regular `docker compose up` so migrations don't run automatically on every container restart. The `.env` used by compose should point `DATABASE_URL` at the `db` host, not `localhost`:

```
DATABASE_URL=postgresql://user:password@db:5432/node_chat
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
  lib/           — infrastructure (Prisma client, Socket.IO, event emitter)
  utils/         — helper utilities (JWT, email, Google, validation)
prisma/
  schema.prisma  — data model
  migrations/    — database migration history
```

## API

Base prefixes: `/users`, `/rooms`, `/messages`. Registration, login, Google login, and email confirmation endpoints are public; everything else requires an `Authorization: Bearer <token>` header.

### Users
- `POST /users/register` — register
- `POST /users/login` — log in
- `POST /users/google` — log in / register via Google
- `GET /users/activation/:activationToken` — confirm email
- `POST /users/activation` — resend the confirmation email
- `GET /users/me`, `PATCH /users/me`, `PATCH /users/me/password`, `DELETE /users/me`

### Rooms
- `GET /rooms?page=<number>&limit=<number>` — public list of all rooms (page pagination)
- `GET /rooms/mine?limit=<number>&cursor=<roomId>` — current user's rooms (cursor pagination)
- `POST /rooms`, `PATCH /rooms/:roomId`, `DELETE /rooms/:roomId`
- `GET /rooms/:roomId/members`, `POST /rooms/:roomId/members`
- `DELETE /rooms/:roomId/members/:userId`, `DELETE /rooms/:roomId/leave`
- `PATCH /rooms/:roomId/members/:userId/role`
- `PATCH /rooms/:roomId/members/:userId/transfer-ownership`

### Messages
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
