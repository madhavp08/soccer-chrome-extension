const SUPABASE_CONFIG = {
  url: "https://luwpwlvbflaspmdqwahs.supabase.co",
  anonKey: "sb_publishable_nEpgvWy_9gSIZBtrKL3ISw_oUBCW9S_",
  table: "votes"
};

const APIFOOTBALL_CONFIG = {
  key: "09df76bc07ff1d316299fcaeafc3c884",
  base: "https://v3.football.api-sports.io",
  league: 1,
  season: 2026,
  pollSeconds: 120,
  triggerTypes: ["Card", "Var"],
  finishedStatuses: ["FT", "AET", "PEN"]
};

const POLL = {
  options: ["Yes", "No"],
  decisionSeconds: 10
};
