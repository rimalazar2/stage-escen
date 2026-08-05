/**
 * Module de détection d'outils d'automatisation / scraping.
 *
 * Deux couches complémentaires :
 *  - Côté client : signaux JavaScript haute précision (flag `webdriver`,
 *    traces ChromeDriver, UA headless…) remontés avec chaque tentative.
 *  - Côté serveur : patterns User-Agent connus (scrapers, headless, clients
 *    HTTP) + exigence du payload client — une vraie page exécute toujours
 *    son JS, donc un payload absent trahit un appel scripté.
 *
 * NB honnête : cette détection relève la barre pour les robots naïfs et les
 * scrapers simples. Un attaquant déterminé peut la contourner — la protection
 * principale reste Turnstile (CAPTCHA) + le rate limiting par IP. Les signaux
 * sont volontairement conservateurs (uniquement haute précision) pour ne pas
 * bloquer de visiteurs légitimes.
 */

export type BotSignal = string;

// ─── Côté serveur : User-Agents de bots / scrapers connus ───
// Haute précision : ces motifs ne sont jamais portés par un navigateur réel.
export const BOT_UA_PATTERNS: RegExp[] = [
  /headless/i, // HeadlessChrome
  /phantomjs/i,
  /puppeteer/i,
  /playwright/i,
  /selenium/i,
  /webdriver/i,
  /python[-_ ]?requests/i,
  /python-urllib/i,
  /scrapy/i,
  /curl\//i,
  /wget/i,
  /go-http-client/i,
  /okhttp/i,
  /apache-httpclient/i,
  /java\/\d/i,
  /node-fetch/i,
  /axios\/\d/i,
  /postman/i,
];

/**
 * Détection côté client : signaux d'automatisation observables dans le
 * navigateur. Retourne un tableau de signaux (vide si environnement sain).
 * Ne jamais exécuter côté serveur (retourne [] par sécurité).
 */
export function detectAutomationClient(): BotSignal[] {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return [];
  }

  const signals: BotSignal[] = [];
  const nav = navigator;

  // Flag `webdriver` — exposé par défaut par Playwright / Puppeteer / Selenium
  if (nav.webdriver === true) {
    signals.push("navigator.webdriver");
  }

  // Traces ChromeDriver laissées sur window (cdc_ / $cdc)
  const win = window as unknown as Record<string, unknown>;
  if (win.cdc_ || win.$cdc) {
    signals.push("cdc_chromedriver");
  }

  // Attribut `webdriver` posé sur <html> par certains drivers
  if (document.documentElement.getAttribute("webdriver") !== null) {
    signals.push("html[webdriver]");
  }

  // UA explicitement headless / outil d'automatisation
  if (BOT_UA_PATTERNS.some((re) => re.test(nav.userAgent))) {
    signals.push("headless_ua");
  }

  // navigator.languages absent ou vide — signature classique du headless Chrome
  if (!nav.languages || nav.languages.length === 0) {
    signals.push("no_languages");
  }

  // plugins ET languages absents → environnement headless (un mobile réel
  // garde toujours navigator.languages, même avec 0 plugins)
  if ((!nav.languages || nav.languages.length === 0) && nav.plugins.length === 0) {
    signals.push("no_plugins_no_languages");
  }

  return signals;
}

/**
 * Analyse côté serveur : patterns User-Agent + validité du payload client.
 *
 * Le payload `clientSignals` est obligatoire : la page de vérification
 * exécute toujours son JS avant d'envoyer la requête. Un payload absent ou
 * malformé (autre qu'un tableau de chaînes) signale un appel direct scripté
 * (curl, scraper, test automatisé).
 *
 * Retourne `blocked` dès qu'au moins un signal est détecté.
 */
export function analyzeBotRisk(
  userAgent: string,
  clientSignals: unknown
): { blocked: boolean; signals: BotSignal[] } {
  const signals: BotSignal[] = [];

  if (BOT_UA_PATTERNS.some((re) => re.test(userAgent))) {
    signals.push("server_ua_bot");
  }

  if (
    !Array.isArray(clientSignals) ||
    clientSignals.some((s) => typeof s !== "string")
  ) {
    signals.push("missing_payload");
  }

  if (Array.isArray(clientSignals)) {
    // Les signaux remontés par le client font foi (headless, webdriver…)
    signals.push(...clientSignals);
  }

  // Dédoublonnage (ex: UA bot détecté des deux côtés → server_ua_bot + headless_ua)
  return { blocked: signals.length > 0, signals: Array.from(new Set(signals)) };
}
