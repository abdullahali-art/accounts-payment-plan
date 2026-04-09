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

Do **not** commit `.env`. Do **not** store `VERCEL_TOKEN` or `GITHUB_TOKEN` in `.env` long term—use the Vercel/GitHub UIs or OS credential helpers. If a token was ever pasted into chat or logs, **revoke and create a new one**.

## Deploy on Vercel

1. Push this repo to GitHub (see below).
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the GitHub repository.
3. Framework Preset: **Next.js** (default).
4. Add the environment variables above.
5. Deploy.

After deploy, use your Vercel URL with `opp_id` and `contact_id` in the query string.

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
