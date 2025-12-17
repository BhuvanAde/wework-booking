// Content script to extract authentication token from WeWork pages
(function() {
  function extractToken() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('auth0') || key.includes('token') || key.includes('access'))) {
          const value = localStorage.getItem(key);
          try {
            const parsed = JSON.parse(value);
            if (parsed.access_token || parsed.idToken || parsed.accessToken) {
              const token = parsed.access_token || parsed.idToken || parsed.accessToken;
              sendTokenToBackground(token);
              return;
            }
          } catch (e) {
            if (value && value.length > 50) {
              sendTokenToBackground(value);
              return;
            }
          }
        }
      }
    } catch (e) {
      console.log('Could not access localStorage:', e);
    }

    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];
      const options = args[1] || {};
      
      if (options.headers) {
        const authHeader = options.headers.get ? 
          options.headers.get('authorization') : 
          options.headers['authorization'] || options.headers['Authorization'];
        
        if (authHeader) {
          const match = authHeader.match(/bearer\s+(.+)/i);
          if (match && match[1]) {
            sendTokenToBackground(match[1]);
          }
        }
      }
      
      return originalFetch.apply(this, args);
    };

    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    
    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
      if (header.toLowerCase() === 'authorization' && value) {
        const match = value.match(/bearer\s+(.+)/i);
        if (match && match[1]) {
          sendTokenToBackground(match[1]);
        }
      }
      return originalSetRequestHeader.apply(this, arguments);
    };
  }

  function sendTokenToBackground(token) {
    if (token && token.length > 20) {
      chrome.runtime.sendMessage({
        action: 'tokenFromPage',
        token: token
      }).catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', extractToken);
  } else {
    extractToken();
  }

  setTimeout(extractToken, 2000);
  setTimeout(extractToken, 5000);
})();
