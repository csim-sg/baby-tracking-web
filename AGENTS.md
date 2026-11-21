# Agent Guidance

## Repository Identity

This repository is `csim-sg/baby-tracking-web`. It is a printable child daily-care tracker. The current product is a browser-based sheet configurator and print view. Paid accounts, digital tracking, spreadsheet export, saved profiles and history, caregiver access, and a mobile app are planned direction only; they are not implemented or specified here.

## Project Structure

- `src/routes/index.tsx` contains the sheet configuration, preview, and print action.
- `src/routes/__root.tsx`, `src/main.tsx`, `src/router.tsx`, and `src/ssr.tsx` are the TanStack Start and router entry points.
- `src/style.scss` contains application and print styles.
- `vite.config.ts` configures the Vite/TanStack Start build and Nitro Node server output.
- `Dockerfile` and `compose.yaml` define the container build and deployment.

## Architecture And Runtime

TanStack Start renders the application with SSR. Sheet configuration is held in browser-side React state; there is no application database, login, or server-side sheet processing. Printing uses the browser print dialog. The production build emits Nitro output, and the container starts `node .output/server/index.mjs` on port 3000.

## Commands

- `npm run dev` starts the development server.
- `npm run build` creates the production build.
- `npm run start` starts the built Nitro server.
- `npm run format` formats the source files.

The repository currently has no test script or test directory.

## Delivery Workflow

1. Start with the assigned GitHub issue and its `Durable Context` URLs.
2. Treat linked SPEC, ARCH, ADR, GOV, and runbook notes as durable authority. Do not infer a design for planned capabilities from this repository's current implementation.
3. Use GitHub for issue status, ownership, handoffs, blockers, review, and approval.
4. Use `/Users/chrissim/.agents/scripts/gh_project_helper.sh` for GitHub workflow operations. It loads this repository's `.github-project.env` itself.
5. The configured GitHub repository is `csim-sg/baby-tracking-web`, and the project board is #4. Board workflow operations use its canonical `Workflow State` field.
6. Durable project documentation lives at `/Users/chrissim/Projects/Docs/02-Architecture-Landscape/projects/baby-tracking-web`. Start with `PROJECT_OVERVIEW.md` and follow its linked architecture and project-structure notes.

## Project Configuration

`.github-project.env` is the committed source of shared `ANT_TEAM_*` project configuration; it contains project metadata, not secrets. Edit values there when repository routing or project metadata changes. Re-running the initialization script preserves existing values and only fills missing keys.

- GitHub owner: `csim-sg` (user account).
- GitHub repository: `csim-sg/baby-tracking-web`.
- GitHub Project: #4, `Baby Tracking`.
- Workflow field: `Workflow State`. The existing built-in `Status` field is separate and unchanged.
- Canonical workflow options: `Open`, `Backlog`, `Need attentions`, `Ready`, `In Progress`, `In Review`, `Ready to Merge`, `Blocked`, and `Done`. Their option IDs are pinned in `.github-project.env`; use the GitHub helper rather than copying IDs into commands or code.
- Worktree root: `/Users/chrissim/Projects/worktree/baby-tracker`.
- Documentation vault: `/Users/chrissim/Projects/Docs`.
- Documentation repository: `Antpolis/documentation`.
- Project documentation path: `/Users/chrissim/Projects/Docs/02-Architecture-Landscape/projects/baby-tracking-web`.

Run `source .github-project.env` to expose the `ANT_TEAM_*` environment values in your current shell. For GitHub operations, prefer the helper script, which loads this file itself.

## Change Guidance

Keep sheet configuration and print behavior aligned between the interactive preview and printed A4 landscape output. Do not add server persistence, paid account behavior, spreadsheet integrations, or mobile architecture without an approved requirement and recorded durable context.
