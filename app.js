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

// Configura CORS com whitelist vinda de CORS_ORIGIN (ou *), incluindo preflight.
// Objetivo: permitir chamadas só de origens autorizadas, mas aceitar chamadas sem origin (Postman/health).
const allowed = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const corsOpts = {
  origin: (origin, cb) => {
    if (!origin || allowed.includes("*")) return cb(null, true);
    return cb(null, allowed.includes(origin));
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOpts));
app.options(/.*/, cors(corsOpts));
app.use((req, _res, next) => { console.log("Origin:", req.headers.origin); next(); });

// Serve arquivos estáticos de documentação (HTML/CSS) na raiz /.
// Objetivo: expor uma página simples explicando/ilustrando o uso da API.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// Inicializa cliente S3 com credenciais/region das variáveis de ambiente.
// Objetivo: permitir gerar URLs pré-assinadas e operar objetos no bucket privado.
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});
const BUCKET = process.env.S3_BUCKET;

// Endpoint de healthcheck simples para monitoramento.
// Retorna "ok" se o processo está vivo e aceitando requisições.
app.get("/health", (_, res) => res.send("ok"));

// Gera URL pré-assinada de upload (PUT) para enviar arquivo direto ao S3.
// Valida MIME permitido, cria uma key única (data/hex.ext), mantém objeto privado e expira em 5 min.
// Retorno: { url, key } para o frontend realizar o PUT e depois referenciar o arquivo via key.
app.post("/api/upload-url", async (req, res) => {
  try {
    const { contentType, ext } = req.body || {};
    if (!contentType) return res.status(400).json({ error: "contentType obrigatório" });

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

    const key = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto
      .randomBytes(16)
      .toString("hex")}${ext ? "." + String(ext).replace(".", "") : ""}`;

    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType
      // Mantém privado; não usa ACL pública.
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 5 });
    res.json({ url, key });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "erro ao gerar URL de upload" });
  }
});

// Gera URL pré-assinada de download (GET) para baixar um objeto privado do S3.
// Requer a key do objeto; expira em 5 min. Retorna { url } para consumo direto no cliente.
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

// Executa um HEAD no objeto para checar existência e metadados (ContentType, tamanho, modificação).
// Útil para validar uploads sem transferir o arquivo. Retorna exists=true/false e metadados quando disponível.
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

// Deleta um objeto do bucket a partir da key informada.
// Uso típico: limpeza de arquivos enviados por engano ou remoção sob demanda pelo usuário.
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

// Faz proxy/stream direto do objeto do S3 para a resposta HTTP.
// Útil para debug ou casos internos em que se deseja servir a imagem sem URL assinada.
app.get("/api/object", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!key) return res.status(400).json({ error: "key obrigatório" });

    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    res.setHeader("Content-Type", out.ContentType || "application/octet-stream");
    out.Body.pipe(res);
  } catch (e) {
    console.error(e);
    res.status(404).json({ error: "não encontrado" });
  }
});

// Sobe o servidor na porta definida em PORT (ou 3001) e loga a URL local.
// Objetivo: expor a API de utilitários S3 para ser consumida pelo frontend.
const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API S3 on http://localhost:${port}`));
