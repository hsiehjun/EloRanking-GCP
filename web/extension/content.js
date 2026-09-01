// OmniTactica BCP Bridge Content Script
(function () {
  const isBcp = window.location.hostname.includes('bestcoastpairings.com');
  const isOmni = window.location.hostname.includes('omnitactica.com') || window.location.hostname === 'localhost';

  if (isOmni) {
    window.__OMNITACTICA_BCP_EXTENSION_INSTALLED__ = true;
    window.postMessage({ type: 'OMNITACTICA_EXTENSION_AVAILABLE', version: '1.0.0' }, '*');
    document.documentElement.setAttribute('data-omnitactica-extension-installed', 'true');

    // Listen for extension messages
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === 'OMNITACTICA_BCP_SESSION_TOKENS') {
        window.postMessage({ type: 'OMNITACTICA_BCP_SESSION_TOKENS', tokens: message.tokens }, '*');
      }
    });
    return;
  }

  if (isBcp) {
    function extractBcpTokens() {
      const tokens = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.includes('idToken')) tokens.id_token = localStorage.getItem(k);
        if (k.includes('accessToken')) tokens.access_token = localStorage.getItem(k);
        if (k.includes('refreshToken')) tokens.refresh_token = localStorage.getItem(k);
      }
      return (tokens.id_token || tokens.access_token) ? tokens : null;
    }

    function checkAndRelayTokens() {
      const tokens = extractBcpTokens();
      if (!tokens) return false;

      if (window.opener && !window.opener.closed) {
        try {
          window.opener.postMessage(
            {
              type: 'OMNITACTICA_BCP_SESSION_TOKENS',
              tokens: tokens,
              source: 'bcp_popup'
            },
            '*'
          );
          setTimeout(() => {
            window.close();
          }, 600);
          return true;
        } catch (err) {
          console.warn('[OmniTactica Bridge] Opener relay notice:', err);
        }
      }

      chrome.runtime.sendMessage({
        type: 'BCP_TOKENS_EXTRACTED',
        tokens: tokens
      });
      return true;
    }

    if (!checkAndRelayTokens()) {
      const interval = setInterval(() => {
        if (checkAndRelayTokens()) {
          clearInterval(interval);
        }
      }, 800);
      setTimeout(() => clearInterval(interval), 180000);
    }
  }
})();
