# API S3 — Upload e Download de Imagens

API em **Node.js + Express** para gerenciamento de arquivos no **Amazon S3**.  
Permite gerar URLs pré-assinadas de upload/download, verificar existência de objetos, deletar e até streamar imagens diretamente do bucket.  
Os objetos permanecem privados no S3; o acesso acontece sempre via API.

---

## 🚀 Tecnologias

- **Node.js 18+**  
- **Express.js**  
- **AWS SDK v3** (`@aws-sdk/client-s3`)  
- **dotenv** (variáveis de ambiente)  
- **morgan** (logs de requisição)  
- **cors** (controle de origens)  

---

## 📋 Funcionalidades

- **Healthcheck** → verificar se a API está no ar  
- **Upload** → gera URL pré-assinada para enviar arquivo direto ao S3  
- **Download** → gera URL pré-assinada temporária para visualizar/baixar  
- **Head** → confirma existência, MIME, tamanho e data de modificação  
- **Delete** → remove objeto do bucket  
- **Object** → streama a imagem direto do S3 (útil para debug)  

---

## 🔑 Rotas principais

### `GET /health`
Retorna `"ok"` para verificar status.

---

### `POST /api/upload-url`
Gera URL pré-assinada para enviar arquivo ao S3.  

**Body JSON**:
```json
{
  "contentType": "image/png",
  "ext": "png"
}
```

**Resposta**:
```json
{
  "url": "https://...s3.amazonaws.com/...assinado...",
  "key": "uploads/2025-09-16/abc123.png"
}
```

---

### `GET /api/download-url?key=<key>`
Gera URL pré-assinada de GET para visualizar objeto (expira em 5 min).

---

### `GET /api/head?key=<key>`
Retorna metadados do objeto:

```json
{
  "exists": true,
  "contentType": "image/png",
  "contentLength": 12345,
  "lastModified": "2025-09-16T10:15:00.000Z"
}
```

---

### `DELETE /api/object?key=<key>`
Remove objeto do bucket.

---

### `GET /api/object?key=<key>`
Streama o objeto direto do S3 (imagem binária).

---

## ⚙️ Variáveis de ambiente (.env)

```env
PORT=3001
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=SUACHAVE
AWS_SECRET_ACCESS_KEY=SUASECRET
S3_BUCKET=nome-do-bucket
CORS_ORIGIN=http://127.0.0.1:5500,http://localhost:5500
```

**CORS_ORIGIN**: lista de origens permitidas (separadas por vírgula).

---

## ▶️ Como rodar localmente

1. **Instalar dependências**:
   ```bash
   npm install
   ```

2. **Criar .env** na raiz com suas credenciais.

3. **Iniciar servidor**:
   ```bash
   npm run dev
   ```

4. **Testar**:
   - http://localhost:3001/health → deve retornar "ok"
   - Documentação HTML em http://localhost:3001/

---

## 📌 Observação importante

Para uploads diretos no navegador funcionarem, é necessário configurar **CORS no bucket S3** permitindo métodos PUT, GET, HEAD a partir do domínio do seu front-end.

**Exemplo de configuração no S3**:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedOrigins": ["http://127.0.0.1:5500", "http://localhost:5500"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```