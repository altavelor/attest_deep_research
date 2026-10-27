import { chat } from "./chat";
import { common } from "./common";
import { onboarding } from "./onboarding";
import { settings } from "./settings";
import { settingsIndexing } from "./settingsIndexing";
import { settingsProfiles } from "./settingsProfiles";
import { subAgents } from "./subAgents";

export const fr = {
  ...common,
  ...settings,
  ...settingsProfiles,
  ...settingsIndexing,
  ...chat,
  ...subAgents,
  ...onboarding,
};
