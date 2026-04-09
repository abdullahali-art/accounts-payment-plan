# Payment Plan Generator

Next.js (App Router) app to build student payment plans, download PDFs, update GoHighLevel opportunity fields, and email the contact with the PDF attached.

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

Add these in **Project → Settings → Environment Variables** (Production, Preview, and Development as needed):

| Name | Description |
|------|-------------|
| `GHL_API_KEY` | GHL Private Integration Token |
| `GHL_LOCATION_ID` | Sub-account location ID |
| `GHL_sub-account_Location` | Same as location ID if you prefer this variable name (optional fallback) |

Do **not** commit `.env`; use Vercel’s dashboard only.

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
