// app.js
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

const app = express();
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// serve a documentação (HTML/CSS) em /
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));


// --- S3 client ---
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const BUCKET = process.env.S3_BUCKET;

// Healthcheck
app.get("/health", (_, res) => res.send("ok"));

// 1) Pré-assina URL de upload (PUT direto no S3)
app.post("/api/upload-url", async (req, res) => {
  try {
    const { contentType, ext } = req.body || {};
    if (!contentType) return res.status(400).json({ error: "contentType obrigatório" });

    const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowed.includes(contentType)) return res.status(415).json({ error: "MIME não permitido" });

    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto
      .randomBytes(16)
      .toString("hex")}${ext ? "." + ext.replace(".", "") : ""}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ACL: "public-read"
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    res.json({ url, key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "erro ao gerar URL de upload" });
  }
});

// 2) Pré-assina URL de download (GET)
app.get("/api/download-url", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    res.json({ url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "erro ao gerar URL de download" });
  }
});

// 3) HEAD — confirma existência/tamanho/MIME (sem baixar)
app.get("/api/head", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    const out = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({
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
    res.status(500).json({ error: "erro no head" });
  }
});

// 4) DELETE — remove um arquivo do bucket
app.delete("/api/object", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    res.json({ ok: true, key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "erro ao deletar" });
  }
});

// 5) OBJECT — streama a imagem direto do S3 (debug/uso interno)
app.get("/api/object", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    // Usa GetObject e faz pipe do stream pra resposta HTTP
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    res.setHeader("Content-Type", out.ContentType || "application/octet-stream");
    // Opcional: forçar download em vez de inline
    // res.setHeader("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`);
    out.Body.pipe(res);
  } catch (e) {
    console.error(e);
    // 404 se não achar; 403/500 para outros
    res.status(404).json({ error: "não encontrado" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API S3 on http://localhost:${port}`));
