# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the application entrypoint and all runtime code. Key areas are `src/commands/` for Telegram command handlers, `src/tools/` for agent tools such as browser automation, `src/memory/` for persistence and tagging, `src/scheduler/` for recurring jobs, and `src/logging/` for audit and cost tracking. Tests live beside implementation files as `src/**/*.test.ts`. Runtime data is stored under `data/`; deployment assets live in `deploy/`; production output is bundled to `dist/`.

## Build, Test, and Development Commands
Use Node `24.14.0` as declared in `package.json`.

- `npm run dev` runs the bot directly from `src/index.ts` with `tsx`.
- `npm run build` bundles the app with `esbuild` to `dist/index.js`.
- `npm run start` runs the built bundle.
- `npm run test` runs the Vitest suite once.
- `npm run test:watch` runs tests in watch mode.
- `npm run typecheck` runs strict TypeScript checks without emitting files.
- `npm run lint` checks with `oxlint`; `npm run fmt` formats with `oxfmt`.
- `npm run check` runs lint, format check, typecheck, and tests together.

## Coding Style & Naming Conventions
This is a strict TypeScript ESM project with `rootDir` set to `src/`. Follow the existing style: double quotes, semicolons, and concise module-level functions. Use `camelCase` for variables/functions, `PascalCase` for types and classes, and kebab-style filenames when a file name has multiple words, for example `browser-runtime.ts`. Keep tests next to the code they cover. Run `npm run fmt` and `npm run lint:fix` before pushing.

## Testing Guidelines
Vitest is configured for the Node environment and only picks up `src/**/*.test.ts`. Add or update tests for every behavioral change, especially around command handlers, memory, scheduler logic, and tool integrations. No coverage threshold is enforced in config, so reviewers will expect targeted regression tests instead. Prefer descriptive test names that state behavior, for example `it("persists restart history on success")`. Add regression tests when appropriate.

## Commit & Pull Request Guidelines
Recent history uses conventional prefixes such as `feat:`, `feat(scope):`, `fix:`, `chore:`, `refactor:`, `style:`, and `test:`. Keep commits focused and imperative. Before opening a PR, run `npm run check`; Husky also runs `check:staged` on commit and full `check` on push. PRs should summarize user-visible changes, call out config or data migrations, link related issues, and include screenshots or logs when UI, Telegram flows, or browser automation behavior changes.
