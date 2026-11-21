# Medimate
MediMate helps people take the right medicine at the right time, understand what is on their labels, and keep family informed. It is built as a full-stack web app with no framework dependencies.
A comprehensive, fullstack medicine management and health companion application built with:
- **Frontend**: Responsive Single-Page Application (`public/index.html` / `2_0.html`)
- **Backend**: Native Node.js HTTP REST API Server (`server.js`)
- **Database**: Native SQLite 3 Database with WAL mode (`medimate.db` via `node:sqlite`)
- **Port**: `http://localhost:3000`

---

## 🚀 Quick Start

### Option 1: Double-click `start.bat`
Located in `Desktop/medimate-app/start.bat`. This automatically starts the backend server on `http://localhost:3000` and launches your default browser.

### Option 2: Command Line
```powershell
cd C:\Users\asus\Desktop\medimate-app
& "C:\Users\asus\AppData\Roaming\Antigravity\bin\agy-node.cmd" server.js
```
Then visit: [http://localhost:3000](http://localhost:3000)

---

## 📂 Project Architecture

```
Desktop/
├── 2_0.html                         <- Fullstack-enabled standalone frontend
└── medimate-app/
    ├── server.js                    <- HTTP server and REST API router
    ├── db.js                        <- SQLite schema & data access layer
    ├── medimate.db                  <- Persistent SQLite database file
    ├── start.bat                    <- 1-click launcher
    ├── package.json                 <- Project metadata
    ├── README.md                    <- Documentation
    └── public/
        └── index.html               <- Served web app (enhanced from 2_0.html)
```

---

## 🗄️ Database Schema (`medimate.db`)

The application uses native SQLite 3 (`DatabaseSync` from `node:sqlite`) with WAL (Write-Ahead Logging) mode for reliability and speed:

1. **`meds`**: Medication catalogue (id, name, dose, form, per_dose, times, start_date, end_date, stock, notes, color)
2. **`dose_logs`**: Recorded medication doses (key `date|medId|time`, status, taken_at timestamp)
3. **`doctor_questions`**: Questions for your doctor visit report
4. **`blood_donors`**: Blood circle directory (name, blood group, area, phone, last donation)
5. **`care_circle`**: Family and caregiver emergency circle
6. **`care_alerts`**: Scheduled and triggered missed dose alerts
7. **`care_acks`**: Caregiver acknowledgements
8. **`verified_checks`**: Safety verification states
9. **`app_settings`**: User profile & audio preferences
10. **`app_meta`**: App metadata (terms agreement, schema version)

---

## 🔌 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server uptime & SQLite database statistics |
| `GET` | `/api/state` | Returns the entire unified application state |
| `POST` | `/api/sync` | Atomically saves/synchronizes full state to SQLite |
| `GET` | `/api/meds` | Retrieve all active medications |
| `POST` | `/api/meds` | Add or update a medication |
| `DELETE` | `/api/meds/:id` | Remove a medication and its dose history |
| `POST` | `/api/logs` | Log a dose as taken, skipped, or missed |
| `DELETE` | `/api/logs/:key` | Undo a recorded dose and restore stock |
| `GET` | `/api/questions` | List questions saved for doctor report |
| `POST` | `/api/questions` | Save a new question for doctor report |
| `DELETE` | `/api/questions/:id` | Remove a question |
| `GET` | `/api/donors` | List blood donor contacts |
| `POST` | `/api/donors` | Register a blood donor |
| `DELETE` | `/api/donors/:id` | Remove a donor |
| `GET` | `/api/stats` | Aggregated metrics (adherence, streak, low stock) |
| `GET` | `/api/backup` | Download complete SQLite database as JSON |
| `POST` | `/api/restore` | Restore database from JSON backup |
| `POST` | `/api/seed` | Seed realistic demo dataset (sample medicines & 28-day adherence) |
| `POST` | `/api/wipe` | Cleanly clear all database records |

---

## ✨ Features Included

- **Today's Schedule & Pill Tracker**: Real-time clock, adherence streak calculation, audio and spoken reminders.
- **My Medicines**: Full inventory management with pill count tracking and refill warnings.
- **Doctor Report**: Exportable medical summary with adherence graphs and patient questions.
- **Label Scanner & OCR**: Built-in camera capture and image processing to decipher medication boxes.
- **Find & Check Tools**:
  - Compare prices across Indian online and retail pharmacies (1mg, PharmEasy, Netmeds, Apollo).
  - Generic drug alternative finder (salt composition lookup).
  - Red-flag urgency symptom checker.
  - Nearby hospitals search via OpenStreetMap.
  - Blood donor compatibility calculator and WhatsApp request generator.
- **Family & Caregiver Circle**: Simulated check-ins and missed dose alerts.
- **Automatic Offline-Online Sync**: Works offline seamlessly via browser cache and automatically commits to SQLite whenever connected.

