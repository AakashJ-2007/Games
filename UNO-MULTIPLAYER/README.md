# UNO Multiplayer Web Game

A responsive, real-time multiplayer UNO card game built with Vanilla JavaScript, HTML5, CSS3, and Firebase (Authentication & Realtime Database). Deployable directly onto **GitHub Pages** without requiring a Node.js server.

---

## Features

- **Real-Time Multiplayer:** Instant synchronization for 2–4 players.
- **Full UNO Rules:**
  - Standard deck generation (108 cards).
  - Number cards (0–9), Action cards (Skip, Reverse, Draw Two), and Wild cards (Wild, Wild Draw Four).
  - Turn rotation, direction reversal, and dynamic deck reshuffling when empty.
  - Interactive UNO call system & Catch UNO penalty (+2 cards).
- **Responsive Design:** Optimized for mobile phones (375px+), tablets, and desktops (1920x1080).
- **Embedded Web Audio Synthesizer:** Zero missing-audio dependencies or playback errors.
- **Resilient Room Architecture:** Handles host migration and player disconnects seamlessly.

---

## 1. Firebase Setup Guide (Step-by-Step)

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project**, name it `uno-multiplayer`, and disable Google Analytics (optional).
3. Click the **Web (</>)** icon to register a web app:
   - App nickname: `uno-web`
   - Click **Register App**.
4. Enable **Anonymous Authentication**:
   - In the left sidebar, navigate to **Build > Authentication**.
   - Click **Get Started**, go to the **Sign-in method** tab.
   - Select **Anonymous**, enable the toggle, and click **Save**.
5. Create the **Realtime Database**:
   - In the left sidebar, navigate to **Build > Realtime Database**.
   - Click **Create Database**, select a region close to you, and choose **Start in test mode**.
6. Apply Database Security Rules:
   - Go to the **Rules** tab in Realtime Database.
   - Paste the contents of `database.rules.json` and click **Publish**.
7. Link Your Project:
   - Open `firebase-config.js` in your code editor.
   - Replace the placeholder strings with your actual Firebase configuration keys from your Firebase Project Settings.

---

## 2. Local Testing Instructions

You can run the game locally using any static file server:

### Option A: VS Code Live Server
1. Install the **Live Server** extension in Visual Studio Code.
2. Right-click `index.html` and select **Open with Live Server**.

### Option B: Python Simple HTTP Server
Open your terminal in the project directory:
```bash
# Python 3
python -m http.server 8000