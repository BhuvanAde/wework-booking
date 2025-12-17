// Calendar and booking functionality
class WeWorkBookingExtension {
  constructor() {
    this.selectedDates = new Set();
    this.currentDate = new Date();
    this.authToken = null;
    this.bookingInProgress = false;
    this.init();
  }

  async init() {
    await this.checkAuthentication();
    this.setupEventListeners();
    this.renderCalendar();
    
    // Listen for token updates from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'tokenCaptured') {
        this.checkAuthentication();
      }
    });
  }

  async checkAuthentication() {
    const authStatus = document.getElementById('authStatus');
    const statusIndicator = document.getElementById('statusIndicator');
    const authText = document.getElementById('authText');
    const loginSection = document.getElementById('loginSection');
    const bookingSection = document.getElementById('bookingSection');

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
        return;
      }

      // Not authenticated
      statusIndicator.className = 'status-indicator error';
      authText.textContent = 'Not authenticated';
      loginSection.style.display = 'block';
      bookingSection.style.display = 'none';
    } catch (error) {
      console.error('Auth check error:', error);
      statusIndicator.className = 'status-indicator error';
      authText.textContent = 'Error checking authentication';
      loginSection.style.display = 'block';
      bookingSection.style.display = 'none';
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

    document.getElementById('skipSundays').addEventListener('change', () => {
      this.renderCalendar();
    });
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
      const skipSundays = document.getElementById('skipSundays').checked;

      const dayElement = document.createElement('div');
      dayElement.className = 'calendar-day';
      dayElement.textContent = day;

      if (isPast) {
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
    return date.toISOString().split('T')[0];
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
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const resultsSection = document.getElementById('resultsSection');
    const resultCard = document.getElementById('resultCard');
    const resultTitle = document.getElementById('resultTitle');
    const resultDetails = document.getElementById('resultDetails');

    progressSection.style.display = 'block';
    resultsSection.style.display = 'none';

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

    const datesToBook = dates.filter(dateStr => {
      if (skipSundays) {
        const date = new Date(dateStr);
        return date.getDay() !== 0;
      }
      return true;
    });

    for (let i = 0; i < datesToBook.length; i++) {
      const dateStr = datesToBook[i];
      const date = new Date(dateStr);

      const progress = ((i + 1) / datesToBook.length) * 100;
      progressFill.style.width = progress + '%';
      progressText.textContent = 'Booking ' + (i + 1) + ' of ' + datesToBook.length + ': ' + dateStr;

      try {
        const success = await this.makeBooking(date, weekdayStart, weekdayEnd, saturdayStart, saturdayEnd);
        if (success) {
          successful++;
          successfulDates.push(dateStr);
        } else {
          failed++;
          failedDates.push(dateStr);
        }
      } catch (error) {
        failed++;
        failedDates.push(dateStr);
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
      resultDetails.innerHTML = '<p class="success-item">Successfully booked ' + successful + ' desk(s)</p><p>All selected dates have been booked successfully.</p>';
    } else if (successful === 0) {
      resultCard.className = 'result-card error';
      resultTitle.textContent = '✗ All Bookings Failed';
      resultDetails.innerHTML = '<p class="error-item">Failed to book ' + failed + ' desk(s)</p><p><strong>Failed dates:</strong></p><ul>' + failedDates.map(d => '<li>' + d + '</li>').join('') + '</ul>';
    } else {
      resultCard.className = 'result-card error';
      resultTitle.textContent = '⚠ Partial Success';
      resultDetails.innerHTML = '<p class="success-item">Successfully booked: ' + successful + '</p><p class="error-item">Failed: ' + failed + '</p><p><strong>Failed dates:</strong></p><ul>' + failedDates.map(d => '<li>' + d + '</li>').join('') + '</ul>';
    }

    this.bookingInProgress = false;
    this.updateBookButtonState();
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
        "locationAddress": "RMZ Latitude Commercial, 10th floor, Bellary Rd",
        "creditsUsed": "0",
        "Capacity": "1",
        "TimezoneUsed": "GMT +05:30",
        "TimezoneIana": "Asia/Kolkata",
        "TimezoneWin": "India Standard Time",
        "startDateTime": this.formatDate(date) + ' ' + startTime,
        "endDateTime": this.formatDate(date) + ' ' + endTime,
        "locationName": "RMZ Latitude Commercial",
        "locationCity": "Bengaluru",
        "locationCountry": "IND",
        "locationState": "KA",
      },
      "LocationType": 3,
      "UTCOffset": "+05:30",
      "CreditRatio": 1000,
      "LocationID": "ffe4017e-e45d-4c8c-b6cc-261a980583d0",
      "SpaceID": "147",
      "WeWorkSpaceID": "58f4a184-4a5d-11e8-b18d-0ac77f0f6524",
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

      return response.status === 200;
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
}

document.addEventListener('DOMContentLoaded', () => {
  new WeWorkBookingExtension();
});
