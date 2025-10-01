const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ===== MongoDB Connection =====
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.error(err));

// ===== Schema & Model =====
const locationSchema = new mongoose.Schema({
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
    const location = new Location(req.body);
    await location.save();

    // Emit new location to all connected clients
    io.emit("newLocation", location);

    res.status(200).json({ message: "Location saved!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Web Dashboard =====
app.get("/", async (req, res) => {
  const locations = await Location.find().sort({ createdAt: -1 }).limit(10);
  const latest = locations[0] || { latitude: 0, longitude: 0, timestamp: "No data" };

  let html = `
  <html>
  <head>
    <title>SafeButton Tracker</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; }
      h2 { color: #2c3e50; }
      table { border-collapse: collapse; width: 100%; margin-top: 20px; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
      th { background: #2c3e50; color: white; }
      #map { height: 400px; width: 100%; margin-top: 20px; }
    </style>
  </head>
  <body>
    <h2>📍 SafeButton Tracker</h2>
    <p><b>Last Location:</b> ${latest.latitude}, ${latest.longitude} at ${latest.timestamp}</p>
    <div id="map"></div>
    <h3>Recent Logs</h3>
    <table>
      <tr><th>Latitude</th><th>Longitude</th><th>Timestamp</th></tr>`;

  locations.forEach(loc => {
    html += `<tr><td>${loc.latitude}</td><td>${loc.longitude}</td><td>${loc.timestamp}</td></tr>`;
  });

  html += `
    </table>
    <script src="/socket.io/socket.io.js"></script>
    <script>
      let map;
      let marker;

      function initMap() {
        const initialPos = { lat: ${latest.latitude}, lng: ${latest.longitude} };
        map = new google.maps.Map(document.getElementById("map"), {
          zoom: 15,
          center: initialPos
        });
        marker = new google.maps.Marker({ position: initialPos, map: map });
      }

      const socket = io();
      socket.on("newLocation", loc => {
        const pos = { lat: loc.latitude, lng: loc.longitude };
        map.setCenter(pos);
        marker.setPosition(pos);

        // Optional: add new marker for each location instead of moving
        // new google.maps.Marker({ position: pos, map: map });
      });
    </script>
    <script async defer
      src="https://maps.googleapis.com/maps/api/js?key=AIzaSyAcIDwkkaJuZ5f9xPhYWz1zjuajEF4J48o&callback=initMap">
    </script>
  </body>
  </html>`;

  res.send(html);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
