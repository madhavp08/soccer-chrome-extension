const SUPABASE_CONFIG = {
  url: "https://luwpwlvbflaspmdqwahs.supabase.co",
  anonKey: "sb_publishable_nEpgvWy_9gSIZBtrKL3ISw_oUBCW9S_",
  table: "votes"
};

const LIVESCORE_CONFIG = {
  key: "YOUR-LIVESCORE-KEY",
  secret: "YOUR-LIVESCORE-SECRET",
  base: "https://livescore-api.com/api-client",
  competitionId: 362,
  commentaryPath: "commentary.json",
  pollSeconds: 15,
  triggerEvents: ["FOUL_COMMITTED"]
};

const POLL = {
  options: ["Yes", "No"],
  decisionSeconds: 10
};
