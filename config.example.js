// Copy this file to config.js and fill in your own values.
// config.js is gitignored so real keys are never committed.

const SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT.supabase.co",
  anonKey: "YOUR-SUPABASE-PUBLISHABLE-KEY",
  table: "votes"
};

const APIFOOTBALL_CONFIG = {
  functionUrl: "https://YOUR-PROJECT.supabase.co/functions/v1/refwatch-events",
  finishedStatuses: ["FT", "AET", "PEN"]
};

const MODES = {
  viewer: {
    label: "Viewer",
    triggerTypes: ["Card", "Var"]
  },
  moments: {
    label: "Moments",
    triggerTypes: ["Goal", "Card", "Var"],
    momentTypes: ["Goal"],
    pollTypes: ["Card", "Var"]
  }
};

const POLL = {
  options: ["Yes", "No"],
  syncSeconds: 3,
  decisionSeconds: 20,
  confirmSeconds: 5,
  resultsDelaySeconds: 21,
  resultsThreshold: 1,
  momentShowSeconds: 5
};
