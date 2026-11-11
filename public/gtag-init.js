// Google Ads measurement, loaded only after the explorer allows it (Consent Mode, basic setup).
// Until then nothing is sent to Google and no advertising cookies are set.
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
window.ngLoadAdsTag = function () {
  // Teen mode: a teenage explorer's device never loads the ads tag (services/guardian.ts sets this)
  try { if (localStorage.getItem('naturegram_teen') === '1') return; } catch (e) {}
  if (window.__ngAdsLoaded) return;
  window.__ngAdsLoaded = true;
  gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'granted' });
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=AW-18396778844';
  document.head.appendChild(s);
  gtag('js', new Date());
  gtag('config', 'AW-18396778844');
};
// Ad measurement is its own choice (Settings → Privacy). Those who allowed "statistics and ads"
// before the two were separated keep that until they change it.
try {
  var ads = localStorage.getItem('naturegram_ads_consent');
  if (ads === 'granted' || (!ads && localStorage.getItem('naturegram_analytics_consent') === 'granted')) window.ngLoadAdsTag();
} catch (e) {}
