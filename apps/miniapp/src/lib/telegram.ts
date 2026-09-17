import {
  bindThemeParamsCssVars,
  init,
  initDataRaw,
  initDataUser,
  miniAppReady,
  mountThemeParamsSync,
  restoreInitData,
} from '@telegram-apps/sdk';

/**
 * Everything the app learns from Telegram at launch (ARCH §12).
 *
 * Outside Telegram — a plain browser during development — none of this is available, and the
 * app falls back to the dev auth bypass of ARCH §4.
 */
export interface TelegramEnvironment {
  /** True when we are running inside a Telegram web view. */
  inside: boolean;
  /** The signed `initData`, sent verbatim as `Authorization: tma …`. */
  initDataRaw: string | null;
  /** Telegram's UI language, used until `GET /me` says what the member picked. */
  languageCode: string | null;
  /** `startapp` payload of a deep link, e.g. `r_<reservationId>` (ARCH §4). */
  startParam: string | null;
}

let environment: TelegramEnvironment | null = null;

export function initTelegram(): TelegramEnvironment {
  if (environment) return environment;

  let inside: boolean;
  let raw: string | null = null;
  let languageCode: string | null = null;
  let startParam: string | null = null;

  try {
    init();
    restoreInitData();
    raw = initDataRaw() ?? null;
    const user = initDataUser();
    languageCode = user?.language_code ?? null;
    inside = raw !== null;
  } catch {
    inside = false;
  }

  if (inside) {
    // Telegram publishes its palette as `--tg-theme-*` custom properties; `app.css` reads
    // them with sensible fallbacks so the app also looks right in a plain browser.
    try {
      mountThemeParamsSync();
      bindThemeParamsCssVars();
    } catch {
      /* an old client without theme support is not a reason to refuse to start */
    }
    try {
      miniAppReady();
    } catch {
      /* likewise */
    }
    startParam = new URLSearchParams(raw ?? '').get('start_param');
  }

  environment = { inside, initDataRaw: raw, languageCode, startParam };
  return environment;
}

/** Test seam: forget what we learned, so a test can initialise a different environment. */
export function resetTelegram(): void {
  environment = null;
}
