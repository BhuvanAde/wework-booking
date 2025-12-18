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

  function mapBuildingsToLocations(buildings) {
    if (!Array.isArray(buildings)) return [];

    return buildings.map((b) => {
      const address = b.address || {};
      const buildingName = address.buildingName || b.name || '';
      const city = (address.city || '').trim();
      const stateCode = address.stateCode || '';

      const locationAddressParts = [];
      if (address.line1) locationAddressParts.push(address.line1);
      if (address.line2) locationAddressParts.push(address.line2);
      const locationAddress = locationAddressParts.join(', ');

      return {
        name: buildingName,
        locationId: b.locationUuid || b._id || '',
        city: city || undefined,
        country: 'India',
        mailData: {
          locationAddress: locationAddress || buildingName,
          locationName: buildingName,
          locationCity: city || 'Bengaluru',
          locationCountry: 'IND',
          locationState: stateCode || 'KA',
        },
      };
    });
  }

  async function fetchBuildingsFromApi(citySlug) {
    const nextData = window.__NEXT_DATA__ || null;
    let buildId = nextData && nextData.buildId;

    // Fallback buildId for Bangalore if none is available from __NEXT_DATA__
    if (!buildId && citySlug.toLowerCase() === 'bangalore') {
      buildId = 'TulhsZ6t_Z7i3brfoKhP8';
    }

    if (!buildId) {
      return [];
    }

    const url = `https://wework.co.in/_next/data/${buildId}/coworking-space/${citySlug}.json?city=${citySlug}`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const buildings =
      (data &&
        data.pageProps &&
        data.pageProps.locationsData &&
        data.pageProps.locationsData.buildingsData) ||
      [];

    return buildings;
  }

  async function fetchBuildingsFromLocalJson(citySlug) {
    try {
      // Only attempt local fallback for Bangalore, which you provided in response.json
      if (citySlug.toLowerCase() !== 'bangalore') {
        return [];
      }

      const url = chrome.runtime.getURL('response.json');
      const resp = await fetch(url);
      if (!resp.ok) {
        return [];
      }

      const data = await resp.json();
      const buildings =
        (data &&
          data.pageProps &&
          data.pageProps.locationsData &&
          data.pageProps.locationsData.buildingsData) ||
        [];

      return buildings;
    } catch (e) {
      console.error('Failed to load locations from local response.json:', e);
      return [];
    }
  }

  async function getAvailableLocationsFromApi() {
    try {
      if (window.location.hostname !== 'wework.co.in') {
        return [];
      }

      // Determine city slug from URL or __NEXT_DATA__
      let citySlug = 'bangalore';
      const pathMatch = window.location.pathname.match(/\/coworking-space\/([^/?#]+)/i);
      const nextData = window.__NEXT_DATA__ || null;

      if (pathMatch && pathMatch[1]) {
        citySlug = pathMatch[1];
      } else if (nextData && nextData.query && nextData.query.city) {
        citySlug = nextData.query.city;
      }

      // 1) Try live API
      let buildings = [];
      try {
        buildings = await fetchBuildingsFromApi(citySlug);
      } catch (e) {
        // swallow and try local fallback below
      }

      // 2) Fallback to bundled response.json for Bangalore if needed
      if (!buildings || !buildings.length) {
        const localBuildings = await fetchBuildingsFromLocalJson(citySlug);
        if (localBuildings && localBuildings.length) {
          buildings = localBuildings;
        }
      }

      if (!buildings || !buildings.length) {
        return [];
      }

      return mapBuildingsToLocations(buildings);
    } catch (e) {
      console.error('Failed to load locations from WeWork API:', e);
      return [];
    }
  }

  function getAvailableLocationsFromPage() {
    const locations = [];

    // Try to extract locations from common WeWork booking DOM patterns.
    // This is intentionally defensive: it will return whatever it can find.

    // Example 1: options in a select dropdown for locations
    const selects = document.querySelectorAll('select');
    selects.forEach((sel) => {
      if (sel.id && sel.id.toLowerCase().includes('location')) {
        sel.querySelectorAll('option').forEach((opt) => {
          if (!opt.value) return;
          locations.push({
            name: opt.textContent.trim(),
            locationId: opt.value,
          });
        });
      }
    });

    // Example 2: data attributes / cards for locations
    const locationCards = document.querySelectorAll('[data-location-id], [data-locationid], [data-space-id]');
    locationCards.forEach((el) => {
      const nameEl =
        el.querySelector('[data-test="location-name"]') ||
        el.querySelector('.location-name') ||
        el.querySelector('h3, h4');

      const name = nameEl ? nameEl.textContent.trim() : (el.getAttribute('data-name') || '').trim();
      if (!name) return;

      const locationId = el.getAttribute('data-location-id') || el.getAttribute('data-locationid') || '';
      const spaceId = el.getAttribute('data-space-id') || '';
      const city = el.getAttribute('data-city') || '';
      const country = el.getAttribute('data-country') || '';

      locations.push({
        name,
        locationId: locationId || undefined,
        spaceId: spaceId || undefined,
        city: city || undefined,
        country: country || undefined,
      });
    });

    // De-duplicate by name + locationId + spaceId
    const deduped = [];
    const seen = new Set();
    locations.forEach((loc) => {
      const key = [loc.name, loc.locationId || '', loc.spaceId || ''].join('|');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(loc);
      }
    });

    return deduped;
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

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'getAvailableLocations') {
      (async () => {
        try {
          let locations = await getAvailableLocationsFromApi();
          if (!locations || !locations.length) {
            locations = getAvailableLocationsFromPage();
          }
          sendResponse({ locations });
        } catch (e) {
          sendResponse({ locations: [] });
        }
      })();
      return true;
    }
  });
})();
