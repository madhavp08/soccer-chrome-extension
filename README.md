# VARdict

**Vote on controversial calls in real time.**

VARdict is a lightweight Chrome extension for live football/soccer matches. Turn it on once, and it follows the game for you: when the referee shows a card or goes to VAR, a small poll appears on the page you already have open so you can weigh in. After a short shared window, everyone sees the same community split. If you wander off to another tab, you still get goal alerts and those community results without being asked to vote. When the match reaches a penalty shootout, you predict each team’s five kicks with a simple circle UI, then see what the crowd thinks.

The product is deliberately narrow. You do not manage modes, dashboards, or accounts. You flip **VARdict** on or off. Everything else — match selection, watching vs away behavior, synced timing, results, penalties, and shutting itself off when the *whole* game is over — is handled automatically.

Built with plain JavaScript, HTML, and CSS. Manifest V3. No frameworks, no bundler, no build step.

---

# Part 1 — Understanding the application

## Why it exists

Live football/soccer is full of moments where half the room disagrees with the referee. Cards and VAR reviews are the calls people argue about, and they are also the events affordable live feeds can report reliably. Individual fouls and commentary are not. VARdict turns those moments into a quick, anonymous fan pulse shared across people who have the extension on during the same fixture.

It is designed for match-day viewing sessions: someone has a stream open, someone else is half-watching while browsing, and both still want a sense of what “the room” thinks when controversy hits.

## The only control you need

Click the toolbar icon. You get a single large **VARdict** toggle. No slogan, no scoreboard, no mode picker in the popup.

- **On** — VARdict starts following a live match. The tab you were on when you turned it on becomes your *watching* tab.
- **Off** — Everything clears: selected match, watching-tab binding, queues, and pending alerts. Turn it on again later to start fresh.

When several matches are live at once, the popup also shows a **Games** tab so you can switch fixtures without digging through the page. When the match is fully finished, VARdict turns itself off so you are not left with a stale fixture stuck in storage.

## Watching tab vs away tab

You are never asked to pick a mode. That distinction is inferred from which tab you enabled on.

**Watching tab** (the tab active when you flipped VARdict on):

- Card and VAR events open a vote overlay (**Valid** / **Invalid**).
- After you vote (or the window ends), you get community results for that question at the shared time.
- You are assumed to be seeing the match, so routine goal toasts are not the focus here.

**Away tabs** (any other normal page while VARdict is still on):

- No vote prompts for cards or VAR.
- Short goal alerts when the API reports a goal.
- Community results for cards and VAR at the same shared clock as watching users.
- Same penalty-shootout prediction UI when the match reaches pens.

So if you enable VARdict on your stream tab, then open another site in a second tab, that other tab behaves like a lightweight moments feed: goals and crowd results, not foul polls interrupting you.

Only the visible tab runs the sync/overlay loop. Hidden tabs stay quiet until you come back.

## Match selection

VARdict follows live fixtures from these competitions (via the live API proxy):

World Cup, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, European Championship (Euros), and Copa America.

- **One live match** — selected automatically.
- **Several live matches** — an in-page picker asks which fixture to follow (labels include the competition name). You can also switch from the popup **Games** tab. That choice sticks until you turn VARdict off (or the match ends and VARdict shuts down).
- **No live matches** — nothing to show until something goes live.

## What appears on the page

All UI is drawn as matte black glass overlays on top of whatever normal webpage you are on (streaming sites, sports pages, etc.). Overlays are queued one at a time so they do not stack.

### Cards and VAR (watching tab)

When the feed reports a `Card` or `Var` event, the first client to notice registers a poll in Supabase with a shared `opened_at` timestamp. Every client uses that same clock.

- You get about **20 seconds** from `opened_at` to decide.
- Options are **Valid** and **Invalid**.
- After you pick, the choice auto-submits in **5 seconds** unless you change it (changing resets the timer).
- Keyboard while the poll is open: **A** or **Left arrow** = Valid, **D** or **Right arrow** = Invalid. **S** / **Down** (and **W** / **Up**) move focus within overlays; **Enter** / **Space** activates the focused control.
- If you never pick, the vote is skipped; watching users who skipped do not get a forced results bar for that question.

VAR questions are worded as `VAR · {detail} for {player}…` (duplicate “VAR” prefixes from the feed are stripped).

### In-game penalty kicks

