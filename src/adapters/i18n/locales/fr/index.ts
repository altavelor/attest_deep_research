import { chat } from "./chat";
import { common } from "./common";
import { onboarding } from "./onboarding";
import { settings } from "./settings";
import { settingsIndexing } from "./settingsIndexing";
import { settingsProfiles } from "./settingsProfiles";

export const fr = {
  ...common,
  ...settings,
  ...settingsProfiles,
  ...settingsIndexing,
  ...chat,
  ...onboarding,
};
