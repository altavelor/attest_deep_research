export * from "./component";
export * from "./controls";
export * from "./dom";
export * from "./menu";
export * from "./modal";
export * from "./notice";
export * from "./plugin";
export * from "./vault";
export * from "./view";
export * from "./workspace";

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: false,
  isWin: false,
  isLinux: false,
  isSafari: false,
  resourcePathPrefix: "app://test/",
};

export function getLanguage(): string {
  return "en";
}
