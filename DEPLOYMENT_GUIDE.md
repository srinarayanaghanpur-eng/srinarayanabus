# GitHub & Netlify Deployment Guide

## Step 1: Install Git
Download and install Git for Windows from: https://git-scm.com/download/win

## Step 2: Configure Git (after installation)
Open PowerShell as Administrator and run:
```powershell
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

## Step 3: Push to GitHub

### If starting a NEW repository:
```powershell
cd "C:\Users\Saves 11\Desktop\bus-tracker-app"

# Initialize if not already initialized
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Bus Tracker App with teacher login and performance optimizations"

# Add GitHub remote (replace YOUR_USERNAME and YOUR_REPO)
git remote add origin https://github.com/YOUR_USERNAME/bus-tracker-app.git

# Rename branch to main
git branch -M main

# Push to GitHub
git push -u origin main
```

### If repository already exists:
```powershell
cd "C:\Users\Saves 11\Desktop\bus-tracker-app"

# Check status
git status

# If you have uncommitted changes
git add .
git commit -m "Bug fixes: Teacher login persistence and performance optimizations"
git push
```

## Step 4: Deploy to Netlify

### Option A: Connect via Netlify UI (Easiest)
1. Go to https://netlify.com and sign up (free)
2. Click "New site from Git"
3. Choose GitHub
4. Authorize Netlify to access your GitHub
5. Select your `bus-tracker-app` repository
6. Build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
7. Click "Deploy site"

### Option B: Manual build & deploy
1. Run build locally:
```powershell
npm run build
```

2. Install Netlify CLI:
```powershell
npm install -g netlify-cli
```

3. Deploy:
```powershell
netlify deploy --prod --dir=dist
```

## Step 5: Set Environment Variables (if using Firebase in production)

1. In Netlify dashboard, go to **Site settings → Build & deploy → Environment**
2. Add any environment variables your app needs

## Firebase Hosting Alternative

If you prefer Firebase hosting instead:
```powershell
npm install -g firebase-tools
firebase login
firebase init
firebase deploy
```

## Troubleshooting

### "npm command not found"
- Install Node.js from https://nodejs.org/

### "git command not found"  
- Install Git from https://git-scm.com/

### Build fails
```powershell
# Clear cache and reinstall
rm -r node_modules package-lock.json
npm install
npm run build
```

## Your App Features for Production

✅ **Teacher Login System** - PIN-based authentication with attendance tracking
✅ **Bus Fleet Management** - Diesel, maintenance, and expense tracking  
✅ **Dual Storage** - LocalStorage + Firebase Firestore sync
✅ **Performance Optimized** - Memoized calculations prevent unnecessary renders
✅ **Responsive Design** - Works on desktop and mobile
✅ **Offline Support** - LocalStorage keeps data available offline

## Post-Deployment

After deploying:
1. Test the live app thoroughly
2. Check browser console for errors
3. Test Firebase sync (if connected)
4. Share your live URL: `https://your-subdomain.netlify.app`

---

Questions? Check:
- Netlify Docs: https://docs.netlify.com/
- GitHub Docs: https://docs.github.com/
- Firebase Hosting: https://firebase.google.com/docs/hosting
