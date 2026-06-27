# VARdict

**Vote on controversial calls in real time.**

VARdict is a lightweight Manifest V3 Chrome extension for World Cup matches. While
it's on, it watches the live match and pops a small poll onto the page you're
viewing whenever the referee shows a card or a VAR review happens. You get a few
seconds to vote Yes or No on whether it was the right call, and your anonymous
answer is stored in Supabase.

Built with plain JavaScript, HTML, and CSS — no frameworks or build step.

## How it works

The toolbar icon opens a control panel with an on/off toggle, saved in
`chrome.storage.local`. When you turn it on, the content script on your visible tab
asks how you are following: **Viewer** or **Moments**. That choice sticks until you
turn VARdict off, same as the match selection.

**Viewer** is for people watching live. You only get vote overlays on cards and VAR,
plus the Yes/No percentage bar after you vote (at `opened_at + 21 seconds`, shared
with everyone).

**Moments** is for people not watching. You get short pop-ups when goals are scored.
Cards and VAR skip the alert — you only see the community Yes/No percentage bar at the
same shared time as viewers.

If more than one World Cup match is live, you pick a match after choosing your mode.
One live match is selected automatically. The extension only follows events for that
fixture.

While it is on, the content script syncs every few seconds with the service worker and
Supabase. When a card or VAR is detected, the first sync registers the question in
Supabase with a shared `opened_at` timestamp. Every client reads that same clock, so
the vote window and results bar stay aligned across users. Delayed streams still get
the poll when the API reports the event (they may have less time left to vote).

Voting (Viewer only): the overlay lasts up to 20 seconds; once you pick an option it
auto-submits after 5 seconds unless you change it (changing resets the 5s timer).
Keyboard shortcuts while the poll is open: A or J for Yes, D or L for No.

Results: Viewers see the bar after voting, at `opened_at + 21 seconds`. Moments users
see the same bar for cards and VAR at that time (no vote, no prior alert). If several
events happen together, overlays are shown one at a time. Vote counts are never shown —
only the percentage split.

## Architecture

- `popup.html` / `popup.js` / `popup.css` — the on/off control panel.
- `content.js` — polls on the visible tab and renders the in-page poll overlay.
- `background.js` — service worker: finds the live fixture, pulls events, de-duplicates,
  builds the question, and saves votes to Supabase.
- `supabase/functions/refwatch-events/` — Edge Function that proxies API-Football so
  the paid API key stays server-side, never in the shipped extension.
- `config.js` — client settings (gitignored; copy from `config.example.js`).

## Data sources

- **API-Football** (api-sports.io), `league = 1`, `season = 2026`, for live cards and
  VAR events. A paid plan is required — the free tier is historical only (2022–2024)
  and returns nothing for the current season. The API key lives only in the Edge
  Function secret.
- **Supabase** (PostgreSQL) stores votes. Row-level security exposes an insert-only
  policy, so the publishable key shipped in the extension can add votes but never read
  or change data.

We trigger on cards and VAR because individual fouls and live commentary aren't
available on affordable feeds, and cards/VAR are the genuinely controversial calls.

## Setup

### 1. Supabase table