When the feed reports a penalty awarded during open play (typically Var **Penalty confirmed** / **Penalty awarded**), both watching and away tabs get a direction picker instead of Valid/Invalid:

- Choices: **Top Left**, **Bottom Left**, **Middle**, **Bottom Right**, **Top Right**
- The overlay waits until you pick (or the decision window ends)
- Then community percentages for all five spots are shown; padded fake votes are distributed so the five percentages always add up to **100%**

Penalty *shootouts* (fixture status `P`) still use the separate 5+5 circle prediction UI.

### Community results

At `opened_at + 21 seconds` (configurable), eligible clients show results:

1. Brief raw counts (Valid / Invalid / total).
2. Then a percentage bar for a few seconds.

Away tabs see these results for cards and VAR without having voted. Watching tabs see them after voting (when applicable). Timing is shared so people looking at different streams still hit the bar together.

Totals include a small **deterministic fake-vote pad** so early crowds and quiet matches still look alive. Real votes still move the numbers; the pad is derived from the question text so every client sees the same inflated totals.

### Goals (away tabs)

Goals produce a compact toast (for example, `Goal for Player Team, 67'.`) for a few seconds. During a penalty shootout those goal spam events are suppressed in favor of the shootout UI.

### Penalty shootouts

When the fixture status becomes penalty-in-progress (`P`):

1. An overlay asks you to predict each team’s five kicks.
2. Each team has **five circles**. Untapped = miss (red). Tapped = goal (green). Example: if you think a team scores the 1st, 2nd, and 5th, you tap those three and leave the others red.
3. You lock in (or the decision window expires — default **45 seconds** from the shared shootout open time).
4. VARdict shows **community consensus** for each shot: a shot displays as a goal if at least half of the (real + padded) community marked it a goal — i.e. round half-up at 0.5.
5. After a short results view, the prompt does not repeat for that fixture.

Both watching and away tabs get this flow. It replaces the useless stream of individual penalty “goal” alerts. Per-shot votes are stored as `Goal` / `Miss` (developer-facing storage only; the UI is circles).

### Moving overlays

In-page cards (votes, goals, results, penalties) can be dragged. The position is remembered in `chrome.storage.local` so the next overlay opens where you left it. The toolbar popup itself is not draggable — it stays a simple on/off control (plus Games when needed).

### Fullscreen

Overlays try to stay visible when a site enters fullscreen by reparenting into the fullscreen element and injecting into frames when needed. This works for most container-based players (including typical YouTube-style fullscreen). It cannot draw on top of a browser’s native raw `<video>` element fullscreen — that is a platform limit, not something an extension can patch.

## When the match ends

VARdict only shuts itself off when the **whole** fixture is done, not merely when 90 minutes expire.

- Extra time continues as normal.
- Knockout games that are level at `FT` are **not** treated as finished (they may still go to ET / pens).
- Decisive full time, or terminal statuses after extra time / penalties (`AET`, `PEN`), turn VARdict off and clear match state.
- Group-stage draws that truly end at `FT` still shut down correctly.

## Privacy model (product view)

- Votes are anonymous: question text + Valid/Invalid (or per-shot Goal/Miss for penalties). No account, no profile, no identity field.
- The extension does not scrape or transmit the content of websites you visit. It draws its own UI on top of the page.
- Live scores and events come from a server-side API-Football proxy so the paid sports API key never ships inside the extension package.
- The publishable Supabase key in the client can insert votes and call aggregate RPCs; it is not meant to read or edit raw rows freely (RLS + security-definer functions).

## What VARdict does not do

- It does not stream video or replace your match broadcast.
- It does not call fouls that the feed never reports.
- It does not require choosing a watching/away mode manually.
- It does not keep running after a fully finished match.
- It does not show overlays on restricted Chrome pages (`chrome://`, Web Store, etc.).

## Mental model

```text
You turn VARdict ON on your stream tab
        │
        ▼
Service worker picks / remembers one live fixture
        │
        ├── Watching tab ──► Card/VAR votes ──► shared results
        │
        ├── Away tabs ─────► Goal toasts + shared results (no votes)
        │
        ├── Status P ──────► 5+5 circle penalty prediction ──► community pattern
        │
        └── Match fully over ──► VARdict turns OFF by itself
```

---

# Part 2 — Developer guide

This section is for setting up, configuring, and extending the extension.

## Architecture

