# FCV Client & Lender Portal: setup and launch guide

The public website is unchanged apart from a small "Client Portal" link in the footer. The portal lives at `/portal/` (clients and lenders, read-only) and `/admin/` (administrator). Everything runs on Netlify: Identity for sign-in, Functions for the server rules, Netlify Database for the data, and private Blobs for receipts and documents.

## How access works
- **Invite-only.** There is no public sign-up. The administrator invites each person from `/admin/` → People & invitations.
- **Admin vs member.** Authentication is Netlify Identity. Authorization is decided on the server from the database. A person is an administrator only if their row says so **and** their email is in `FCV_ADMIN_EMAILS`.
- **Members are read-only** and can only open projects the administrator assigned to them. A project they are not assigned to returns the same "not found" as one that doesn't exist.
- **Every change is audited.** The audit log is append-only at database level (updates and deletes are blocked).
- Files are private. A download link only works for someone signed in who is assigned to that project, and every download re-checks that.
- Figures are shown as **estimates and requests, not payments or approvals**. A supplement can't be marked Approved without recorded proof, and a draw can't show money disbursed until a status says so.

## Files
This folder is complete. Upload it as-is to your GitHub repository (see `README.md` at the root for the full folder map). Keep the lender workbook outside the folder.

## Steps (do these on a deploy preview first)
1. **Push to a branch** (not `main`) and let Netlify build a Deploy Preview. Production stays untouched until you merge.
2. **Netlify → Project configuration → Identity → Enable.** Under Registration choose **Invite only**. (The System check in the admin shows a red mark if sign-up is open.)
3. **Netlify Database.** Add a database to the project (Project configuration → Database). The SQL in `netlify/database/migrations/` creates every table on deploy.
4. **Environment variables** (Project configuration → Environment variables):
   - `FCV_ADMIN_EMAILS`: the administrator's email (comma-separated if more than one).
   - `FCV_SHEET_ENDPOINT`: your Apps Script Web App `/exec` URL.
   - `FCV_SHEET_SERVICE_KEY`: a long random key (32+ characters) you invent. Keep it secret.
5. **Google Apps Script** (the quote sheet):
   1. Paste the new `Code.gs` over the old one (keep your own `CONFIG` values: sheet, URLs).
   2. Put the **same** key from step 4 into `setServiceKey()`, run it once, then put the placeholder back.
   3. Run `refreshStatusOptions()` once (adds **Work in Progress** to the Quote Status dropdown).
   4. Deploy → Manage deployments → edit → **New version** → Deploy (the `/exec` URL stays the same).
6. **First sign-in as administrator.** In Netlify → Identity → *Invite users*, invite the administrator's email. Open the email, choose a password, then go to `/admin/`.
7. Open **People & invitations → Run check**. Every line should be green.
8. **Create projects.** Either *Import tracker workbook* (the lender workbook, with a preview and cross-checks) or *Quote requests → Create project*. Then invite the client/lender and give them access on the project page.
9. When the preview behaves, merge to production.

## Medinah Taiwo's figures
The imported workbook gives: total estimate **$37,582.89**, initial draw requested **$12,000.00**, remaining base budget **$25,582.89**. These are labelled as estimates and requests. No expenses or supplements are created. Anything not in the workbook stays empty.

## Day to day
- Stage changes in the admin update the **Quote Status** in the sheet automatically. The customer's emailed tracking link keeps working and now shows the Work in progress step.
- The six tabs (Lender Summary, Phase 1 Budget, Expense Log, Supplements & Change Orders, Draw Requests, Contract Overview) appear for members when the stage is *Work in progress* or *Completed*, or when you switch on "Show the project tracker to clients now".
- Tab names can be renamed in `portal/assets/tracker.js` (the `TABS` list).

## What was tested here, and what was not
Tested with automated checks (all passing): 54 server tests on a real Postgres engine (authorization, member isolation, validation, business rules, audit immutability, file upload safety, workbook import against the real workbook) and 20 browser checks in headless Chromium (sign-in, member view, admin editing, mobile layout, the production Content-Security-Policy).
**Not testable from here:** live Netlify Identity emails, the live Netlify Database and Blobs, and your live Google Sheet. Use the deploy preview and the System check for those. Sign-in in the tests used a stand-in for Identity.

## Housekeeping
- Change your Apps Script admin password if it was ever shared in a chat.
- The old standalone `admin.html` is replaced by `/admin/` and is not part of this package.
