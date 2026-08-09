import type { LocaleCode, MessageParams, TextDirection } from "@core/i18n";
import type { TranslationPort } from "@application/ports";
import { en } from "./locales/en";

export type MessageKey = keyof typeof en;

export type ReferenceMessages = Readonly<Record<MessageKey, string>>;

export type LocaleMessages = Readonly<Partial<Record<MessageKey, string>>>;

export type Translate = (key: MessageKey, params?: MessageParams) => string;

/**
 * Translation port narrowed to the keys declared by the English reference
 * dictionary, so UI call sites get compile-time checking of message keys.
 */
export interface UiTranslator extends TranslationPort {
  readonly locale: LocaleCode;
  readonly direction: TextDirection;
  readonly t: Translate;
}
