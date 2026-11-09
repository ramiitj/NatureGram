// Google Ads measurement, loaded only after the explorer allows it (Consent Mode, basic setup).
// Until then nothing is sent to Google and no advertising cookies are set.
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
window.ngLoadAdsTag = function () {
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
try { if (localStorage.getItem('naturegram_analytics_consent') === 'granted') window.ngLoadAdsTag(); } catch (e) {}
