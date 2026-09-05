(function () {
  'use strict';

  var CONSENT_KEY = 'junction_analytics_consent_v1';
  var GA_ID = 'G-QMWSLKMWNJ';
  var META_PIXEL_ID = '2626183047450873';
  var trackingLoaded = false;

  function loadScript(src) {
    var script = document.createElement('script');
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  function enableTracking() {
    if (trackingLoaded) return;
    trackingLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });
    loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID));

    if (!window.fbq) {
      var fbq = function () {
        fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
      };
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = '2.0';
      fbq.queue = [];
      window.fbq = fbq;
      window._fbq = fbq;
      loadScript('https://connect.facebook.net/en_US/fbevents.js');
    }
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  function trackBookCallClick(link) {
    if (!trackingLoaded) return;
    var payload = {
      destination: 'calendly_discovery_meeting',
      page_path: window.location.pathname,
      link_text: (link.textContent || '').trim()
    };
    window.gtag('event', 'book_call_click', payload);
    window.fbq('trackCustom', 'BookCallClick', payload);
  }

  function removeConsentUi() {
    var banner = document.getElementById('junction-consent-banner');
    var preferences = document.getElementById('junction-consent-preferences');
    if (banner) banner.remove();
    if (preferences) preferences.remove();
  }

  function saveConsent(value) {
    try { window.localStorage.setItem(CONSENT_KEY, value); } catch (_) {}
    removeConsentUi();
    if (value === 'granted') enableTracking();
    renderPreferencesButton();
  }

  function renderPreferencesButton() {
    if (document.getElementById('junction-consent-preferences')) return;
    var button = document.createElement('button');
    button.id = 'junction-consent-preferences';
    button.type = 'button';
    button.textContent = 'Cookie choices';
    button.setAttribute('aria-label', 'Review analytics cookie choices');
    button.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483646;border:1px solid #B8D4EA;border-radius:8px;background:#F7FBFD;color:#14385C;font:600 12px Manrope,Arial,sans-serif;padding:8px 10px;cursor:pointer;box-shadow:0 2px 10px rgba(15,44,73,.12)';
    button.addEventListener('click', function () {
      removeConsentUi();
      renderBanner();
    });
    document.body.appendChild(button);
  }

  function renderBanner() {
    if (document.getElementById('junction-consent-banner')) return;
    var banner = document.createElement('section');
    banner.id = 'junction-consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-modal', 'false');
    banner.setAttribute('aria-labelledby', 'junction-consent-title');
    banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;max-width:720px;margin:0 auto;border:1px solid #B8D4EA;border-radius:14px;background:#F7FBFD;color:#14385C;padding:18px;box-shadow:0 12px 36px rgba(15,44,73,.22);font-family:Manrope,Arial,sans-serif';
    banner.innerHTML = '<div id="junction-consent-title" style="font-family:Sora,Manrope,Arial,sans-serif;font-weight:800;font-size:16px">Choose whether we measure visits</div>' +
      '<p style="margin:8px 0 0;color:#3D5F84;font-size:14px;line-height:1.55">With your permission, Google Analytics and the Meta Pixel help us understand which pages and ads lead to a call. Essential-only leaves both off. See our <a href="/privacy" style="color:#2E86D0">privacy policy</a>.</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">' +
      '<button type="button" data-consent="granted" style="min-height:44px;border:0;border-radius:10px;background:#2E86D0;color:#fff;font:700 14px Sora,Manrope,Arial,sans-serif;padding:10px 16px;cursor:pointer">Allow analytics</button>' +
      '<button type="button" data-consent="denied" style="min-height:44px;border:1px solid #B8D4EA;border-radius:10px;background:transparent;color:#14385C;font:700 14px Sora,Manrope,Arial,sans-serif;padding:10px 16px;cursor:pointer">Essential only</button>' +
      '</div>';
    banner.addEventListener('click', function (event) {
      var button = event.target.closest('[data-consent]');
      if (button) saveConsent(button.getAttribute('data-consent'));
    });
    document.body.appendChild(banner);
  }

  function boot() {
    document.addEventListener('click', function (event) {
      var link = event.target.closest('a[href*="calendly.com/tom-getjunction/discovery-meeting"]');
      if (link) trackBookCallClick(link);
    });

    var choice = null;
    try { choice = window.localStorage.getItem(CONSENT_KEY); } catch (_) {}
    if (choice === 'granted') {
      enableTracking();
      renderPreferencesButton();
    } else if (choice === 'denied') {
      renderPreferencesButton();
    } else {
      renderBanner();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
