import { chat } from "./chat";
import { common } from "./common";
import { settings } from "./settings";
import { settingsIndexing } from "./settingsIndexing";
import { settingsProfiles } from "./settingsProfiles";

export const ar = { ...common, ...settings, ...settingsProfiles, ...settingsIndexing, ...chat };
