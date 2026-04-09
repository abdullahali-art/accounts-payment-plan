# Payment Plan Generator

Next.js (App Router) app to build student payment plans, download PDFs, update GoHighLevel opportunity fields, and email the contact with the PDF attached.

## Live site

- **Production:** [https://accounts-payment-plan.vercel.app](https://accounts-payment-plan.vercel.app)
- **Repository:** [github.com/abdullahali-art/accounts-payment-plan](https://github.com/abdullahali-art/accounts-payment-plan) (private)

Example: `https://accounts-payment-plan.vercel.app/?opp_id=YOUR_OPP_ID&contact_id=YOUR_CONTACT_ID`

## Requirements

- Node.js 18+
- GoHighLevel API key with scopes for opportunities, contacts, and conversations (message write)

## Local development

```bash
npm install
cp .env.example .env
# Edit .env with your GHL_API_KEY and location ID
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with query params, for example:

`/?opp_id=YOUR_OPPORTUNITY_ID&contact_id=YOUR_CONTACT_ID`

## Environment variables (Vercel)

In **Vercel → Project → Settings → Environment Variables**, set for **Production** (and Preview if you use branch previews):

| Name | Description |
|------|-------------|
| `GHL_API_KEY` | GHL Private Integration Token (mark as sensitive) |
| `GHL_LOCATION_ID` | Sub-account location ID |

Vercel **does not allow hyphens** in env names, so `GHL_sub-account_Location` cannot be added there. The app reads `GHL_LOCATION_ID` first; that is enough for production.

### After “Generate & Send” (Accounts pipeline)

The API moves the contact’s opportunity in the **Accounts** pipeline to the **next stage** after a successful email (e.g. *Send Payment Plan* → *Payment Plan Sent*). It uses stage order from GHL’s pipelines response.

Optional: set **`GHL_ACCOUNTS_TARGET_STAGE_ID`** to the UUID of *Payment Plan Sent* (or any target stage) if you want to always jump there, or if stage order is not returned by the API. Copy the stage id from GHL (pipeline settings / API).

Do **not** commit `.env`. Do **not** store `VERCEL_TOKEN` or `GITHUB_TOKEN` in `.env` long term—use the Vercel/GitHub UIs or OS credential helpers. If a token was ever pasted into chat or logs, **revoke and create a new one**.

## Deploy on Vercel

1. Push this repo to GitHub (see below).
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the GitHub repository.
3. Framework Preset: **Next.js** (default).
4. Add the environment variables above.
5. Deploy.

After deploy, use your Vercel URL with `opp_id` and `contact_id` in the query string.

### If deployments don’t update (or Vercel emails “not a member of the team”)

That message usually refers to **`vercel deploy` from the CLI** using a token/user that isn’t on the Vercel team **Abdullah’s projects**. Fixes:

1. **Prefer Git → Vercel:** Push to `main` and let Vercel build from the connected GitHub repo (no CLI needed). In the project: **Settings → Git** — confirm **abdullahali-art/accounts-payment-plan** and **Production Branch = main**.
2. **Match Git author to GitHub:** In this repo, `git config user.name` / `user.email` should match the GitHub account that owns the repo (see [GitHub noreply emails](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-email-preferences/setting-your-commit-email-address)).
3. **CLI only if you’re on the team:** Add your user to the Vercel team, or in Vercel **Account Settings → Authentication** connect the same GitHub account you use for the repo.
4. **Manual deploy:** Vercel dashboard → **Deployments** → **⋯** on latest → **Redeploy** (use latest from Git if prompted).

## Push to GitHub

From this folder:

```bash
git init
git add .
git commit -m "Initial commit: payment plan generator"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

If you use [GitHub CLI](https://cli.github.com/):

```bash
gh repo create YOUR_REPO_NAME --public --source=. --remote=origin --push
```

## License

Private / internal use unless you add a license.
