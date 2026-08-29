/**
 * upload.routes.js — Subida de archivos estáticos (imágenes, PDF)
 * Almacena en backend/public/uploads/ → servidos con CDN headers via /public/
 */

const path    = require('path');
const crypto  = require('crypto');
const { Router } = require('express');
const multer  = require('multer');
const { authMiddleware } = require('../middleware/auth.middleware');

const router = Router();
router.use(authMiddleware);

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/svg+xml', 'application/pdf',
]);

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
  },
});

// POST /api/upload — sube un archivo, retorna URL pública
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
  const baseUrl = process.env.PUBLIC_URL || `http://${req.headers.host}`;
  const url = `${baseUrl}/public/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename, size: req.file.size });
});

// Manejo de error de multer (tamaño, tipo)
router.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || 'Error al subir archivo' });
});

module.exports = router;
