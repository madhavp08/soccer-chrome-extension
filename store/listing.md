# Chrome Web Store listing — VARdict

> Add screenshots before final submission.

## Name

VARdict

## Summary (max 132 characters)

Vote on controversial calls in real time. While a poll is open: A or J for Valid, D or L for Invalid.

## Category

Sports

## Description

VARdict lets fans vote on controversial referee calls during live football/soccer
matches. Turn it on, and overlays appear on whatever page you are watching —
including fullscreen streams. Follow World Cup, Premier League, La Liga, Bundesliga,
Serie A, Ligue 1, Champions League, Euros, and Copa America.

The tab you enable on becomes your watching tab: vote Valid or Invalid on cards and
VAR. After the vote window closes, see how fans weighed in, then a percentage bar at
the same moment for everyone. Other tabs while VARdict is on get goal alerts and the
same community results without vote prompts. When a match reaches a penalty shootout,
predict each team’s five kicks, then see the crowd consensus.

Features:

- Synced vote windows and results timing across all users.
- Matte black overlays on the page you are already on, including fullscreen video.
- Keyboard shortcuts while a poll is open: A or J for Valid, D or L for Invalid.
- Anonymous — only your Valid/Invalid choice and the question text are stored.

VARdict does not read or collect the content of websites you visit. Overlays are drawn
on top of the page; nothing on the page is scraped or transmitted.

## Single purpose (required field)

VARdict displays Valid/Invalid polls and community result summaries for controversial
referee decisions (cards and VAR) during live football/soccer matches, and records
anonymous responses from fans watching those matches.

## Permission justifications

- **Host access — `<all_urls>`:** Required to draw poll and results overlays on whatever
  site the user watches a match on (streaming sites, sports pages, etc.). The extension
  injects only its own UI. It does not read, modify, or transmit page content.
- **`storage`:** Saves on/off state, the watching-tab binding, and the selected live
  match until the user turns VARdict off (or the match fully ends).
- **`activeTab`:** Used when the user opens the toolbar popup so preview and overlay
  messaging can target the active tab they are watching.
- **Remote requests to Supabase:** Fetches live match events, shared poll timing, and
  aggregate vote results. Records anonymous Valid/Invalid votes. No remote code is
  downloaded or executed.

## Data practices (Privacy tab)

- **Collected:** Anonymous Valid/Invalid poll responses and the question text describing
  the referee decision.
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
  capture a Valid/Invalid vote, vote counts, and results bar if possible).

## Pre-submission checklist

- [ ] `$5` Chrome Web Store developer account registered
- [ ] `config.js` in release zip with `DEV_MODE: false` and production Supabase values
- [ ] Privacy policy hosted at a public HTTPS URL
- [ ] Supabase `active_polls` SQL and Edge Function deployed (multi-league live list)
- [ ] Fresh extension zip (exclude `.git`, `config.example.js`, dev files)