| Piece | Role |
| --- | --- |
| `popup.html` / `popup.js` / `popup.css` | Toolbar UI: on/off toggle, Games tab when multiple fixtures are live, optional DEV previews. |
| `content.js` | In-page overlays, queues, drag position, fullscreen hosting, sync tick on the visible overlay host. |
| `background.js` | Service worker: live fixture discovery, event cursor, poll registration, votes, breakdowns, penalties, match-over shutdown, watching/away presence. |
| `config.js` | Local secrets and tunables (gitignored). Copy from `config.example.js`. |
| `manifest.json` | MV3: `storage`, `activeTab`, host access, content script on `<all_urls>` with `all_frames: true`. |
| `supabase/functions/refwatch-events/` | Edge Function proxy to API-Football (`LIVE_LEAGUES`). |
| `icons/` | Extension icons (referee raising a yellow card; 16 / 48 / 128). |
| `store/` | Chrome Web Store listing copy and privacy notes (not required at runtime). |

There is no build pipeline. Load the folder unpacked, or zip the runtime files for the store.

### Runtime data flow

1. Popup sets `enabled` (+ `viewerTabId` when turning on).
2. Content script on a usable page calls `chrome.runtime.sendMessage({ type: "sync" })` every `POLL.syncSeconds`.
3. Background resolves presence (`watching` vs `away`) from `sender.tab.id` vs `viewerTabId`.
4. Background loads live fixtures / selected fixture events via the Edge Function.
5. New `Card` / `Var` events call Supabase `open_poll` (shared `opened_at`). New `Goal` events are stored briefly as pending moments for away tabs.
6. Content renders the right overlay type from the sync payload and local queues.
7. Votes go to Supabase `votes`. Breakdowns use RPC `vote_breakdown`, then client-side fake padding.
8. When `isMatchFullyOver` is true, background clears state and sets `enabled: false`.

### Important storage keys (`chrome.storage.local`)

| Key | Purpose |
| --- | --- |
| `enabled` | Master switch. |
| `viewerTabId` | Tab that gets watching (vote) behavior. |
| `selectedGameId` / `selectedGameLabel` | Followed fixture. |
| `afEventsLen` | Event-array cursor so historical events are not replayed after attach. |
| `pendingGoalMoments` | Short-lived goal alerts for away tabs. |
| `penaltyDoneFixtureId` | Prevents repeating the shootout prompt for a fixture. |
| `overlayOffset` | Last dragged overlay `{ left, top }`. |

### Message types (content ↔ background)

| `type` | Direction | Purpose |
| --- | --- | --- |
| `sync` | content → background | Heartbeat; returns polls, goals, presence, optional penalty payload / game picker / matchOver. |
| `selectGame` | content → background | Persist chosen fixture when multiple are live. |
| `listLiveGames` | popup → background | Populate the popup Games tab. |
| `vote` | content → background | Insert Valid/Invalid for a card/VAR question. |
| `breakdown` | content → background | Aggregate counts (+ fake pad) for a question. |
| `penaltyVote` | content → background | Insert ten Goal/Miss rows (5 home + 5 away shots). |
| `penaltyBreakdown` | content → background | Consensus boolean array per team (half-up). |
| `preview` | popup → content | DEV_MODE only: fake vote / goal / results UI. |

## Prerequisites

