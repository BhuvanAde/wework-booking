// Background service worker to intercept WeWork API requests and extract tokens
let capturedToken = null;
let capturedHeaders = null;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getToken') {
    chrome.storage.local.get(['weworkToken', 'weworkHeaders'], (result) => {
      sendResponse({ 
        token: result.weworkToken || capturedToken,
        headers: result.weworkHeaders || capturedHeaders
      });
    });
    return true;
  }
  
  if (request.action === 'setToken') {
    capturedToken = request.token;
    capturedHeaders = request.headers;
    chrome.storage.local.set({
      weworkToken: request.token,
      weworkHeaders: request.headers
    });
    sendResponse({ success: true });
    return true;
  }
});

// Intercept network requests to capture authorization token
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.url.includes('members.wework.com') && details.requestHeaders) {
      const authHeader = details.requestHeaders.find(
        header => header.name.toLowerCase() === 'authorization'
      );
      
      if (authHeader && authHeader.value) {
        const tokenMatch = authHeader.value.match(/bearer\s+(.+)/i);
        if (tokenMatch && tokenMatch[1]) {
          const token = tokenMatch[1];
          
          capturedToken = token;
          capturedHeaders = details.requestHeaders.reduce((acc, header) => {
            acc[header.name] = header.value;
            return acc;
          }, {});
          
          chrome.storage.local.set({
            weworkToken: token,
            weworkHeaders: capturedHeaders,
            tokenCapturedAt: Date.now()
          });
          
          chrome.runtime.sendMessage({
            action: 'tokenCaptured',
            token: token
          }).catch(() => {});
        }
      }
    }
  },
  {
    urls: ['https://members.wework.com/*'],
    types: ['xmlhttprequest', 'main_frame', 'sub_frame']
  },
  ['requestHeaders']
);

// Listen for tab updates to check for authentication
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('members.wework.com')) {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: extractTokenFromPage
    }).catch(() => {});
  }
});

function extractTokenFromPage() {
  try {
    const auth0Key = Object.keys(localStorage).find(key => 
      key.includes('auth0') && key.includes('access_token')
    );
    
    if (auth0Key) {
      const tokenData = localStorage.getItem(auth0Key);
      if (tokenData) {
        try {
          const parsed = JSON.parse(tokenData);
          if (parsed.access_token) {
            chrome.runtime.sendMessage({
              action: 'tokenFromPage',
              token: parsed.access_token
            });
          }
        } catch (e) {
          chrome.runtime.sendMessage({
            action: 'tokenFromPage',
            token: tokenData
          });
        }
      }
    }
  } catch (e) {
    // Cross-origin or other error
  }
}

// Listen for token from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'tokenFromPage' && request.token) {
    capturedToken = request.token;
    chrome.storage.local.set({
      weworkToken: request.token,
      tokenCapturedAt: Date.now()
    });
    
    chrome.runtime.sendMessage({
      action: 'tokenCaptured',
      token: request.token
    }).catch(() => {});
    
    sendResponse({ success: true });
    return true;
  }
});

// Handle alarm events for reminders
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name && alarm.name.startsWith('wework-reminder-')) {
    // Extract booking date from alarm name
    const parts = alarm.name.split('-');
    if (parts.length >= 4) {
      const bookingDate = parts.slice(2, -1).join('-'); // Get date part
      const daysBefore = parts[parts.length - 1];
      
      // Get reminder details from storage
      chrome.storage.local.get(['weworkReminders', 'selectedLocation'], (result) => {
        const reminders = result.weworkReminders || [];
        const location = result.selectedLocation || { name: 'WeWork Location' };
        
        const reminder = reminders.find(r => 
          r.bookingDate === bookingDate && r.daysBefore.toString() === daysBefore
        );
        
        if (reminder) {
          const bookingDateObj = new Date(bookingDate);
          const formattedDate = bookingDateObj.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
          });
          
          // Show notification
          chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/48.png'),
            title: 'WeWork Booking Reminder',
            message: `Your booking at ${location.name} expires in ${daysBefore} day(s) on ${formattedDate}`,
            priority: 2
          });
        }
      });
    }
  }
});
