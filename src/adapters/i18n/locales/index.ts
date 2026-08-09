import type { LocaleCode } from "@core/i18n";
import type { LocaleMessages, ReferenceMessages } from "../messages";
import { ar } from "./ar";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ru } from "./ru";
import { zhCN } from "./zh-CN";

export const REFERENCE_MESSAGES: ReferenceMessages = en;

export const LOCALE_MESSAGES: Readonly<Record<LocaleCode, LocaleMessages>> = {
  en,
  "zh-CN": zhCN,
  es,
  ar,
  de,
  fr,
  ru,
};
