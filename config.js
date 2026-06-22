const SUPABASE_CONFIG = {
  url: "https://luwpwlvbflaspmdqwahs.supabase.co",
  anonKey: "sb_publishable_nEpgvWy_9gSIZBtrKL3ISw_oUBCW9S_",
  table: "votes"
};

const APIFOOTBALL_CONFIG = {
  functionUrl: "https://luwpwlvbflaspmdqwahs.supabase.co/functions/v1/refwatch-events",
  pollSeconds: 20,
  triggerTypes: ["Card", "Var"],
  finishedStatuses: ["FT", "AET", "PEN"]
};

const POLL = {
  options: ["Yes", "No"],
  decisionSeconds: 20,
  confirmSeconds: 5
};
