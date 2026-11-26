import { chat } from "./chat";
import { common } from "./common";
import { onboarding } from "./onboarding";
import { settings } from "./settings";
import { settingsIndexing } from "./settingsIndexing";
import { settingsProfiles } from "./settingsProfiles";
import { subAgents } from "./subAgents";
import { deepResearch } from "./deepResearch";
import { researchAnswer } from "./researchAnswer";

export const es = {
  ...common,
  ...settings,
  ...settingsProfiles,
  ...settingsIndexing,
  ...chat,
  ...subAgents,
  ...deepResearch,
  ...researchAnswer,
  ...onboarding,
};
