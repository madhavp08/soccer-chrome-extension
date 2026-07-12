// Copy this file to config.js and fill in your own values.
// config.js is gitignored so real keys are never committed.

// Preview buttons (Vote / Goal / Results). Keep false for public releases.
const DEV_MODE = false;

const SUPABASE_CONFIG = {
  url: "https://YOUR-PROJECT.supabase.co",
  anonKey: "YOUR-SUPABASE-PUBLISHABLE-KEY",
  table: "votes"
};

const APIFOOTBALL_CONFIG = {
  functionUrl: "https://YOUR-PROJECT.supabase.co/functions/v1/refwatch-events",
  // Fully over only. FT with a knockout draw is ignored so ET/pens can continue.
  finishedStatuses: ["AET", "PEN"]
};

// vote = Card/VAR polls; alert = goal toasts on away tabs
const EVENT_TYPES = {
  vote: ["Card", "Var"],
  alert: ["Goal"]
};

// Deterministic padding so results look populated with few real users
const FAKE_VOTES = {
  min: 18,
  max: 36
};

const POLL = {
  options: ["Valid", "Invalid"],
  syncSeconds: 3,
  decisionSeconds: 20,
  confirmSeconds: 5,
  resultsDelaySeconds: 21,
  resultsThreshold: 1,
  momentShowSeconds: 5,
  countShowSeconds: 3,
  penaltyDecisionSeconds: 45,
  penaltyResultsSeconds: 8
};
