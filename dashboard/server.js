require("dotenv").config({ path: require("node:path").resolve(__dirname, "../.env") });

const express = require("express");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.DASHBOARD_PORT || 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    name: "Sentinel Dashboard",
    status: "starter",
    connectedToBot: false,
    message: "Dashboard scaffold is running. Discord OAuth and bot/database integration are not configured yet."
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Sentinel dashboard starter listening on port ${PORT}`);
});