```sql
create table if not exists votes (
  id bigint generated always as identity primary key,
  question text not null,
  choice text not null,
  created_at timestamptz not null default now()
);

alter table votes enable row level security;

drop policy if exists "anon can insert votes" on votes;
create policy "anon can insert votes"
  on votes for insert
  to anon
  with check (true);

-- Aggregates only, so the insert-only key can read a Yes/No breakdown
-- without exposing individual rows.
create or replace function vote_breakdown(q text)
returns table(total bigint, yes bigint, no bigint)
language sql
security definer
set search_path = public
as $$
  select
    count(*) as total,
    count(*) filter (where choice = 'Yes') as yes,
    count(*) filter (where choice = 'No') as no
  from votes
  where question = q;
$$;

grant execute on function vote_breakdown(text) to anon;

-- Shared poll clock: first detector registers a question; all clients read the same opened_at.
create table if not exists active_polls (
  id bigint generated always as identity primary key,
  fixture_id bigint not null,
  question text not null unique,
  opened_at timestamptz not null default now()
);

alter table active_polls enable row level security;

create or replace function open_poll(p_fixture_id bigint, p_question text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare t timestamptz;
begin
  insert into active_polls (fixture_id, question)
  values (p_fixture_id, p_question)
  on conflict (question) do nothing
  returning opened_at into t;
  if t is null then
    select opened_at into t from active_polls where question = p_question;
  end if;
  return t;
end;
$$;

create or replace function active_polls_for_fixture(p_fixture_id bigint)
returns table(question text, opened_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select question, opened_at
  from active_polls
  where fixture_id = p_fixture_id
    and opened_at > now() - interval '3 minutes';
$$;

grant execute on function open_poll(bigint, text) to anon;
grant execute on function active_polls_for_fixture(bigint) to anon;
```

### 2. Deploy the API-Football proxy

```bash
brew install supabase/tap/supabase
supabase login
supabase secrets set APIFOOTBALL_KEY=your-api-football-key --project-ref YOUR_REF
supabase functions deploy refwatch-events --no-verify-jwt --project-ref YOUR_REF
```

Optional: `supabase secrets set ALLOWED_APIKEY=your-supabase-publishable-key` to
restrict the function to callers that send your publishable key. The league and
season are set inside the function.

### 3. Client config

```bash
cp config.example.js config.js
```

Fill in your Supabase URL, publishable key, and function URL. `config.js` is
gitignored, so real values are never committed.

### 4. Load the extension

Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and
select this folder. Refresh the tab you'll watch on, then switch the toggle on
during a live match.

## Configuration

In `config.js`:

- `MODES.viewer.triggerTypes` — events that open a vote (`["Card", "Var"]`).
- `MODES.moments.triggerTypes` — API events tracked in Moments mode
  (`["Goal", "Card", "Var"]`).
- `MODES.moments.momentTypes` — events that show a goal-style alert (`["Goal"]`).
- `MODES.moments.pollTypes` — events that only schedule a results bar (`["Card", "Var"]`).
- `POLL.syncSeconds` — how often clients sync with Supabase (default 3).
- `POLL.decisionSeconds` — vote window length from `opened_at` (20, Viewer only).
- `POLL.resultsDelaySeconds` — when the results bar appears after `opened_at` (21).
- `POLL.confirmSeconds` — auto-submit delay after a pick (5, Viewer only).
- `POLL.momentShowSeconds` — how long a Moments alert stays on screen (5).
- `POLL.resultsThreshold` — minimum votes before showing a bar (0 shows even yours alone).

## Viewing votes

In Supabase, open Table Editor → `votes`, or run this in the SQL editor to see each
question and its vote breakdown:

```sql
select question,
       count(*) as votes,
       count(*) filter (where choice = 'Yes') as yes,
       count(*) filter (where choice = 'No') as no
from votes
group by question
order by votes desc;
```

(Reading from the terminal would need a service-role key, since the shipped key is
insert-only; the Supabase SQL editor is the easy path.)

## Packaging for the Chrome Web Store

The runtime package is built with only the files the extension needs:

```bash
zip -r dist/vardict-1.0.0.zip manifest.json popup.html popup.css popup.js \
  content.js background.js config.js icons
```

This excludes `.git`, `supabase/`, `store/`, and config extras. Store assets
(privacy policy and listing copy) are in `store/`.

## Limitations

- Polls only on the visible tab, and the overlay appears on whatever normal page is
  in focus (not `chrome://` or new-tab pages).
- Events surface within the poll interval plus the feed's own ~15s delay, so a popup
  can lag the live action (and is usually ahead of a delayed stream).
- If a card happens while you're away, you get one catch-up popup for the latest one
  on return; earlier ones in that gap are skipped.
