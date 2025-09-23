import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));

/* ================= CORS ================= */
const allowedOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes("*")) return callback(null, true);
      return callback(null, allowedOrigins.includes(origin));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
app.options(/.*/, cors()); // preflight
app.use((req, _res, next) => {
  console.log("Origin:", req.headers.origin || "(none)");
  next();
});

/* ============== Static docs (/public) ============== */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

/* ============== S3 client ============== */
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION;
// Base pública opcional (ex.: CloudFront). Se não existir, usa endpoint público do S3.
const PUBLIC_BASE =
  process.env.PUBLIC_BASE || `https://${BUCKET}.s3.${REGION}.amazonaws.com`;

/* ============== Health ============== */
app.get("/health", (_req, res) => res.send("ok"));

/* ============== Upload URL (PUT) ============== */
/**
 * Gera URL pré-assinada de upload (PUT) e já devolve a URL pública permanente do objeto.
 * Resposta: { putUrl, key, objectUrl }
 */
app.post("/api/upload-url", async (req, res) => {
  try {
    const { contentType, ext } = req.body || {};
    if (!contentType) {
      return res.status(400).json({ error: "contentType obrigatório" });
    }

    const allowedMime = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/svg+xml"
    ];
    if (!allowedMime.includes(contentType)) {
      return res.status(415).json({ error: "MIME não permitido" });
    }

    const key =
      `uploads/${new Date().toISOString().slice(0, 10)}/` +
      crypto.randomBytes(16).toString("hex") +
      (ext ? "." + String(ext).replace(".", "") : "");

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType
      // Objeto permanece privado; leitura pública vem da bucket policy.
    });

    const putUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });

    // ✅ URL pública do objeto (S3 ou CDN, se PUBLIC_BASE estiver setado)
    const objectUrl = `${PUBLIC_BASE}/${key}`;

    return res.json({ putUrl, key, objectUrl });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro ao gerar URL de upload" });
  }
});

/* ============== Download URL (GET assinado) ============== */
app.get("/api/download-url", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    return res.json({ url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro ao gerar URL de download" });
  }
});

/* ============== HEAD do objeto ============== */
app.get("/api/head", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    const out = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return res.json({
      exists: true,
      contentType: out.ContentType,
      contentLength: out.ContentLength,
      lastModified: out.LastModified
    });
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ exists: false });
    }
    console.error(err);
    return res.status(500).json({ error: "erro no head" });
  }
});

/* ============== Delete ============== */
app.delete("/api/object", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    return res.json({ ok: true, key });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "erro ao deletar" });
  }
});

/* ============== Proxy/stream (debug) ============== */
app.get("/api/object", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    res.setHeader("Content-Type", out.ContentType || "application/octet-stream");
    out.Body.pipe(res);
  } catch (e) {
    console.error(e);
    return res.status(404).json({ error: "não encontrado" });
  }
});

/* ============== Start ============== */
const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API S3 on http://localhost:${port}`));
