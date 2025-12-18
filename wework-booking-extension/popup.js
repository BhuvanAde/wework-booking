// Calendar and booking functionality
class WeWorkBookingExtension {
  constructor() {
    this.selectedDates = new Set();
    this.bookedDates = new Set();
    this.currentDate = new Date();
    this.authToken = null;
    this.bookingInProgress = false;
    this.location = this.getDefaultLocation();
    this.successfulBookings = [];
    this.allLocations = [];
    this.init();
  }

  async init() {
    await this.checkAuthentication();
    await this.loadLocationFromStorage();
    await this.loadBookingsFromStorage();
    this.setupEventListeners();
    this.renderCalendar();
    
    // Listen for token updates from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'tokenCaptured') {
        this.checkAuthentication().then(() => {
          // After a fresh token capture, sync upcoming bookings as well
          this.syncBookingsFromApi().catch(() => {});
        });
      }
    });
  }

  async checkAuthentication() {
    const authStatus = document.getElementById('authStatus');
    const statusIndicator = document.getElementById('statusIndicator');
    const authText = document.getElementById('authText');
    const loginSection = document.getElementById('loginSection');
    const bookingSection = document.getElementById('bookingSection');
    const bookingFooter = document.getElementById('bookingFooter');

    try {
      // Get token from storage
      const result = await chrome.storage.local.get(['weworkToken', 'weworkHeaders']);
      
      if (result.weworkToken) {
        this.authToken = result.weworkToken;
        this.headers = result.weworkHeaders || this.getDefaultHeaders();
        
        statusIndicator.className = 'status-indicator authenticated';
        authText.textContent = 'Authenticated';
        loginSection.style.display = 'none';
        bookingSection.style.display = 'block';
        if (bookingFooter) bookingFooter.style.display = 'block';
        // Ensure bookings are synced as soon as we know we're authenticated
        this.syncBookingsFromApi().catch(() => {});
        return;
      }

      // Try to get token from background script
      const token = await this.requestTokenFromBackground();
      if (token) {
        this.authToken = token;
        statusIndicator.className = 'status-indicator authenticated';
        authText.textContent = 'Authenticated';
        loginSection.style.display = 'none';
        bookingSection.style.display = 'block';
        if (bookingFooter) bookingFooter.style.display = 'block';
        // Ensure bookings are synced as soon as we know we're authenticated
        this.syncBookingsFromApi().catch(() => {});
        return;
      }

      // Not authenticated
      statusIndicator.className = 'status-indicator error';
      authText.textContent = 'Not authenticated';
      loginSection.style.display = 'block';
      bookingSection.style.display = 'none';
      if (bookingFooter) bookingFooter.style.display = 'none';
    } catch (error) {
      console.error('Auth check error:', error);
      statusIndicator.className = 'status-indicator error';
      authText.textContent = 'Error checking authentication';
      loginSection.style.display = 'block';
      bookingSection.style.display = 'none';
      if (bookingFooter) bookingFooter.style.display = 'none';
    }
  }

  async requestTokenFromBackground() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getToken' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response?.token || null);
      });
    });
  }

  getDefaultHeaders() {
    return {
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
      "authorization": `bearer ${this.authToken}`,
      "content-type": "application/json",
      "origin": "https://members.wework.com",
      "referer": "https://members.wework.com/workplaceone/content2/bookings/desks",
      "request-source": "MemberWeb/WorkplaceOne/Prod",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
    };
  }

  getDefaultLocation() {
    return {
      name: 'RMZ Latitude Commercial, Bengaluru',
      locationId: 'ffe4017e-e45d-4c8c-b6cc-261a980583d0',
      spaceId: '147',
      weworkSpaceId: '58f4a184-4a5d-11e8-b18d-0ac77f0f6524',
      mailData: {
        locationAddress: 'RMZ Latitude Commercial, 10th floor, Bellary Rd',
        locationName: 'RMZ Latitude Commercial',
        locationCity: 'Bengaluru',
        locationCountry: 'IND',
        locationState: 'KA',
      }
    };
  }

  async loadBookingsFromStorage() {
    try {
      const result = await chrome.storage.local.get(['weworkBookings']);
      const bookings = result.weworkBookings || [];
      const todayStr = this.formatDate(new Date());

      bookings
        .filter((b) => b.date && b.date >= todayStr)
        .forEach((b) => {
          this.bookedDates.add(b.date);
        });

      // Use stored bookings as a base for reminders
      if (this.bookedDates.size > 0 && (!this.successfulBookings || this.successfulBookings.length === 0)) {
        this.successfulBookings = Array.from(this.bookedDates);
      }

      // Additionally, sync with live upcoming bookings API so we also pick up
      // anything you booked directly from the WeWork site.
      await this.syncBookingsFromApi();
    } catch (e) {
      console.warn('Could not load saved bookings, continuing without them.', e);
    }
  }

  async syncBookingsFromApi() {
    if (!this.authToken) {
      // No auth yet; nothing to sync
      return;
    }

    try {
      const response = await fetch(
        'https://members.wework.com/workplaceone/api/common-booking/upcoming-bookings',
        {
          method: 'GET',
          headers: {
            ...this.getDefaultHeaders(),
            authorization: 'bearer ' + this.authToken,
          },
        }
      );

      if (!response.ok) {
        console.error('Failed to fetch upcoming bookings:', response.status);
        return;
      }

      const data = await response.json();
      const apiBookings = (data && data.WeWorkBookings) || [];
      if (!apiBookings.length) {
        return;
      }

      const todayStr = this.formatDate(new Date());
      const location = this.location || this.getDefaultLocation();

      // Normalize API bookings into our lightweight storage shape
      const normalizedFromApi = apiBookings
        .map((b) => {
          const startDate = new Date(b.startsAt || b.kubeStartDate || b.kubeCreatedOnDate);
          const dateStr = this.formatDate(startDate);

          return {
            uuid: b.uuid,
            date: dateStr,
            locationId: b.PropertyExternalReference || (b.reservable && b.reservable.location && b.reservable.location.uuid) || undefined,
            spaceId: b.SpaceExternalReference || (b.reservable && b.reservable.uuid) || undefined,
            weworkSpaceId: location.weworkSpaceId,
            locationName: (b.reservable && b.reservable.location && b.reservable.location.name) || location.name,
          };
        })
        // Only keep future (or today) bookings
        .filter((b) => b.date && b.date >= todayStr);

      if (!normalizedFromApi.length) {
        return;
      }

      // Merge with anything already in storage
      const stored = await chrome.storage.local.get(['weworkBookings']);
      const existingBookings = stored.weworkBookings || [];

      const existingKeys = new Set(
        existingBookings.map((b) => (b.uuid ? `uuid:${b.uuid}` : `date:${b.date}|loc:${b.locationId || ''}|space:${b.spaceId || ''}`))
      );

      const newFromApi = normalizedFromApi.filter((b) => {
        const key = b.uuid ? `uuid:${b.uuid}` : `date:${b.date}|loc:${b.locationId || ''}|space:${b.spaceId || ''}`;
        return !existingKeys.has(key);
      });

      if (newFromApi.length > 0) {
        const allBookings = existingBookings.concat(newFromApi);
        await chrome.storage.local.set({ weworkBookings: allBookings });

        // Update in-memory bookedDates and reminders
        newFromApi.forEach((b) => {
          if (b.date >= todayStr) {
            this.bookedDates.add(b.date);
          }
        });

        if (!this.successfulBookings || this.successfulBookings.length === 0) {
          this.successfulBookings = Array.from(this.bookedDates);
        }

        // Re-render calendar so newly discovered booked dates are marked
        this.renderCalendar();
      }
    } catch (e) {
      console.error('Error while syncing upcoming bookings from API:', e);
    }
  }

  /**
   * Verify on the WeWork API that a booking actually exists for the given date.
   * This protects us from cases where the booking endpoint returns 200
   * but no reservation is created (credits, cut‑off windows, etc.).
   */
  async confirmBookingOnServer(date) {
    if (!this.authToken) {
      return false;
    }

    const targetDateStr = this.formatDate(date);

    try {
      const response = await fetch(
        'https://members.wework.com/workplaceone/api/common-booking/upcoming-bookings',
        {
          method: 'GET',
          headers: {
            ...this.getDefaultHeaders(),
            authorization: 'bearer ' + this.authToken,
          },
        }
      );

      if (!response.ok) {
        console.error('Failed to confirm booking on server:', response.status);
        return false;
      }

      const data = await response.json();
      const apiBookings = (data && data.WeWorkBookings) || [];
      if (!apiBookings.length) {
        return false;
      }

      return apiBookings.some((b) => {
        const startDate = new Date(
          b.startsAt || b.kubeStartDate || b.kubeCreatedOnDate
        );
        const dateStr = this.formatDate(startDate);
        return dateStr === targetDateStr;
      });
    } catch (e) {
      console.error('Error while confirming booking on server:', e);
      return false;
    }
  }

  async loadLocationFromStorage() {
    try {
      const result = await chrome.storage.local.get(['selectedLocation']);
      if (result.selectedLocation) {
        this.location = { ...this.getDefaultLocation(), ...result.selectedLocation };
      }
    } catch (e) {
      console.warn('Could not load saved location, using default.', e);
    }

    const locationNameEl = document.getElementById('locationName');
    const spaceIdEl = document.getElementById('spaceId');
    if (locationNameEl) {
      locationNameEl.textContent = this.location.name;
    }
    if (spaceIdEl && this.location.spaceId) {
      spaceIdEl.textContent = this.location.spaceId;
    }
  }

  setupEventListeners() {
    document.getElementById('prevMonth').addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() - 1);
      this.renderCalendar();
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
      this.currentDate.setMonth(this.currentDate.getMonth() + 1);
      this.renderCalendar();
    });

    document.getElementById('selectAllBtn').addEventListener('click', () => {
      this.selectAllVisibleDates();
    });

    document.getElementById('clearSelectionBtn').addEventListener('click', () => {
      this.clearSelection();
    });

    document.getElementById('bookAllBtn').addEventListener('click', () => {
      this.bookAllSelectedDates();
    });

    document.getElementById('openWeWorkBtn').addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://members.wework.com' });
    });

    document.getElementById('refreshTokenBtn').addEventListener('click', () => {
      this.checkAuthentication();
    });

    document.getElementById('closeResultsBtn').addEventListener('click', () => {
      document.getElementById('resultsSection').style.display = 'none';
    });

    const setReminderBtn = document.getElementById('setReminderBtn');
    if (setReminderBtn) {
      setReminderBtn.addEventListener('click', () => {
        this.setReminder();
      });
    }

    document.getElementById('skipSundays').addEventListener('change', () => {
      this.renderCalendar();
    });

    const editLocationBtn = document.getElementById('editLocationBtn');
    const cancelLocationEditBtn = document.getElementById('cancelLocationEditBtn');
    const locationCitySelect = document.getElementById('locationCitySelect');
    const locationSearchInput = document.getElementById('locationSearch');

    if (editLocationBtn) {
      editLocationBtn.addEventListener('click', () => {
        this.openLocationEditor();
      });
    }

    if (cancelLocationEditBtn) {
      cancelLocationEditBtn.addEventListener('click', () => {
        this.closeLocationEditor();
      });
    }

    if (locationCitySelect) {
      locationCitySelect.addEventListener('change', () => {
        if (document.getElementById('locationSelector').style.display === 'block') {
          const status = document.getElementById('locationSelectorStatus');
          const list = document.getElementById('locationList');
          status.textContent = 'Loading WeWork locations...';
          list.innerHTML = '';
          this.loadLocationsWithoutActivePage(status, list);
        }
      });
    }

    if (locationSearchInput) {
      locationSearchInput.addEventListener('input', () => {
        const list = document.getElementById('locationList');
        this.renderLocationList(list);
      });
    }
  }

  openLocationEditor() {
    const selector = document.getElementById('locationSelector');
    const status = document.getElementById('locationSelectorStatus');
    const list = document.getElementById('locationList');
    const searchInput = document.getElementById('locationSearch');

    if (!selector || !status || !list) return;

    selector.style.display = 'block';
    status.textContent = 'Loading WeWork locations...';
    list.innerHTML = '';
    if (searchInput) searchInput.value = '';

    // Directly load from API / bundled JSON, no need for the WeWork page to be open.
    this.loadLocationsWithoutActivePage(status, list);
  }

  async loadLocationsWithoutActivePage(statusEl, listEl) {
    try {
      const citySelect = document.getElementById('locationCitySelect');
      const citySlug = citySelect ? citySelect.value : 'bangalore';

      const locations = await this.fetchLocationsFromWeWorkApi(citySlug);

      if (!locations || !locations.length) {
        statusEl.textContent = 'No locations found from the WeWork API. Try reloading the page.';
        return;
      }

      statusEl.textContent = 'Select a location to use for future bookings:';
      this.allLocations = locations;
      this.renderLocationList(listEl);
    } catch (e) {
      console.error('Failed to load locations for active tab', e);
      statusEl.textContent = 'Failed to load locations from WeWork. Try again or reload the page.';
    }
  }

  renderLocationList(listEl) {
    const searchInput = document.getElementById('locationSearch');
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();

    listEl.innerHTML = '';

    const filtered = this.allLocations.filter((loc) => {
      if (!query) return true;
      const name = (loc.name || '').toLowerCase();
      const city = (loc.city || '').toLowerCase();
      return name.includes(query) || city.includes(query);
    });

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'location-item';
      empty.textContent = 'No locations match your search.';
      listEl.appendChild(empty);
      return;
    }

    filtered.forEach((loc) => {
      const item = document.createElement('div');
      item.className = 'location-item';

      const name = document.createElement('div');
      name.className = 'location-item-name';
      name.textContent = loc.name || 'Unknown location';

      const meta = document.createElement('div');
      meta.className = 'location-item-meta';
      const parts = [];
      if (loc.city) parts.push(loc.city);
      if (loc.country) parts.push(loc.country);
      if (loc.spaceId) parts.push('Space ID: ' + loc.spaceId);
      if (loc.locationId) parts.push('Location ID: ' + loc.locationId);
      meta.textContent = parts.join(' • ');

      item.appendChild(name);
      if (parts.length) {
        item.appendChild(meta);
      }

      item.addEventListener('click', () => {
        this.setLocationFromSelection(loc);
      });

      listEl.appendChild(item);
    });
  }

  async fetchLocationsFromWeWorkApi(citySlug) {
    // 1) Try bundled response.json first so we don't depend on the current page.
    try {
      const url = chrome.runtime.getURL('response.json');
      const resp = await fetch(url);
      if (!resp.ok) {
        console.error('Could not load bundled response.json', resp.status);
        return [];
      }

      const data = await resp.json();
      const buildings =
        (data &&
          data.pageProps &&
          data.pageProps.locationsData &&
          data.pageProps.locationsData.buildingsData) ||
        [];

      if (buildings.length) {
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
      } else {
        console.error('Bundled response.json has no buildingsData');
      }
    } catch (e) {
      console.error('Failed to load or parse bundled response.json', e);
    }

    // 2) Fallback to live WeWork API using known buildId for Bangalore
    try {
      const buildId = 'TulhsZ6t_Z7i3brfoKhP8';
      const apiUrl = `https://wework.co.in/_next/data/${buildId}/coworking-space/${citySlug}.json?city=${citySlug}`;

      const resp = await fetch(apiUrl, { credentials: 'include' });
      if (!resp.ok) {
        console.error('Live WeWork API returned non-OK status', resp.status);
        return [];
      }

      const data = await resp.json();
      const buildings =
        (data &&
          data.pageProps &&
          data.pageProps.locationsData &&
          data.pageProps.locationsData.buildingsData) ||
        [];

      if (!buildings.length) {
        console.error('Live WeWork API response has no buildingsData');
        return [];
      }

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
    } catch (e) {
      console.error('Failed to load locations from live WeWork API', e);
      return [];
    }
  }

  closeLocationEditor() {
    const selector = document.getElementById('locationSelector');
    if (selector) {
      selector.style.display = 'none';
    }
  }

  async setLocationFromSelection(loc) {
    const merged = {
      ...this.getDefaultLocation(),
      ...loc,
      mailData: {
        ...this.getDefaultLocation().mailData,
        ...(loc.mailData || {})
      }
    };

    this.location = merged;

    const locationNameEl = document.getElementById('locationName');
    const spaceIdEl = document.getElementById('spaceId');
    if (locationNameEl) {
      locationNameEl.textContent = merged.name || this.getDefaultLocation().name;
    }
    if (spaceIdEl && merged.spaceId) {
      spaceIdEl.textContent = merged.spaceId;
    }

    try {
      await chrome.storage.local.set({ selectedLocation: merged });
    } catch (e) {
      console.warn('Failed to save selected location.', e);
    }

    this.closeLocationEditor();
  }

  renderCalendar() {
    const calendarGrid = document.getElementById('calendarGrid');
    const monthYear = document.getElementById('currentMonthYear');
    
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    
    monthYear.textContent = new Date(year, month, 1).toLocaleDateString('en-US', { 
      month: 'long', 
      year: 'numeric' 
    });

    calendarGrid.innerHTML = '';

    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
      const header = document.createElement('div');
      header.className = 'calendar-day-header';
      header.textContent = day;
      calendarGrid.appendChild(header);
    });

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    for (let i = 0; i < startingDayOfWeek; i++) {
      const emptyDay = document.createElement('div');
      emptyDay.className = 'calendar-day other-month';
      calendarGrid.appendChild(emptyDay);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dateStr = this.formatDate(date);
      const isPast = date < today;
      const isSunday = date.getDay() === 0;
      const isSelected = this.selectedDates.has(dateStr);
      const isToday = date.getTime() === today.getTime();
      const isBooked = this.bookedDates.has(dateStr);
      const skipSundays = document.getElementById('skipSundays').checked;

      const dayElement = document.createElement('div');
      dayElement.className = 'calendar-day';
      dayElement.textContent = day;

      if (isPast) {
        dayElement.classList.add('disabled');
      } else if (isBooked) {
        dayElement.classList.add('booked');
        dayElement.classList.add('disabled');
      } else if (isToday) {
        dayElement.classList.add('today');
      } else if (isSunday) {
        dayElement.classList.add('sunday');
      }

      if (isSelected) {
        dayElement.classList.add('selected');
      }

      if (!isPast && !(skipSundays && isSunday)) {
        dayElement.addEventListener('click', () => {
          this.toggleDateSelection(dateStr, date);
        });
      } else if (skipSundays && isSunday) {
        dayElement.classList.add('disabled');
      }

      calendarGrid.appendChild(dayElement);
    }

    this.updateSelectedDatesDisplay();
  }

  formatDate(date) {
    // Use local calendar date (not UTC) so that
    // what you click in the UI matches what we
    // store, display, and send to the API.
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  toggleDateSelection(dateStr, date) {
    const skipSundays = document.getElementById('skipSundays').checked;
    
    if (skipSundays && date.getDay() === 0) {
      return;
    }

    if (this.selectedDates.has(dateStr)) {
      this.selectedDates.delete(dateStr);
    } else {
      this.selectedDates.add(dateStr);
    }

    this.renderCalendar();
    this.updateBookButtonState();
  }

  selectAllVisibleDates() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const skipSundays = document.getElementById('skipSundays').checked;

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month, day);
      if (date >= today) {
        if (!skipSundays || date.getDay() !== 0) {
          this.selectedDates.add(this.formatDate(date));
        }
      }
    }

    this.renderCalendar();
    this.updateBookButtonState();
  }

  clearSelection() {
    this.selectedDates.clear();
    this.renderCalendar();
    this.updateBookButtonState();
  }

  updateSelectedDatesDisplay() {
    const selectedDatesDiv = document.getElementById('selectedDates');
    const selectedList = document.getElementById('selectedList');
    const selectedCount = document.getElementById('selectedCount');

    if (this.selectedDates.size === 0) {
      selectedDatesDiv.style.display = 'none';
      return;
    }

    selectedDatesDiv.style.display = 'block';
    selectedCount.textContent = this.selectedDates.size;
    selectedList.innerHTML = '';

    const sortedDates = Array.from(this.selectedDates).sort();

    sortedDates.forEach(dateStr => {
      const date = new Date(dateStr);
      const tag = document.createElement('div');
      tag.className = 'selected-date-tag';
      tag.innerHTML = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' <span class="remove" data-date="' + dateStr + '">×</span>';
      
      tag.querySelector('.remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectedDates.delete(dateStr);
        this.renderCalendar();
        this.updateBookButtonState();
      });

      selectedList.appendChild(tag);
    });
  }

  updateBookButtonState() {
    const bookBtn = document.getElementById('bookAllBtn');
    bookBtn.disabled = this.selectedDates.size === 0 || this.bookingInProgress;
  }

  async bookAllSelectedDates() {
    if (this.bookingInProgress || this.selectedDates.size === 0) {
      return;
    }

    if (!this.authToken) {
      alert('Please authenticate first');
      await this.checkAuthentication();
      return;
    }

    this.bookingInProgress = true;
    this.updateBookButtonState();

    const progressSection = document.getElementById('progressSection');
    const progressText = document.getElementById('progressText');
    const bookingProgressDetails = document.getElementById('bookingProgressDetails');
    const resultsSection = document.getElementById('resultsSection');
    const resultCard = document.getElementById('resultCard');
    const resultTitle = document.getElementById('resultTitle');
    const resultDetails = document.getElementById('resultDetails');
    const reminderSection = document.getElementById('reminderSection');

    progressSection.style.display = 'block';
    resultsSection.style.display = 'none';
    reminderSection.style.display = 'none';
    bookingProgressDetails.innerHTML = '';

    const dates = Array.from(this.selectedDates).sort();
    const skipSundays = document.getElementById('skipSundays').checked;
    const weekdayStart = document.getElementById('weekdayStart').value;
    const weekdayEnd = document.getElementById('weekdayEnd').value;
    const saturdayStart = document.getElementById('saturdayStart').value;
    const saturdayEnd = document.getElementById('saturdayEnd').value;

    let successful = 0;
    let failed = 0;
    const failedDates = [];
    const successfulDates = [];
    const bookingDetails = [];
    const alreadyBookedDates = [];

    const datesToBook = dates.filter(dateStr => {
      if (skipSundays) {
        const date = new Date(dateStr);
        if (date.getDay() === 0) {
          return false;
        }
      }

      if (this.bookedDates.has(dateStr)) {
        alreadyBookedDates.push(dateStr);
        return false;
      }

      return true;
    });

    for (let i = 0; i < datesToBook.length; i++) {
      const dateStr = datesToBook[i];
      const date = new Date(dateStr);
      const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      progressText.textContent = `Booking ${i + 1} of ${datesToBook.length}: ${formattedDate}`;

      try {
        const success = await this.makeBooking(date, weekdayStart, weekdayEnd, saturdayStart, saturdayEnd);
        if (success) {
          successful++;
          successfulDates.push(dateStr);
          bookingDetails.push({ date: dateStr, formattedDate, status: 'success' });
          this.addBookingProgressItem(formattedDate, 'success', bookingProgressDetails);
        } else {
          failed++;
          failedDates.push(dateStr);
          bookingDetails.push({ date: dateStr, formattedDate, status: 'error' });
          this.addBookingProgressItem(formattedDate, 'error', bookingProgressDetails);
        }
      } catch (error) {
        failed++;
        failedDates.push(dateStr);
        bookingDetails.push({ date: dateStr, formattedDate, status: 'error' });
        this.addBookingProgressItem(formattedDate, 'error', bookingProgressDetails);
        console.error('Error booking ' + dateStr + ':', error);
      }

      if (i < datesToBook.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    progressSection.style.display = 'none';
    resultsSection.style.display = 'block';

    if (failed === 0) {
      resultCard.className = 'result-card success';
      resultTitle.textContent = '✓ All Bookings Successful!';
      let detailsHtml = `<p class="success-item">Successfully booked ${successful} desk(s)</p><p>All new selected dates have been booked successfully.</p>`;
      if (alreadyBookedDates.length > 0) {
        detailsHtml += `<p><strong>Skipped (already booked):</strong></p><ul>${alreadyBookedDates.map(d => `<li>${d}</li>`).join('')}</ul>`;
      }
      resultDetails.innerHTML = detailsHtml;
      reminderSection.style.display = 'block';
      this.successfulBookings = successfulDates;
    } else if (successful === 0) {
      resultCard.className = 'result-card error';
      resultTitle.textContent = '✗ All Bookings Failed';
      resultDetails.innerHTML = `<p class="error-item">Failed to book ${failed} desk(s)</p><p><strong>Failed dates:</strong></p><ul>${failedDates.map(d => `<li>${d}</li>`).join('')}</ul>`;
      reminderSection.style.display = 'none';
    } else {
      resultCard.className = 'result-card error';
      resultTitle.textContent = '⚠ Partial Success';
      let detailsHtml = `<p class="success-item">Successfully booked: ${successful}</p><p class="error-item">Failed: ${failed}</p>`;
      if (failedDates.length > 0) {
        detailsHtml += `<p><strong>Failed dates:</strong></p><ul>${failedDates.map(d => `<li>${d}</li>`).join('')}</ul>`;
      }
      if (alreadyBookedDates.length > 0) {
        detailsHtml += `<p><strong>Skipped (already booked):</strong></p><ul>${alreadyBookedDates.map(d => `<li>${d}</li>`).join('')}</ul>`;
      }
      resultDetails.innerHTML = detailsHtml;
      if (successful > 0) {
        reminderSection.style.display = 'block';
        this.successfulBookings = successfulDates;
      }
    }

    this.bookingInProgress = false;
    this.updateBookButtonState();

    // Persist successful bookings to storage so we can avoid rebooking and power reminders
    if (successfulDates.length > 0) {
      try {
        const location = this.location || this.getDefaultLocation();
        const stored = await chrome.storage.local.get(['weworkBookings']);
        const existingBookings = stored.weworkBookings || [];
        const existingDates = new Set(existingBookings.map((b) => b.date));

        const newBookings = successfulDates
          .filter((dateStr) => !existingDates.has(dateStr))
          .map((dateStr) => ({
            date: dateStr,
            locationId: location.locationId,
            spaceId: location.spaceId,
            weworkSpaceId: location.weworkSpaceId,
            locationName: location.name,
          }));

        if (newBookings.length > 0) {
          const allBookings = existingBookings.concat(newBookings);
          await chrome.storage.local.set({ weworkBookings: allBookings });
          newBookings.forEach((b) => this.bookedDates.add(b.date));
        }
      } catch (e) {
        console.error('Failed to save bookings to storage:', e);
      }
    }
  }

  addBookingProgressItem(formattedDate, status, container) {
    const item = document.createElement('div');
    item.className = `booking-item ${status}`;
    const icon = status === 'success' ? '✓' : '✗';
    item.innerHTML = `<span>${formattedDate}</span><span>${icon}</span>`;
    container.appendChild(item);
    container.scrollTop = container.scrollHeight;
  }

  async makeBooking(date, weekdayStart, weekdayEnd, saturdayStart, saturdayEnd) {
    const isSaturday = date.getDay() === 5;
    const startTime = isSaturday ? saturdayStart : weekdayStart;
    const endTime = isSaturday ? saturdayEnd : weekdayEnd;

    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);

    const startIST = new Date(date);
    startIST.setHours(startHour, startMin, 0, 0);
    const startUTC = new Date(startIST.getTime() - (5.5 * 60 * 60 * 1000));

    const endIST = new Date(date);
    endIST.setHours(endHour, endMin, 0, 0);
    const endUTC = new Date(endIST.getTime() - (5.5 * 60 * 60 * 1000));

    const location = this.location || this.getDefaultLocation();

    const payload = {
      "ApplicationType": "WorkplaceOne",
      "PlatformType": "WEB",
      "SpaceType": 4,
      "ReservationID": "",
      "TriggerCalendarEvent": true,
      "Notes": null,
      "MailData": {
        "dayFormatted": this.formatDayString(date),
        "startTimeFormatted": this.formatTime12Hour(startTime),
        "endTimeFormatted": this.formatTime12Hour(endTime),
        "floorAddress": "",
        "locationAddress": location.mailData.locationAddress,
        "creditsUsed": "0",
        "Capacity": "1",
        "TimezoneUsed": "GMT +05:30",
        "TimezoneIana": "Asia/Kolkata",
        "TimezoneWin": "India Standard Time",
        "startDateTime": this.formatDate(date) + ' ' + startTime,
        "endDateTime": this.formatDate(date) + ' ' + endTime,
        "locationName": location.mailData.locationName,
        "locationCity": location.mailData.locationCity,
        "locationCountry": location.mailData.locationCountry,
        "locationState": location.mailData.locationState,
      },
      "LocationType": 3,
      "UTCOffset": "+05:30",
      "CreditRatio": 1000,
      "LocationID": location.locationId,
      "SpaceID": location.spaceId,
      "WeWorkSpaceID": location.weworkSpaceId,
      "StartTime": startUTC.toISOString(),
      "EndTime": endUTC.toISOString(),
    };

    try {
      const response = await fetch('https://members.wework.com/workplaceone/api/common-booking/', {
        method: 'POST',
        headers: {
          ...this.getDefaultHeaders(),
          "authorization": "bearer " + this.authToken,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error('Booking request failed with status:', response.status);
        return false;
      }

      // Treat an OK response as success to avoid "false failure" cases
      // where the upcoming‑bookings API is briefly out of sync but the
      // reservation (and email) are actually created.
      // We still try to confirm in the background for logging only.
      this.confirmBookingOnServer(date).then((confirmed) => {
        if (!confirmed) {
          console.warn(
            'Booking API returned OK but booking not yet visible in upcoming‑bookings for date',
            this.formatDate(date)
          );
        }
      }).catch((e) => {
        console.error('Error while confirming booking on server (non‑fatal):', e);
      });

      return true;
    } catch (error) {
      console.error('Booking error:', error);
      return false;
    }
  }

  formatDayString(date) {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 
                        'July', 'August', 'September', 'October', 'November', 'December'];
    
    const dayName = dayNames[date.getDay()];
    const monthName = monthNames[date.getMonth()];
    const dayNum = date.getDate();
    
    let suffix = 'th';
    if (dayNum % 10 === 1 && dayNum % 100 !== 11) suffix = 'st';
    else if (dayNum % 10 === 2 && dayNum % 100 !== 12) suffix = 'nd';
    else if (dayNum % 10 === 3 && dayNum % 100 !== 13) suffix = 'rd';
    
    return dayName + ', ' + monthName + ' ' + dayNum + suffix;
  }

  formatTime12Hour(time24) {
    const [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return hours12 + ':' + minutes.toString().padStart(2, '0') + ' ' + period;
  }

  async setReminder() {
    if (!this.successfulBookings || this.successfulBookings.length === 0) {
      return;
    }

    const selectedDays = document.querySelector('input[name="reminderDays"]:checked');
    if (!selectedDays) {
      alert('Please select reminder days');
      return;
    }

    const daysBefore = parseInt(selectedDays.value);
    const location = this.location || this.getDefaultLocation();

    // Request notification permission
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    if (Notification.permission !== 'granted') {
      alert('Please enable notifications to set reminders');
      return;
    }

    // Calculate reminder dates and set alarms
    const reminders = [];
    for (const dateStr of this.successfulBookings) {
      const bookingDate = new Date(dateStr);
      const reminderDate = new Date(bookingDate);
      reminderDate.setDate(reminderDate.getDate() - daysBefore);
      reminderDate.setHours(9, 0, 0, 0); // 9 AM reminder

      // Only set reminder if it's in the future
      if (reminderDate > new Date()) {
        const alarmName = `wework-reminder-${dateStr}-${daysBefore}`;
        const alarmTime = reminderDate.getTime();

        // Store reminder info
        reminders.push({
          bookingDate: dateStr,
          reminderDate: reminderDate.toISOString(),
          daysBefore,
          alarmName
        });

        // Set Chrome alarm
        chrome.alarms.create(alarmName, {
          when: alarmTime
        });
      }
    }

    // Save reminders to storage
    try {
      const existingReminders = await chrome.storage.local.get(['weworkReminders']);
      const allReminders = existingReminders.weworkReminders || [];
      allReminders.push(...reminders);
      await chrome.storage.local.set({ weworkReminders: allReminders });
    } catch (e) {
      console.error('Failed to save reminders:', e);
    }

    // Show success message
    const setReminderBtn = document.getElementById('setReminderBtn');
    const originalText = setReminderBtn.textContent;
    setReminderBtn.textContent = '✓ Reminder Set!';
    setReminderBtn.disabled = true;
    setReminderBtn.style.background = '#4caf50';

    // Show notification immediately
    if (Notification.permission === 'granted') {
      new Notification('WeWork Reminder Set', {
        body: `You'll be reminded ${daysBefore} day(s) before ${reminders.length} booking(s) expire`,
        icon: chrome.runtime.getURL('icons/48.png')
      });
    }

    setTimeout(() => {
      setReminderBtn.textContent = originalText;
      setReminderBtn.disabled = false;
      setReminderBtn.style.background = '';
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new WeWorkBookingExtension();
});
