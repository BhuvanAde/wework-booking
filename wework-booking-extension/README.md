# WeWork Desk Booking Chrome Extension

A Chrome extension that allows you to bulk book WeWork desk spaces with an intuitive calendar interface.

## Features

- 📅 **Calendar Interface**: Select multiple dates from a visual calendar
- 🔐 **Automatic Authentication**: Automatically captures your WeWork bearer token
- ⚡ **Bulk Booking**: Book all selected dates with one click
- ⏰ **Customizable Times**: Set different booking times for weekdays and Saturdays
- 🚫 **Skip Sundays**: Option to automatically skip Sundays
- ✅ **Success/Error States**: Clear feedback on booking results
- 🎨 **Modern UI**: Beautiful, user-friendly interface

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the `wework-booking-extension` directory

## Usage

1. **Authenticate**:
   - Visit [members.wework.com](https://members.wework.com) and log in
   - The extension will automatically capture your authentication token
   - Or click "Open WeWork" in the extension to log in

2. **Select Dates**:
   - Open the extension popup
   - Navigate through months using the arrow buttons
   - Click on dates to select/deselect them
   - Use "Select All" to select all visible dates in the current month
   - Use "Clear" to deselect all dates

3. **Configure Booking Times**:
   - Set weekday start/end times (default: 8 AM - 8 PM IST)
   - Set Saturday start/end times (default: 10 AM - 4 PM IST)
   - Toggle "Skip Sundays" if you don't want to book Sundays

4. **Book All**:
   - Click "Book All Selected Dates"
   - Watch the progress bar
   - View results showing successful and failed bookings

## Configuration

The extension uses the following default settings:
- **Location**: RMZ Latitude Commercial, Bengaluru
- **Space ID**: 147
- **Location ID**: ffe4017e-e45d-4c8c-b6cc-261a980583d0
- **WeWork Space ID**: 58f4a184-4a5d-11e8-b18d-0ac77f0f6524

To change these, edit the `makeBooking` method in `popup.js`.

## Permissions

The extension requires:
- **Storage**: To save authentication tokens
- **Web Request**: To intercept and capture authentication tokens
- **Tabs**: To open WeWork login page
- **Host Permissions**: Access to members.wework.com

## Privacy

- All authentication tokens are stored locally in your browser
- No data is sent to external servers
- All API calls are made directly to WeWork's servers

## Troubleshooting

**Token not captured?**
- Make sure you're logged into members.wework.com
- Try clicking "Refresh Token" in the extension
- Visit members.wework.com in a new tab and log in again

**Bookings failing?**
- Check that your token is valid (should show "Authenticated" status)
- Verify the dates you're selecting are in the future
- Ensure you have booking credits/permissions for the location

## Development

Files structure:
- `manifest.json`: Extension configuration
- `popup.html`: Main UI
- `popup.css`: Styling
- `popup.js`: Main logic and calendar
- `background.js`: Token capture service worker
- `content.js`: Content script for token extraction

## License

MIT License
