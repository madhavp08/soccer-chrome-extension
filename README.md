# Ref Watch (MVP)

A minimal Chrome extension that, while turned on, pops up a question about a
referee's call every minute, gives the user 10 seconds to pick **Yes** or **No**,
and stores only the final choice in a Supabase table.

## How it works

Clicking the toolbar icon opens a small control panel with a single on/off toggle.
While the toggle is on, a background service worker runs a one-minute alarm, and on
each tick it opens a small plain white poll window with the question and two
buttons. The user can change their pick freely. After 10 seconds the window
auto-submits whatever option is currently selected to Supabase and then closes
itself. If nothing is selected, nothing is stored. There is no animated countdown;
the window just states that 10 seconds are available, which keeps the code simple.

A toolbar popup cannot reliably open itself on a timer in Chrome, so the poll is
shown as its own small window opened by the service worker. This works regardless
of which website is in front. The first poll appears one minute after you turn the
toggle on.

## 1. Create the Supabase table

In your Supabase project's SQL editor, run:

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

Row level security is enabled and only an `insert` policy is granted to the
anonymous role. The anon key is therefore safe to ship in the extension: anyone
holding it can add a vote but cannot read or modify existing rows.

## 2. Add your credentials

Open `config.js` and replace the placeholders with your project's URL and anon key
(Supabase dashboard → Project Settings → API):

```js
const SUPABASE_CONFIG = {
  url: "https://your-project.supabase.co",
  anonKey: "your-anon-key",
  table: "votes"
};
```

## 3. Load the extension locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Click the Ref Watch icon in the toolbar to open the popup.

When you are ready to share it, the same folder is what you upload to the Chrome
Web Store.

## Known MVP limits

- The poll is a separate small window, so it works no matter which site is in
  front, but it does steal focus for a moment when it appears.
- Chrome alarms fire at a minimum interval of one minute, which is exactly what we
  use here.
- The question, the option labels, and the 10-second timer all live in `config.js`
  so they are easy to change.
