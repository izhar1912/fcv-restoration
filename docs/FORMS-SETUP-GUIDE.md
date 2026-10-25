# FCV forms → Google Sheet + emails: setup (about 10 minutes)

## A. Create the sheet and backend (do this while signed in as **fcvsupport@gmail.com**)
Emails are sent from whichever Google account deploys the script, so this must be fcvsupport@gmail.com.

1. Go to sheets.google.com → create a blank spreadsheet. Name it **FCV Website Leads**.
2. Menu **Extensions → Apps Script**. Delete the sample code, paste in the whole of `Code.gs`, click **Save**.
3. In the function dropdown pick **setup** → **Run**. Approve the permissions
   (Advanced → "Go to project (unsafe)" → Allow). Two tabs appear: **Quote Requests** and **Contact Messages**.
4. **Deploy → New deployment → ⚙ Select type: Web app**
   - Execute as: **Me (fcvsupport@gmail.com)**
   - Who has access: **Anyone**
   - Click **Deploy** and copy the **Web app URL** (ends in `/exec`).
5. *(Recommended test)* Run **testQuoteSubmission**, then **testContactSubmission**. Each adds a row and sends both emails
   (the "customer" is fcvsupport@gmail.com itself, so you can see both emails in that inbox).

## B. Connect the website
1. Open `forms.js` and replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE` with the URL from step A4.
2. Copy everything in this zip over your project folder (the `Images` folder is unchanged and not included).
3. **Delete the old `pricing-2.html`**, because it is now `pricing.html`.
4. Upload/publish. Submit both forms once on the live site to confirm.

> If you ever edit `Code.gs` later: **Deploy → Manage deployments → ✏ → Version: New version → Deploy**.
> The URL stays the same.

## What happens on every submission
| Step | Detail |
|---|---|
| Sheet | New row in **Quote Requests** (pricing form) or **Contact Messages** (contact form). Last two columns are **Quote Status** (dropdown, starts as *New*) and **Actual Price** (fill in after the site visit). |
| Visitor | Redirected to `thank-you.html`. |
| Customer email | Branded confirmation from fcvsupport@gmail.com with their details, the rough estimate, and the note that pricing can change after the site visit. Replies go to quote@fcvrestoration.com. |
| Company email | A different, internal alert sent to fcvsupport@gmail.com **and** quote@fcvrestoration.com with call / email / open-in-sheet buttons. Replying goes straight to the customer. |

## Good to know
- Gmail limits scripts to about **100 recipients per day** on a free @gmail.com account. Each submission uses 3 (1 customer + 2 company), so roughly 30 submissions a day. Google Workspace allows 1,500.
- Settings (phone, address, recipients, status list, website link) are in the `CONFIG` block at the top of `Code.gs`.
- If an email ever fails, the row is still saved. Check **Apps Script → Executions** for the error.

---

# Admin dashboard (admin.html): setup, about 10 minutes

A private, password-protected page that lists every quote and contact message from the sheet.
Click one to see what the customer wants and the estimate they were shown, call or email them in one tap,
and edit the status, actual price and notes. Saving writes straight back to the Google Sheet.

## 1. Update the backend (Apps Script, signed in as fcvsupport@gmail.com)
1. Open your sheet → **Extensions → Apps Script**. Select all the old code, delete it, paste the new `Code.gs`, **Save**.
   *(If you changed anything in the `CONFIG` block at the top, such as WEBSITE_URL, re-apply it.)*
2. Run **setup** once. It adds an **Internal Notes** column at the end of both tabs. Nothing existing is moved or changed.
3. Set the dashboard password:
   - Find `setAdminPassword` near the bottom of the file and replace `CHANGE-THIS-TO-YOUR-PASSWORD` with your password
     (at least 10 characters; a few random words works well).
   - Choose **setAdminPassword** in the function dropdown → **Run**.
   - Put the placeholder text back and Save, so the password isn't left sitting in the code.
4. **Deploy → Manage deployments → ✏ (edit) → Version: New version → Deploy.**
   The Web App URL stays exactly the same. **This step is required**: without it the old code keeps running.

## 2. Put the page on your site
1. Open `admin.html`, find `var ENDPOINT = '...'` near the top of the script and paste the same Web App URL you used in `forms.js`.
2. Upload `admin.html` next to your other pages. It uses the same `Images` folder for the logo.
3. Open `yoursite.com/admin.html` and sign in.

## How it is protected
- The password is checked **on Google's server**, never in the web page. Without signing in, the page contains no customer data at all.
- 6 wrong passwords lock sign-in for 15 minutes. A sign-in lasts 12 hours (or until you press Sign out / close the tab).
- The page has `noindex` tags, so search engines are told not to list it. It isn't linked from the website's menu or footer.
  Don't add it to a sitemap or robots.txt. You can also rename the file to something less guessable (for example `team-9f3k.html`).
- To change the password later, repeat step 1.3. Everyone is signed out.

## Using it
- **Quote requests** and **Contact messages** tabs. The cards at the top (New / In progress / Won) filter the list when clicked.
- Search by name, phone, email, city or reference. Sort by newest, oldest or highest estimate.
- Open a request → **Call** (opens your phone dialer), **Email** (opens your mail app with a message already written, including the price once you've entered one), **Map**, **Edit**.
- **Edit** lets you change status, actual price, internal notes, and the customer's details. The estimate they were shown and the
  work they selected are locked on purpose, so you always have a record of what they saw.
- New requests appear on their own about every 2 minutes, or press **Refresh**.
- Optional: set `ADMIN_URL` in the `CONFIG` block of `Code.gs` to your page's address, and the team email will get an
  **Open in dashboard** button that jumps straight to that request.

## If something doesn't work
| You see | Fix |
|---|---|
| "Not connected yet" | Paste the Web App URL into `ENDPOINT` in `admin.html`. |
| "The server does not know the admin actions yet" | Do step 1.4 (Deploy → New version). |
| "The admin password has not been set yet" | Do step 1.3. |
| "Could not reach the server" | Check the URL ends in `/exec` and the deployment's access is **Anyone**. |
| "Incorrect password" | Re-run `setAdminPassword` with the password you want. |

---

# Customer tracking page (track.html): setup, about 10 minutes

Every quote confirmation email now includes a **View my request** button. It opens a private page that shows that
customer's selections, current status with a progress tracker, the date work can start, a note from your team, and their
actual quote once you've sent it. **You control all of it from the admin dashboard.** Customers can only look.

## 1. Update the backend (Apps Script, signed in as fcvsupport@gmail.com)
1. Open the script, select all, paste the new `Code.gs`, **Save**.
   *(Re-apply anything you changed in the `CONFIG` block at the top, for example `WEBSITE_URL`.)*
2. **Set `TRACK_URL` in the CONFIG block** to where `track.html` will live, for example
   `'https://www.fcvrestoration.com/track.html'`. If you leave it empty, emails simply won't include the button.
3. Run **setup**. It adds 3 columns at the end of **Quote Requests** (Work Start Date, Client Message, Tracking Token)
   and creates a private link for every request you already have. Nothing existing is moved or changed.
4. **Deploy → Manage deployments → ✏ → Version: New version → Deploy.** The URL stays the same. This step is required.

## 2. Upload the pages
1. Replace `admin.html` with the new one and paste your Web App URL into its `ENDPOINT` line again.
2. Upload `track.html` next to your other pages and paste the **same** Web App URL into its `ENDPOINT` line.
   (The same URL now lives in three files: `forms.js`, `admin.html` and `track.html`.)

## 3. Test it (2 minutes)
1. Submit a test quote on your website. The confirmation email has a **View my request** button; open it.
2. In the admin dashboard open that request → **Edit** → change the status, add a start date and a note → **Save**.
3. Press **Refresh** on the customer page and you'll see the changes.

## Who sets what
| What the customer sees | Where it comes from |
|---|---|
| Their selections, property details, online estimate | What they submitted (locked, can't be edited) |
| Status and progress tracker | **Quote status** in the dashboard |
| Work can start from | **Work can start from** (date picker) in the dashboard |
| Note from our team | **Note shown to the customer** in the dashboard (leave empty to hide) |
| Your quote | **Actual price** in the dashboard, **shown only once the status is Quote Sent, Accepted or Completed** |

The price rule means you can type a price in early without the customer seeing it. It appears the moment you set the status
to *Quote Sent*. To change which statuses reveal the price, edit `PRICE_VISIBLE_STATUSES` in `CONFIG`.
Internal notes are never shown to customers.

## Existing customers and sharing links
- Open any request in the dashboard: **What the customer sees** shows their link with **Copy link** and **Open their view**.
  The **Email** button's pre-written message now includes the link too, so you can send it to people who requested a quote before this update.
- The link is the key to the page, so anyone who has it can see that one request. It is a long random code that can't be
  guessed, and the email asks customers not to share it. It shows only that customer's request, never anyone else's,
  and never internal notes, phone numbers or emails.
- Only **quote requests** get a tracking page. Contact-form messages are unchanged.
