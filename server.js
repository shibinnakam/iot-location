// server.js - SafeButton Tracker (Render-ready)
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Validate required env
if (!process.env.MONGO_URI) {
  console.error("ERROR: MONGO_URI is not set. Set it in environment variables.");
  process.exit(1);
}

// ===== MongoDB Connection =====
// Avoid deprecated options (driver v4+)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// ===== Schema & Model =====
const locationSchema = new mongoose.Schema({
  deviceId: { type: String, index: true },
  latitude: Number,
  longitude: Number,
  timestamp: String
}, { timestamps: true });

const Location = mongoose.model("Location", locationSchema);

// ===== HTTP Server + Socket.IO =====
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ===== API Route (ESP32 POSTs here) =====
app.post("/api/location", async (req, res) => {
  try {
    // Basic validation
    const { deviceId, latitude, longitude, timestamp } = req.body;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({ error: "Invalid latitude/longitude" });
    }

    console.log(`Received location from ${deviceId || 'unknown'}: ${latitude},${longitude}`);

    const location = new Location({ deviceId, latitude, longitude, timestamp });
    await location.save();

    // Emit new location to all connected clients
    io.emit("newLocation", location);

    res.status(200).json({ message: "Location saved!" });
  } catch (err) {
    console.error("POST /api/location error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Optional: recent locations endpoint
app.get("/api/locations/recent", async (req, res) => {
  const limit = Math.min(100, parseInt(req.query.limit || "10", 10));
  try {
    const docs = await Location.find().sort({ createdAt: -1 }).limit(limit).exec();
    res.json(docs);
  } catch (err) {
    console.error("GET /api/locations/recent error:", err);
    res.status(500).json({ error: "Failed to fetch locations" });
  }
});

// ===== Web Dashboard (single-file) =====
app.get("/", async (req, res) => {
  const locations = await Location.find().sort({ createdAt: -1 }).limit(10);
  const latest = locations[0] || { latitude: 0, longitude: 0, timestamp: "No data" };
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY || "";

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>SafeButton Tracker</title>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body { font-family: Arial, Helvetica, sans-serif; margin:20px; }
      h2 { color: #2c3e50; }
      #map { height: 60vh; width: 100%; margin-top: 10px; }
      table { border-collapse: collapse; width: 100%; margin-top: 12px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
      th { background: #2c3e50; color: white; }
      #events { max-height: 25vh; overflow:auto; margin-top:10px; }
    </style>
  </head>
  <body>
    <h2>📍 SafeButton Tracker</h2>
    <p><strong>Last Location:</strong> ${latest.latitude}, ${latest.longitude} at ${latest.timestamp}</p>
    <div id="map"></div>

    <h3>Recent Logs</h3>
    <div id="events">
      <table>
        <tr><th>Device</th><th>Latitude</th><th>Longitude</th><th>Timestamp</th><th>Received</th></tr>
        ${locations.map(l => `<tr>
          <td>${l.deviceId || ""}</td>
          <td>${l.latitude}</td>
          <td>${l.longitude}</td>
          <td>${l.timestamp || ""}</td>
          <td>${new Date(l.createdAt).toLocaleString()}</td>
        </tr>`).join('')}
      </table>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
      let map;
      let marker;

      function initMap() {
        const initial = { lat: ${latest.latitude}, lng: ${latest.longitude} };
        map = new google.maps.Map(document.getElementById("map"), {
          zoom: 15,
          center: initial
        });
        marker = new google.maps.Marker({ position: initial, map: map });
      }

      const socket = io();
      socket.on("newLocation", (loc) => {
        const pos = { lat: loc.latitude, lng: loc.longitude };
        if (!map) return;
        map.setCenter(pos);
        if (marker) marker.setPosition(pos);
        else marker = new google.maps.Marker({ position: pos, map: map });

        // prepend to table
        const table = document.querySelector('#events table');
        const row = document.createElement('tr');
        row.innerHTML = '<td>' + (loc.deviceId||'') + '</td>' +
                        '<td>' + loc.latitude + '</td>' +
                        '<td>' + loc.longitude + '</td>' +
                        '<td>' + (loc.timestamp||'') + '</td>' +
                        '<td>' + (new Date(loc.createdAt)).toLocaleString() + '</td>';
        if (table && table.firstChild) table.insertBefore(row, table.firstChild.nextSibling);
      });
    </script>

    <script async defer
      src="https://maps.googleapis.com/maps/api/js?key=${mapsKey}&callback=initMap">
    </script>
  </body>
  </html>`;

  res.send(html);
});

// Start server using PORT environment variable (Render provides it)
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
