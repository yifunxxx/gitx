# Maintaining & deploying docs

This page is for maintainers. Using the desktop app does not require Node.js, pnpm, or GitHub Pages configuration.

## Edit and preview locally

The site uses VitePress 1.6.4. Public content lives in `docs/site`; QA ledgers and internal work records are outside the published site.

At the repository root, use the Node version in `.nvmrc` and the pnpm version in `package.json`:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm docs:dev
```

Open the printed local address under `/gitx/`. Before submitting changes, run:

```sh
pnpm docs:reference
pnpm docs:build
node scripts/check-docs-output.mjs
pnpm docs:preview
```

`docs:reference` regenerates the feature index and default shortcuts from registered app actions. `docs:build` checks language pairing, the 72 registered commands, settings coverage, images, and local links before building. New unmapped actions fail validation and require a guide and coverage mapping.

## File layout

| Path | Purpose |
| --- | --- |
| `docs/site/index.md`, `guide/*.md` | Chinese home and guides |
| `docs/site/en/index.md`, `en/guide/*.md` | English counterparts with matching paths |
| `docs/site/public/screenshots` | Reviewed, publishable demo screenshots |
| `docs/site/.vitepress/config.mts` | Navigation, languages, search, and base path |
| `docs/site/.vitepress/theme` | Theme styles |
| `scripts/docs-reference.mjs` | Command coverage and reference generation |
| `.github/workflows/docs.yml` | Validation, build, and publication |

Add both language versions and update the sidebar for a new chapter. Provide captions and alt text for images. Keep private projects, tokens, credentials, and unrelated desktop windows out of public screenshots. Capture the real app with example data; retain necessary context when cropping.

## Enable GitHub Pages

1. Open repository **Settings → Pages**.
2. Set **Build and deployment → Source** to **GitHub Actions**.
3. Allow Actions and ensure the `github-pages` environment permits the deployment branch.
4. Push a documentation change to trigger **Documentation**, then inspect both build and deploy jobs.
5. After deployment succeeds, visit `https://yifunxxx.github.io/gitx/`; English starts at `/gitx/en/`.

This repository site uses `/gitx/` as its base. If a fork has another name, update `DOCS_BASE`, the configured site hostname, and favicon path. A custom domain or `username.github.io` root site may use `/`. Update asset paths consistently.

## Branches and ongoing publication

Pushes to **master, main, and codex/docs-site** can publish. `codex/docs-site` supports the initial delivery; after merging into the main branch, remove it from both workflow branch conditions. These branches target the same website, so the last completed deployment wins. Choose a single branch for routine maintenance.

Pull requests validate and build without deploying. The manual **Run workflow** entry requires the workflow on the default branch; until then, use a push to a supported branch. Edit links use the branch that built the site.

Publication uses GitHub Pages and short-lived workflow credentials, without storing a personal access token. Commit source and screenshots; upload generated `.vitepress/dist` as the build artifact.

## Deployment troubleshooting

- **Broken links or images:** fix references or add missing files; keep broken-link checks enabled.
- **Unmapped new command:** add coverage and both guides, then regenerate references.
- **Branch rejected by environment:** inspect Settings → Environments → github-pages deployment branches.
- **Assets return 404:** check the base path, repository name, image paths, and uploaded output.
- **A deep link fails on refresh:** confirm deployment completed, the target `.html` exists, and the URL prefix is correct.
- **Old content remains:** inspect the latest successful run's commit and deployment time, then refresh.

References: [VitePress deployment](https://vitepress.dev/guide/deploy), [internationalization](https://vitepress.dev/guide/i18n), and [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
