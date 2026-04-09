# 🚌 Sri Narayana High School Bus Tracker

A modern, mobile-friendly React application for managing bus fleet expenses with real-time cloud sync.

## ✨ Features

- **Dual Storage System**: Automatic sync between localStorage (instant) and Firebase Firestore (cloud backup)
- **Offline Support**: Works without internet; syncs when connection is restored
- **Diesel Entry Management**: Track fuel consumption with mileage calculations
- **Maintenance Logs**: Record all maintenance work and costs
- **Route Tracking**: Monitor daily routes and fuel efficiency
- **Student Management**: Track student count per route
- **Admin Controls**: PIN-protected admin features
- **PDF Share**: Generate and share fuel bills via WhatsApp
- **Charts & Reports**: Visual expense tracking and fuel efficiency analysis
- **Firebase Integration**: Cloud backup for all data

## 🚀 Quick Start

### Logo file
- Place your new logo image in `public/logo.png`
- The app will load this image automatically in the header

### Get data.gov.in API Key for Diesel Prices

**Better Search Instructions:**

1. **Go to** [data.gov.in](https://data.gov.in/)

2. **Search for** "petrol diesel price" or "fuel price" in the search bar

3. **Look for datasets from** "Ministry of Petroleum and Natural Gas" or "PPAC"

4. **Common dataset names to look for:**
   - "Daily Petrol/Diesel Price"
   - "Retail Fuel Prices"
   - "State-wise Petrol and Diesel Prices"
   - "Fuel Price Data"

5. **Click on any dataset** that shows fuel prices by state (should include Telangana)

6. **Look for the API section** - it should show the Resource ID

7. **Click** "Request API Key" or "Get API Key"

8. **Sign up/Login** with your email

9. **Copy the API key** they provide

10. **Replace** `YOUR_API_KEY_HERE` in `src/components/BusTracker.jsx` with your actual key

**Alternative search terms:**
- Search for "PPAC" (Petroleum Planning & Analysis Cell)
- Look for datasets with "Telangana" in the title
- Try searching "diesel price telangana"

**Note:** The app now uses a simplified system that suggests current market prices between 90-100 rupees. You can still add the data.gov.in API key for real-time prices, but the app works perfectly with manual entry or the suggested market prices.

**Example:**
```javascript
const DATA_GOV_API_KEY = "your-actual-api-key-here";
```**Note:** The same RapidAPI key works for both the cities API and historical prices API. The app tries APIs in this order:
1. data.gov.in (if key provided)
2. RapidAPI Cities API (if key provided)
3. RapidAPI Historical API (if key provided, uses recent historical data)
4. Approximate Telangana prices (always available)
5. Last saved price (fallback)
6. Manual entry (always available)

### Prerequisites

### Installation (One-time setup)

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will open at `http://localhost:5173`

## 🔧 Setup Firebase (Optional but Recommended)

### Why Firebase?
- **Cloud Backup**: Your data is automatically backed up online
- **Multi-Device Sync**: Access data from multiple devices
- **Reliability**: No data loss from browser cache clearing

### Steps to Setup Firebase

1. **Create Firebase Project**
   - Go to [Firebase Console](https://console.firebase.google.com)
   - Click "Add Project"
   - Enter project name: "snhs-bus-tracker"
   - Continue through the setup

2. **Enable Firestore Database**
   - In Firebase Console, go to "Firestore Database"
   - Click "Create Database"
   - Choose "Start in test mode" (can change security later)
   - Select a location near your school

3. **Get Firebase Config**
   - Go to Project Settings (gear icon)
   - Copy the config under "Your apps"
   - Look for the web config object

4. **Update Firebase Config**
   - Open: `src/config/firebase.js`
   - Replace the placeholder values:
   ```javascript
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",              // from Firebase config
     authDomain: "YOUR_AUTH_DOMAIN",      // from Firebase config
     projectId: "YOUR_PROJECT_ID",        // from Firebase config
     storageBucket: "YOUR_STORAGE_BUCKET", // from Firebase config
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID", // from Firebase config
     appId: "YOUR_APP_ID"                 // from Firebase config
   };
   ```

5. **Test Connection**
   - Restart the dev server: `npm run dev`
   - Add a diesel entry
   - Check Firebase Console > Firestore > app_data collection
   - You should see your entry there!

## 📱 Usage

### First Time
1. **Set Daily KM Settings** (Fuel Plan tab)
   - Enter daily KM each bus travels
   - This helps predict next fuel dates

2. **Add Diesel Entries** (Diesel tab)
   - Bus and fuel amount (auto-fetches current price for Telangana)
   - KM readings for mileage calculation
   - Take a photo of fuel receipt

### Use on Another Computer
1. Copy the full project folder to the other computer.
2. Open a terminal in that folder.
3. Run:
   ```bash
   npm install
   ```
4. After dependencies install, run:
   ```bash
   npm run dev
   ```
5. Open the browser URL shown by Vite (usually `http://localhost:5173`).
6. If the app loads, your second computer is ready.

### Make it a permanent install on that system
1. In the project folder, build the production version:
   ```bash
   npm run build
   ```
2. The build output appears in `dist/`.
3. Serve `dist/` with any static web server or host it on a website.
4. The app is then available from that hosted URL.

### Install on Mobile for Drivers
1. Open the app URL in a phone browser (Chrome, Edge, or Safari).
2. On Android:
   - tap the browser menu
   - choose **Add to Home screen**
   - follow the prompts to add the shortcut
3. On iPhone:
   - tap the Share button
   - choose **Add to Home Screen**
   - confirm the name and add it
4. Open the app from the phone home screen like a normal app.
5. The app stores data in the browser and works offline.
6. If Firebase is configured, data will sync when the phone reconnects to the internet.

### Deploy to Firebase Hosting
1. Install Firebase CLI (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```
2. Sign in to Firebase with your Google account:
   ```bash
   firebase login
   ```
3. Initialize hosting in the project folder:
   ```bash
   firebase init hosting
   ```
   - Select your Firebase project
   - Choose `dist` as the public directory
   - Configure as a single-page app? **Yes**
   - Do not overwrite `index.html` if asked
4. Build the app for production:
   ```bash
   npm run build
   ```
5. Deploy the `dist/` folder to Firebase Hosting:
   ```bash
   firebase deploy --only hosting
   ```
6. After deployment, Firebase gives you a public URL.
7. Open that URL on any computer or mobile phone.
8. Drivers can then install it from the mobile browser using **Add to Home screen**.

### Notes
- If Firebase is configured in `src/config/firebase.js`, data can sync across devices.
- If Firebase is not configured, the app still works locally on each device using browser storage.
- For mobile use, the public Firebase Hosting URL is the easiest shared access method.

3. **View Dashboard**
   - See total spending and bus-wise summary
   - Get fuel alerts for buses running low on reserve

### Admin Features (PIN: 1234)
- Access Admin Panel via "Admin Login" button
- Change PIN to custom 4-digit code
- Delete entries (staff cannot)
- Lock admin mode when done

### Export Reports
- Go to Reports tab
- Click "Download CSV Report" 
- Opens in Excel/Google Sheets for analysis

## 🏗️ Project Structure

```
src/
├── components/
│   └── BusTracker.jsx       # Main app component
├── config/
│   ├── firebase.js          # Firebase initialization
│   └── storage.js           # Dual storage system
├── App.jsx                   # App entry point
├── App.css                   # Global styles
└── main.jsx                  # React DOM render
```

## 💾 Data Storage

### localStorage
- **Pros**: Instant, no setup needed, works offline
- **Cons**: Limited to ~5-10MB, lost if cache is cleared
- **Used for**: Real-time app responsiveness

### Firebase Firestore
- **Pros**: Unlimited storage, secure, multi-device sync, backup
- **Cons**: Requires setup, costs after free tier
- **Used for**: Cloud backup and reliability

**How It Works**: When you save data, it's instantly saved to localStorage AND (if Firebase is configured) also saved to Firestore. When loading, localStorage is checked first (faster), then Firestore syncs any cloud data.

## 🔐 Default Credentials

- **Admin PIN**: `1234` (change this in Admin Panel!)
- **Default Buses**: TS25T7838, TG25T0545, TS25T7840, TS25T8070, TG25T0215

## 📊 Features by Tab

| Tab | Features |
|-----|----------|
| **Dashboard** | Total spending, fuel alerts, bus summaries |
| **Diesel** | Add entries, auto-price fetch, mileage tracking |
| **Maintenance** | Record repairs, costs, maintenance history |
| **Other** | Driver salary, permits, fees, toll charges |
| **Routes** | Track daily routes, KM per route |
| **Students** | Student count per route, village coverage |
| **Fuel Plan** | Set daily KM, define holidays, fuel predictions |
| **Reports** | Charts, export CSV, fuel efficiency analysis |

## 🐛 Troubleshooting

### Data not syncing with Firebase?
- Check Firebase config in `src/config/firebase.js`
- Firestore requires test mode rules initially
- No errors = localStorage is still working fine

### Price fetch not working?
- Internet connection issue
- India-specific (Telangana diesel prices)
- Fallback: Enter price manually

### App running slow?
- Too many entries in localStorage
- Export to CSV and clear old entries

## 📞 Support

This is a custom app for Sri Narayana High School. For issues:
1. Check the Troubleshooting section above
2. Verify Firebase config (if using cloud)
3. Try clearing browser cache and restarting

## 📄 License

Internal use only for Sri Narayana High School

---

**Happy tracking! 🚌✨**
