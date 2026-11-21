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

`.github-project.env` is the committed source of shared `ANT_TEAM_*` project configuration; it contains project metadata, not secrets. The current values are listed below so agents can use this guidance without reopening the environment file. If this section and `.github-project.env` ever disagree, the environment file is authoritative. Edit values there when repository routing or project metadata changes; re-running the initialization script preserves existing values and only fills missing keys.

```sh
export ANT_TEAM_GITHUB_OWNER='csim-sg'
export ANT_TEAM_GITHUB_OWNER_TYPE='user'
export ANT_TEAM_GITHUB_REPO='csim-sg/baby-tracking-web'
export ANT_TEAM_GITHUB_PROJECT_NUMBER='4'
export ANT_TEAM_GITHUB_PROJECT_ID='PVT_kwHOAB4wV84Bsm_Z'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_FIELD_ID='PVTSSF_lAHOAB4wV84Bsm_Zzhq0Y40'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_OPEN_ID='b30bed6e'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_BACKLOG_ID='c95492c4'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_NEED_ATTENTIONS_ID='abeb1bc3'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_READY_ID='1b3787af'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_IN_PROGRESS_ID='994af751'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_IN_REVIEW_ID='fc73eb98'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_READY_TO_MERGE_ID='f6fb9016'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_BLOCKED_ID='fe1cab88'
export ANT_TEAM_GITHUB_WORKFLOW_STATE_OPTION_DONE_ID='5563f588'
export ANT_TEAM_WORKTREE_ROOT='/Users/chrissim/Projects/worktree/baby-tracker'
export ANT_TEAM_DOCS_VAULT_PATH='/Users/chrissim/Projects/Docs'
export ANT_TEAM_DOCS_PROJECT_NAME='baby-tracking-web'
export ANT_TEAM_DOCS_REPOSITORY='Antpolis/documentation'
export ANT_TEAM_DOCS_PROJECT_PATH='/Users/chrissim/Projects/Docs/02-Architecture-Landscape/projects/baby-tracking-web'
```

`ANT_TEAM_GITHUB_WORKFLOW_STATE_FIELD_ID` identifies Project #4's canonical `Workflow State` field; the built-in `Status` field is separate and unchanged. The option-ID variables map to the states `Open`, `Backlog`, `Need attentions`, `Ready`, `In Progress`, `In Review`, `Ready to Merge`, `Blocked`, and `Done`, respectively. Use `/Users/chrissim/.agents/scripts/gh_project_helper.sh` for board operations; it loads `.github-project.env` itself and resolves these IDs. To expose all values in a direct shell session, run `source .github-project.env`.

## Change Guidance

Keep sheet configuration and print behavior aligned between the interactive preview and printed A4 landscape output. Do not add server persistence, paid account behavior, spreadsheet integrations, or mobile architecture without an approved requirement and recorded durable context.
