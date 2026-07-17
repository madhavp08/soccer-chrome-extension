# Paste-ready Chrome Web Store fields

Copy from here into the Developer Dashboard. Do not upload this file in the extension zip.

## Name

VARdict

## Summary

Vote on controversial calls in real time. A/Left=Valid, D/Right=Invalid. W/Up & S/Down move focus.

## Category

Sports

## Description

VARdict lets fans vote on controversial referee calls during live football/soccer matches. Turn it on, and overlays appear on whatever page you are watching — including fullscreen streams. Follow World Cup, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, Euros, and Copa America.

The tab you enable on becomes your watching tab: vote Valid or Invalid on cards and VAR. After the vote window closes, see how fans weighed in, then a percentage bar at the same moment for everyone. Other tabs while VARdict is on get goal alerts and the same community results without vote prompts. When a match reaches a penalty shootout, predict each team’s five kicks, then see the crowd consensus.

Features:

- Synced vote windows and results timing across all users.
- Matte black overlays on the page you are already on, including fullscreen video.
- Keyboard shortcuts while a poll is open: A or Left arrow for Valid, D or Right arrow for Invalid.
  W/Up and S/Down move focus inside overlays (including games and penalty UIs); Enter/Space selects.
- Anonymous — only your Valid/Invalid choice and the question text are stored.

VARdict does not read or collect the content of websites you visit. Overlays are drawn on top of the page; nothing on the page is scraped or transmitted.

## Single purpose

VARdict displays Valid/Invalid polls and community result summaries for controversial referee decisions (cards and VAR) during live football/soccer matches, and records anonymous responses from fans watching those matches.

## Permission justifications

Host access (`<all_urls>`): Required to draw poll and results overlays on whatever site the user watches a match on (streaming sites, sports pages, etc.). The extension injects only its own UI. It does not read, modify, or transmit page content.

storage: Saves on/off state, the watching-tab binding, and the selected live match until the user turns VARdict off (or the match fully ends).

activeTab: Used when the user opens the toolbar popup so preview and overlay messaging can target the active tab they are watching.

Remote code / remote requests: The extension contacts our Supabase backend to fetch live match events, shared poll timing, and aggregate vote results, and to record anonymous Valid/Invalid votes. No remote code is downloaded or executed.

## Privacy policy URL

After you host `docs/privacy.html` (see publish steps), paste that HTTPS URL here. Expected GitHub Pages URL if you enable Pages from `/docs`:

https://madhavp08.github.io/wc-chrome-extension/privacy.html
