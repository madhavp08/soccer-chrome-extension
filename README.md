# Ref Watch (MVP)

A minimal Chrome extension for World Cup matches. While turned on, it watches the
live match and pops up a poll on the page you are viewing each time the referee
calls a foul, gives you 10 seconds to pick **Yes** or **No** on whether it was the
right call, and stores only your final choice in a Supabase table.

## How it works

Clicking the toolbar icon opens a small control panel with an on/off toggle, whose
state is saved in `chrome.storage.local`. While it is on, the content script
(`content.js`) running on the tab you are viewing polls every 15 seconds, but only
while that tab is visible. Each poll asks the background service worker
(`background.js`) to check for new fouls. The worker finds the live World Cup match
from live-score-api, pulls the latest match commentary, keeps a cursor of the last
event it has already seen, and returns the most recent new `FOUL_COMMITTED` event.
When a new foul arrives, the overlay pops up with a contextual question built from
the event (the player, team, and minute) plus the commentary text, and your vote —
including that question text for context — is saved to Supabase by the worker.

The poll only appears on the tab that is active when a foul happens. The first poll
after you switch on (or after a new match starts) primes the cursor silently, so
you are not shown a backlog of earlier fouls.

## Data source

This uses [live-score-api.com](https://live-score-api.com), which is the affordable
self-serve provider whose commentary feed includes real per-foul events
(`FOUL_COMMITTED`) and live text commentary, and which covers the FIFA World Cup
(`competition_id = 362`). Commentary is a paid package; pick a plan that includes
World Cup commentary and use the free trial to start. The provider is isolated in
`config.js` and `background.js` so it can be swapped for an enterprise feed later.

## 1. Supabase table

In your Supabase SQL editor:

```sql
create table votes (
  id bigint generated always as identity primary key,
  question text not null,
  choice text not null,
  created_at timestamptz not null default now()
);

alter table votes enable row level security;

create policy "anon can insert votes"
  on votes for insert
  to anon
  with check (true);
```

The key shipped in the extension is insert-only by row level security.

## 2. Credentials in `config.js`

```js
const SUPABASE_CONFIG = { url: "...", anonKey: "...", table: "votes" };

const LIVESCORE_CONFIG = {
  key: "your-livescore-key",
  secret: "your-livescore-secret",
  base: "https://livescore-api.com/api-client",
  competitionId: 362,
  commentaryPath: "commentary.json",
  pollSeconds: 15,
  triggerEvents: ["FOUL_COMMITTED"]
};
```

Verify `commentaryPath` against your dashboard's Postman collection; if their
commentary URL differs (for example `matches/commentary.json`), set it here. The
key and secret are passed as query parameters, which is how live-score-api
authenticates.

## 3. Load the extension

1. Open `chrome://extensions`, enable Developer mode, click Load unpacked, select
   this folder.
2. Refresh the tab you want polls to appear on (content scripts only inject on
   pages loaded after the extension).
3. Click the icon and switch the toggle on during a live World Cup match.

## Viewing votes

In Supabase, open Table Editor → `votes`, or tally with:

```sql
select choice, count(*) from votes group by choice order by count(*) desc;
```

## Known MVP limits

- Polling runs only on the visible match tab, so close that tab and polling stops.
- live-score-api commentary updates in near real time; a foul may appear a few
  seconds after it happens.
- Fouls are frequent, so expect a pop-up roughly once or twice a minute during play;
  if one is already showing, new fouls during those seconds are skipped.
- The trigger list, competition, poll interval, and timer all live in `config.js`.