- Google Chrome (or another Chromium browser that supports MV3 extensions).
- A [Supabase](https://supabase.com) project.
- An [API-Football](https://www.api-sports.io/) key on a plan that can read **live** fixtures for the competitions you follow. The free historical tier is not enough for live match data.
- Supabase CLI if you will deploy the Edge Function from this repo (`brew install supabase/tap/supabase`).

## Setup

### 1. Database (Supabase SQL editor)

Run the following once on your project. It creates the votes table, insert-only RLS, aggregate breakdown RPC, and the shared poll clock used to align clients.

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

-- Aggregates only, so the insert-only key can read Valid/Invalid (or Goal/Miss)
-- totals without exposing individual rows. Column names yes/no are legacy RPC shape.
create or replace function vote_breakdown(q text)
returns table(total bigint, yes bigint, no bigint)
language sql
security definer
set search_path = public
as $$
  select
    count(*) as total,
    count(*) filter (where choice in ('Valid', 'Goal')) as yes,
    count(*) filter (where choice in ('Invalid', 'Miss')) as no
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

If you already deployed an older `vote_breakdown` that only counted legacy choice strings, replace the function with the version above so Valid/Invalid and Goal/Miss aggregate correctly.

Also run `supabase/sql/vote_choice_counts.sql` once so in-game penalty direction results can aggregate Top Left / Middle / etc.

Penalty predictions reuse the same `votes` table: each shot is stored as its own question (`Penalty {fixtureId} · {team} · shot {n}`) with choice `Goal` or `Miss`. No extra tables are required. In-game penalty *direction* votes use one question (`Penalty kick · …`) with choice set to the corner label.

### 2. Deploy the API-Football proxy

From a machine with the Supabase CLI:

```bash
supabase login
supabase secrets set APIFOOTBALL_KEY=your-api-football-key --project-ref YOUR_REF
supabase functions deploy refwatch-events --no-verify-jwt --project-ref YOUR_REF
```

Optional hardening — only allow callers that send your publishable key:

```bash
supabase secrets set ALLOWED_APIKEY=your-supabase-publishable-key --project-ref YOUR_REF
```

Live competitions are hard-coded inside `supabase/functions/refwatch-events/index.ts` as hyphen-separated API-Football league IDs:

```text
LIVE_LEAGUES = "1-39-140-78-135-61-2-4-9"
```

| Competition | League ID |
| --- | --- |
| World Cup | 1 |
| Premier League | 39 |
| La Liga | 140 |
| Bundesliga | 78 |
| Serie A | 135 |
| Ligue 1 | 61 |
| Champions League | 2 |
| European Championship | 4 |
| Copa America | 9 |

Change `LIVE_LEAGUES` and redeploy if you retarget another set of competitions. The live query does not need a season parameter.

### 3. Client config

```bash
cp config.example.js config.js
```

Edit `config.js`:

- `SUPABASE_CONFIG.url` — project URL.
- `SUPABASE_CONFIG.anonKey` — publishable / anon key.
- `SUPABASE_CONFIG.table` — usually `votes`.
- `APIFOOTBALL_CONFIG.functionUrl` —  
  `https://YOUR-PROJECT.supabase.co/functions/v1/refwatch-events`.

`config.js` is gitignored so real keys are never committed. Ship a filled-in `config.js` only inside your private zip / unpacked load, never in public git.

### 4. Load the extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. **Load unpacked** → select this repository folder (the one that contains `manifest.json`).
4. Open a normal webpage (not `chrome://`).
5. Click the VARdict icon and turn it **on** during a live match (or use DEV previews — below).

After code changes, click **Reload** on the extension card, then refresh any tabs that already had the content script injected.

## Configuration reference (`config.js`)

### Feature flags and endpoints

| Key | Meaning |
| --- | --- |
| `DEV_MODE` | When `true`, the popup shows Vote / Goal / Results preview buttons that drive fake overlays on the active tab. Keep `false` for store builds. |
| `SUPABASE_CONFIG` | URL, anon key, votes table name. |
| `APIFOOTBALL_CONFIG.functionUrl` | Edge Function URL. |
| `APIFOOTBALL_CONFIG.finishedStatuses` | Terminal statuses that always end the session (`AET`, `PEN`). `FT` is handled in code with knockout-draw awareness. |

### Event routing

```js
const EVENT_TYPES = {
  vote: ["Card", "Var"],   // open Valid/Invalid polls
  alert: ["Goal"]          // away-tab goal toasts (suppressed during pens)
};
```

### Fake votes

```js
const FAKE_VOTES = { min: 18, max: 36 };
```

`getBreakdown` adds a deterministic pad (hash of the question → total and Valid/Goal share inside that range). Used for normal polls and each penalty shot question so community UI looks populated with few real users.

### Poll timing

| Key | Default | Meaning |
| --- | --- | --- |
| `POLL.options` | `["Valid","Invalid"]` | Vote labels shown on card/VAR overlays. |
| `POLL.syncSeconds` | `2` | Content sync interval. |
| `POLL.decisionSeconds` | `20` | Vote window from shared `opened_at`. |
| `POLL.confirmSeconds` | `5` | Auto-submit delay after a pick. |
| `POLL.resultsDelaySeconds` | `21` | When results appear relative to `opened_at`. |
| `POLL.resultsThreshold` | `1` | Minimum total (after padding) before showing a bar. Use `0` to always show. |
| `POLL.momentShowSeconds` | `5` | Goal toast duration. |
| `POLL.countShowSeconds` | `3` | How long raw counts show before the bar. |
| `POLL.penaltyDecisionSeconds` | `45` | Penalty prediction window from shootout `opened_at`. |
| `POLL.penaltyResultsSeconds` | `8` | How long community penalty circles stay visible. |

## Local development tips

### DEV_MODE overlays

Set `DEV_MODE = true` in `config.js`, reload the extension, open a normal tab, open the popup, and use **Preview overlays**:

- **Card** — sample yellow-card Valid/Invalid poll (not saved).
- **VAR** — sample VAR wording poll (not saved).
- **Goal** — sample goal toast.
- **Results** — sample counts + percentage bar.
- **Pen kick** — in-game penalty direction picker + fake 5-way community split (not saved).
- **Shootout** — 5+5 circle shootout UI + fake community dots (not saved).
- **Games** — sample multi-match picker.

If preview fails, refresh the page so the content script is present, and avoid `chrome://` URLs.

### Watching vs away while testing

Turn VARdict on while focused on tab A (`viewerTabId` = A). Open tab B with a normal URL: tab B should receive away-style behavior (goals/results, no card votes). Turning VARdict off clears the binding.

### Inspecting votes

In the Supabase SQL editor:

```sql
select question,
       count(*) as votes,
       count(*) filter (where choice in ('Valid', 'Goal')) as positive,
       count(*) filter (where choice in ('Invalid', 'Miss')) as negative
from votes
group by question
order by votes desc;
```

The shipped anon key is insert-oriented; use the SQL editor (service role in the dashboard) to read freely.

### Match-over logic (for debugging)

Implemented in `isMatchFullyOver` in `background.js`:

- `AET` / `PEN` (and any status listed in `finishedStatuses`) → finished.
- `FT` with unequal score → finished.
- `FT` with equal score on a knockout-style round name → **not** finished (wait for ET/pens).
- `FT` with equal score on group / other rounds → finished.
- Status `P` → penalties in progress; not finished; goal alerts suppressed; shootout UI offered once.

### Fullscreen debugging

Content scripts run in all frames. Only the appropriate overlay host mounts UI (top document normally; a framed document when *it* is the fullscreen context). If overlays vanish in fullscreen, check whether the site fullscreens a raw `<video>` (unsupported) versus a wrapper `div` (supported).

## Packaging for the Chrome Web Store

Zip only runtime files (include your real `config.js` for the package you upload, but do not commit it):

```bash
mkdir -p dist
zip -r dist/vardict-1.0.0.zip manifest.json popup.html popup.css popup.js \
  content.js background.js config.js icons
```

This excludes `.git`, `supabase/`, `store/`, Cursor rules, and local junk. Store listing copy and privacy text live under `store/` for the submission form — they are not loaded by the extension at runtime. Keep store summary and manifest description aligned with **Vote on controversial calls in real time.**

Bump `version` in `manifest.json` whenever you upload a new package.

## Security notes for contributors

- Never commit `config.js` or API-Football keys.
- Keep the sports API key only in Supabase function secrets.
- Prefer `ALLOWED_APIKEY` on the Edge Function in production.
- Do not loosen RLS to `select` on `votes` for `anon`; use `vote_breakdown` (or new security-definer RPCs) for aggregates.
- Content scripts intentionally avoid reading page DOM content for product features; keep it that way when adding UI.

## Limitations (engineering)

- Sync and overlays run on the visible overlay-host document only.
- Event latency is roughly sync interval + API-Football delay (~15s is common), so overlays can lag true live play and still lead delayed streams.
- First attach baselines `afEventsLen` to the current events length so you do not replay the whole match history as fresh polls.
- Native `<video>` element fullscreen cannot host HTML overlays.
- Fake votes are client-side padding on aggregates, not rows inserted into Supabase (except real user votes / penalty picks).

## Extending the product later

Good seams already in the code:

- `LIVE_LEAGUES` in the Edge Function — add or remove competitions without touching the client.
- `EVENT_TYPES` — add or remove API event types without rewriting sync.
- `POLL.*` — tune UX timing without logic changes.
- `FAKE_VOTES` — adjust crowd padding independently of real data.
- `isMatchFullyOver` — refine terminal-state rules per competition.
- Penalty helpers (`penaltyShotQuestion`, `getPenaltyBreakdown`) — change shot count or consensus rule in one place.
- Presence (`watching` / `away`) — add new away-only or watching-only surfaces without bringing back a manual mode picker.

Keep the user-facing contract intact when possible: **one toggle, automatic everything else.**
