# Ref Watch (MVP)

A minimal Chrome extension for World Cup matches. While turned on, it watches the
live match and pops up a poll on the page you are viewing each time the referee
shows a card or a VAR review happens, gives you 10 seconds to pick **Yes** or **No**
on whether it was the right call, and stores only your final choice in Supabase.

## How it works

Clicking the toolbar icon opens a small control panel with an on/off toggle, whose
state is saved in `chrome.storage.local`. While it is on, the content script
(`content.js`) running on the tab you are viewing polls every couple of minutes, but
only while that tab is visible. Each poll asks the background service worker
(`background.js`) to check for new events. The worker finds the live World Cup
fixture from API-Football, fetches that fixture's event timeline, remembers how many
events it had already seen, and returns the most recent new card or VAR event. When
one arrives, the overlay pops up with a question built from the event (the player,
team, and minute), and your vote — including that question for context — is saved to
Supabase by the worker.

The poll only appears on the tab active when the event happens. The first poll after
you switch on (or after a new fixture starts) primes the counter silently, so you
are not shown a backlog of earlier events.

## Data source

This uses [API-Football](https://www.api-football.com) (api-sports.io) for the FIFA
World Cup (`league = 1`, `season = 2026`), reading goals, cards, substitutions, and
VAR events updated every 15 seconds. We trigger on cards and VAR — the genuinely
controversial referee decisions — because individual fouls and live text commentary
are not available on free or affordable feeds. The provider is isolated in
`config.js` and `background.js`, so it can be swapped later for a richer feed.

A paid plan is required: API-Football's free plan is historical only (seasons
2022–2024) and cannot read the live current season, so it returns an empty result
for `season = 2026`. Any paid tier (cheapest is Pro) unlocks all seasons. With a
paid plan the daily request limit is generous, so we cache the live fixture id and
poll every 20 seconds (`pollSeconds`) for near-real-time pop-ups.

The paid API-Football key is **never shipped in the extension**. It lives only in a
Supabase Edge Function (`supabase/functions/refwatch-events`) that proxies the two
calls we need. The extension calls that function with the public Supabase key; the
function adds the secret key server-side. This keeps the paid key safe when the
extension is distributed publicly.

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

## 2. Deploy the API-Football proxy (Edge Function)

The function in `supabase/functions/refwatch-events/index.ts` holds your paid
API-Football key as a server-side secret. Using the Supabase CLI:

```bash
supabase login
supabase link --project-ref luwpwlvbflaspmdqwahs

# store the paid key as a secret (never in the extension)
supabase secrets set APIFOOTBALL_KEY=your-api-football-key

# optional: only allow callers that send your Supabase publishable key
supabase secrets set ALLOWED_APIKEY=your-supabase-publishable-key

# deploy; --no-verify-jwt because the extension authenticates with the
# publishable key (not a JWT)
supabase functions deploy refwatch-events --no-verify-jwt
```

The league (1) and season (2026) are set inside the function. To add goals to the
trigger, add `"Goal"` to `triggerTypes` in `config.js`; to poll less often, raise
`pollSeconds`.

## 2b. Client config (`config.js`)

```js
const SUPABASE_CONFIG = { url: "...", anonKey: "...", table: "votes" };

const APIFOOTBALL_CONFIG = {
  functionUrl: "https://<project-ref>.supabase.co/functions/v1/refwatch-events",
  pollSeconds: 20,
  triggerTypes: ["Card", "Var"],
  finishedStatuses: ["FT", "AET", "PEN"]
};
```

The extension sends the Supabase publishable key as the `apikey` header to the
function. No API-Football key is present in any shipped file.

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
