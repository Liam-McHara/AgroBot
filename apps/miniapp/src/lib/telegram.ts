import {
  backButton,
  bindThemeParamsCssVars,
  hapticFeedback,
  init,
  initDataRaw,
  initDataUser,
  miniAppReady,
  mountThemeParamsSync,
  openTelegramLink,
  restoreInitData,
} from '@telegram-apps/sdk';
import { pop } from 'svelte-spa-router';

/**
 * Everything the app learns from Telegram at launch (ARCH §12).
 *
 * Outside Telegram — a plain browser during development or the e2e suite — none of this is
 * available, and the app falls back to the dev auth bypass of ARCH §4.
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
    try {
      if (backButton.mount.isAvailable()) {
        backButton.mount();
        backButton.onClick(() => void pop());
      }
    } catch {
      /* likewise */
    }
    startParam = new URLSearchParams(raw ?? '').get('start_param');
  }

  environment = { inside, initDataRaw: raw, languageCode, startParam };
  return environment;
}

/** ARCH §4 `start_param` grammar → the route it opens. Unknown values open the board. */
export function routeForStartParam(startParam: string | null): string | null {
  if (!startParam) return null;
  if (startParam === 'a_members') return '/admin/members';
  if (startParam === 'a_catalog') return '/admin/catalog';
  const reservation = /^r_([0-9a-f-]{36})$/.exec(startParam);
  if (reservation) return `/reservations/${reservation[1]}`;
  const offer = /^o_([0-9a-f-]{36})$/.exec(startParam);
  if (offer) return `/offers/${offer[1]}`;
  return null;
}

const ROOT_ROUTES = new Set(['/', '/offers', '/reservations', '/settings', '/admin/members']);

/** ARCH §12: Telegram's BackButton is wired to the router; hidden on the tab roots. */
export function syncBackButton(location: string): void {
  if (!environment?.inside) return;
  try {
    if (ROOT_ROUTES.has(location)) backButton.hide();
    else backButton.show();
  } catch {
    /* not supported by this client */
  }
}

/** ARCH §12: haptic feedback on actions; silently nothing outside Telegram. */
export function haptic(kind: 'success' | 'error' | 'selection'): void {
  if (!environment?.inside) return;
  try {
    if (kind === 'selection') hapticFeedback.selectionChanged();
    else hapticFeedback.notificationOccurred(kind);
  } catch {
    /* not supported by this client */
  }
}

/**
 * PRD US-5.2 *Open in Telegram*: inside Telegram the client opens the conversation itself;
 * returns false outside it (or on an old client), so the caller lets the plain link work.
 */
export function openInTelegram(url: string): boolean {
  if (!environment?.inside) return false;
  try {
    if (!openTelegramLink.isAvailable()) return false;
    openTelegramLink(url);
    return true;
  } catch {
    return false;
  }
}

/** Test seam: forget what we learned, so a test can initialise a different environment. */
export function resetTelegram(): void {
  environment = null;
}
