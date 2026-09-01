// OmniTactica BCP Bridge Service Worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BCP_TOKENS_EXTRACTED') {
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.url && (tab.url.includes('omnitactica.com') || tab.url.includes('localhost'))) {
          chrome.tabs.sendMessage(tab.id, {
            type: 'OMNITACTICA_BCP_SESSION_TOKENS',
            tokens: message.tokens
          }).catch(() => {});
        }
      }
    });
    sendResponse({ relayed: true });
    return true;
  }
});
