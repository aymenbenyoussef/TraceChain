require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const QRCode = require("qrcode");
const swaggerUi = require("swagger-ui-express");
const { ethers } = require("ethers");
const { publicContract, contractFor, send } = require("./chain");
const { register, login, authenticate, requireRole } = require("./auth");

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET must be configured");

const app = express();
const port = Number(process.env.PORT || 3000);
const uploadsDir = path.join(__dirname, "uploads");
const indexed = { events: [], alerts: [] };
const upload = multer({ dest: uploadsDir, limits: { fileSize: 10 * 1024 * 1024 } });
app.use(cors());
app.use(express.json());
app.get("/health", (req, res) => res.json({ ok: true }));

function json(value) {
  return JSON.parse(JSON.stringify(value, (_, item) => (typeof item === "bigint" ? item.toString() : item)));
}

function lotInput(body) {
  return {
    lotId: body.lotId,
    productType: body.productType,
    quantity: body.quantity,
    unit: body.unit,
    origin: body.origin,
    expiresAt: body.expiresAt || 0,
    dataHash: body.dataHash || "",
    uri: body.uri || "",
  };
}

async function run(req, res, method, args) {
  try {
    res.json(await send(contractFor(req.user.privateKey), method, args));
  } catch (error) {
    res.status(400).json({ error: error.shortMessage || error.reason || error.message });
  }
}

app.post("/auth/register", async (req, res) => {
  try {
    const user = await register(req.body);
    res.status(201).json({ user: { userId: user.userId, email: user.email, orgId: user.orgId, role: user.role } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
app.post("/auth/login", async (req, res) => {
  try {
    res.json(await login(req.body.email, req.body.password));
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.post("/lots", authenticate, requireRole("PRODUCER"), (req, res) =>
  run(req, res, "createLot", [lotInput(req.body)])
);
app.post("/lots/transform", authenticate, requireRole("PROCESSOR"), (req, res) =>
  run(req, res, "transformLots", [req.body.inputIds, lotInput(req.body)])
);
app.post("/lots/:id/ship", authenticate, (req, res) =>
  run(req, res, "shipLot", [req.params.id, req.body.to, req.body.tempX10 ?? -32768, req.body.dataHash || "", req.body.uri || ""])
);
app.post("/lots/:id/transport", authenticate, requireRole("TRANSPORTER"), (req, res) =>
  run(req, res, "logTransport", [req.params.id, req.body.tempX10 ?? -32768, req.body.dataHash || "", req.body.uri || ""])
);
app.post("/lots/:id/receive", authenticate, (req, res) =>
  run(req, res, "confirmReception", [req.params.id, req.body.dataHash || "", req.body.uri || ""])
);
app.post("/lots/:id/reject", authenticate, (req, res) =>
  run(req, res, "rejectReception", [req.params.id, req.body.reason])
);
app.post("/lots/:id/storage", authenticate, requireRole("WAREHOUSE"), (req, res) =>
  run(req, res, "logStorage", [req.params.id, req.body.tempX10 ?? -32768, req.body.dataHash || "", req.body.uri || ""])
);
app.post("/lots/:id/sell", authenticate, requireRole("RETAILER"), (req, res) =>
  run(req, res, "sellLot", [req.params.id])
);
app.post("/lots/:id/recall", authenticate, requireRole("ADMIN", "AUDITOR"), (req, res) =>
  run(req, res, "recallLot", [req.params.id, req.body.reason])
);
app.get("/lots/:id/history", authenticate, async (req, res) => {
  try { res.json(json(await publicContract().getHistory(req.params.id))); }
  catch (error) { res.status(404).json({ error: error.shortMessage || error.message }); }
});
app.get("/public/lots/:id", async (req, res) => {
  try {
    const contract = publicContract();
    const [lot, history] = await Promise.all([
      contract.getLot(req.params.id),
      contract.getHistory(req.params.id),
    ]);
    res.json({
      lotId: lot.lotId, productType: lot.productType, origin: lot.origin,
      status: Number(lot.status), currentOwner: lot.currentOwner,
      timeline: history.map((event) => ({
        type: event.eventType || event[2],
        date: new Date(Number(event.timestamp || event[4]) * 1000).toISOString(),
        dataHash: event.dataHash || event[6],
      })),
    });
  } catch (error) { res.status(404).json({ error: error.shortMessage || error.message }); }
});
app.post("/lots/:id/documents", authenticate, upload.single("file"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "file is required" });
    const hash = crypto.createHash("sha256").update(fs.readFileSync(req.file.path)).digest("hex");
    const extension = path.extname(req.file.originalname);
    const finalName = `${hash}${extension}`;
    fs.renameSync(req.file.path, path.join(uploadsDir, finalName));
    res.status(201).json({ lotId: req.params.id, hash, uri: `/uploads/${finalName}`, verified: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get("/lots/:id/qr", authenticate, async (req, res) => {
  try {
    const url = `${process.env.PUBLIC_URL || `http://localhost:${port}`}/verify/${encodeURIComponent(req.params.id)}`;
    res.type("png").send(await QRCode.toBuffer(url));
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get("/alerts", authenticate, (req, res) => res.json(indexed.alerts));
app.use("/uploads", express.static(uploadsDir));
app.use("/docs", swaggerUi.serve, swaggerUi.setup({
  openapi: "3.0.0", info: { title: "Supply Chain API", version: "1.0.0" },
  paths: { "/auth/login": { post: { responses: { 200: { description: "JWT login" } } } }, "/public/lots/{id}": { get: { responses: { 200: { description: "Public lot data" } } } } },
}));

const contract = publicContract();
contract.on("LotEvent", (lotId, eventType, actor, timestamp, event) => {
  indexed.events.push({ lotId, eventType, actor, timestamp: timestamp.toString(), txHash: event.log.transactionHash });
});
contract.on("Alert", (lotId, code, actor, event) => {
  indexed.alerts.push({ lotId, code, actor, txHash: event.log.transactionHash });
});

if (require.main === module) app.listen(port, () => console.log(`Backend listening on http://localhost:${port}`));
module.exports = app;
