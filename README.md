# FCV Restoration & Construction: complete website + Client & Lender Portal

This folder is the whole project. Upload it as-is to a GitHub repository connected to Netlify (publish directory is the repository root, set in `netlify.toml`).

```
fcv-site/
├── index.html, about-us.html, services.html, pricing.html, contact.html,
│   thank-you.html, privacy-policy.html, terms-of-service.html,
│   cookie-policy.html, accessibility-statement.html   ← public website
├── track.html            ← customer's emailed tracking page (token link)
├── forms.js              ← form handler (paste your Apps Script /exec URL inside)
├── styles.css
├── Images/               ← all logos and photos (the portal uses the FCV logos here)
├── portal/               ← client & lender portal (read-only)  → /portal/
│   ├── index.html
│   └── assets/ (portal.css, common.js, tracker.js, member.js, identity.js)
├── admin/                ← administrator area                  → /admin/
│   ├── index.html
│   └── assets/admin.js
├── netlify/
│   ├── functions/api.mjs ← the server (all rules and permissions)
│   ├── lib/              ← server modules
│   └── database/migrations/20261022120000_portal_init.sql  ← creates the database tables
├── apps-script/Code.gs   ← paste into your Google Apps Script project (not served on the site)
├── docs/                 ← PORTAL-SETUP.md (start here), FORMS-SETUP-GUIDE.md
├── src/, scripts/        ← source for the sign-in bundle (portal/assets/identity.js is already built)
├── test/                 ← automated tests (run: npm install && npm test)
├── netlify.toml, package.json, package-lock.json, .gitignore
```

Start with `docs/PORTAL-SETUP.md`. Keep the lender workbook (.xlsx) OUTSIDE this folder: it is uploaded through the admin screen, and files in this folder are public unless blocked.

Two things the original site already had that are untouched: dead links on index.html to `/project-one`, `/service-detail/...` pages (they never existed in the original export).
