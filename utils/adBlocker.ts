import { Page, Route } from '@playwright/test';

const AD_PATTERNS = [
  '**/googleads**',
  '**/googlesyndication**',
  '**/doubleclick**',
  '**/adservice**',
  '**/adsbygoogle**',
  '**/pagead/**',
  '**/analytics.js',
  '**/gtag/**',
  '**/gtm.js',
  '**facebook.com/tr/**',
  '**/cdn.jsdelivr.net/npm/bootstrap@**',  // not an ad, keep separate
];

const AD_RESOURCE_TYPES = ['image', 'stylesheet', 'script', 'font', 'media'];
const AD_URL_FRAGMENTS = [
  'googleads',
  'googlesyndication',
  'doubleclick',
  'adsbygoogle',
  'pagead',
  'adservice',
  'adnxs',
  'taboola',
  'outbrain',
  'amazon-adsystem',
  'serving-sys',
  'ads.yahoo',
  'adsafeprotected',
];

export async function blockAds(page: Page): Promise<void> {
  await page.route('**/*', (route: Route) => {
    const url = route.request().url();
    const isAd = AD_URL_FRAGMENTS.some((fragment) => url.includes(fragment));
    if (isAd) {
      route.abort();
    } else {
      route.continue();
    }
  });
}
