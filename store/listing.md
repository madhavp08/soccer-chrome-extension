# Chrome Web Store listing — VARdict

> Add screenshots before final submission.

## Name

VARdict

## Summary (max 132 characters)

Vote on controversial calls in real time. While a poll is open: A or J for Yes, D or L for No.

## Category

Sports

## Description

VARdict lets fans vote on controversial referee calls during live World Cup matches. Turn
it on, pick **Viewer** or **Moments**, choose your match, and overlays appear on
whatever page you are watching — including fullscreen streams.

**Viewer** — for people watching live. Vote Yes or No on cards and VAR. After the vote
window closes, see how many fans weighed in, then a percentage bar at the same moment
for everyone.

**Moments** — for people not watching. Get goal alerts, then community results on cards
and VAR (no vote required).

Features:

- Synced vote windows and results timing across all users.
- Matte black overlays on the page you are already on, including fullscreen video.
- Keyboard shortcuts while a poll is open: A or J for Yes, D or L for No.
- Anonymous — only your Yes/No and the question text are stored.

VARdict does not read or collect the content of websites you visit. Overlays are drawn
on top of the page; nothing on the page is scraped or transmitted.

## Single purpose (required field)

VARdict displays Yes/No polls and community result summaries for controversial referee
decisions (cards and VAR) during live World Cup matches, and records anonymous Viewer
responses.

## Permission justifications

- **Host access — `<all_urls>`:** Required to draw poll and results overlays on whatever
  site the user watches a match on (streaming sites, sports pages, etc.). The extension
  injects only its own UI. It does not read, modify, or transmit page content.
- **`storage`:** Saves on/off state, Viewer or Moments mode, and the selected live
  match until the user turns VARdict off.
- **`activeTab`:** Used when the user opens the toolbar popup so preview and overlay
  messaging can target the active tab they are watching.
- **Remote requests to Supabase:** Fetches live match events, shared poll timing, and
  aggregate vote results. Records anonymous Yes/No votes. No remote code is downloaded
  or executed.

## Data practices (Privacy tab)

- **Collected:** Anonymous Yes/No poll responses (Viewer mode) and the question text
  describing the referee decision.
- **Not collected:** Name, email, account, location, browsing history, page content,
  or other personally identifiable information.
- **Certifications:** Data is not sold; not used for unrelated purposes; not used for
  creditworthiness or lending.

## Privacy policy URL

Host `store/PRIVACY.md` at a public URL (GitHub Pages, gist, etc.) and paste that URL
into the listing's privacy policy field.

## Assets still needed before submission

- Store icon 128×128 (manifest also uses 16×48) — new logo pending.
- At least one screenshot at 1280×800 or 640×400 (toolbar popup + in-page overlay;
  capture Viewer vote, vote counts, and results bar if possible).

## Pre-submission checklist

- [ ] `$5` Chrome Web Store developer account registered
- [ ] `config.js` in release zip with `DEV_MODE: false` and production Supabase values
- [ ] Privacy policy hosted at a public HTTPS URL
- [ ] Supabase `active_polls` SQL and Edge Function deployed
- [ ] Fresh extension zip (exclude `.git`, `config.example.js`, dev files)
