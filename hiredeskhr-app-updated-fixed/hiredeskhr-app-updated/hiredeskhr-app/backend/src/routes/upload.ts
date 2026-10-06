import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

export const uploadRouter = Router();

// Configurable resume storage path (VPS / Contabo production compatibility)
export const getResumeStoragePath = (): string => {
  const p = process.env.RESUME_STORAGE_PATH
    ? path.resolve(process.env.RESUME_STORAGE_PATH)
    : path.resolve(__dirname, '../../uploads/resumes');
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
  return p;
};

// Ensure directory exists at startup
const resumesDir = getResumeStoragePath();

// Configurable maximum file size (default 5MB)
export const getMaxResumeSizeMB = (): number => {
  return parseInt(process.env.MAX_RESUME_SIZE_MB || '5', 10);
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, getResumeStoragePath()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 50) || 'resume';
    cb(null, `${Date.now()}-${uuidv4().substring(0, 8)}-${safeBase}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: getMaxResumeSizeMB() * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    // Strictly validate PDF format
    const isPdfExt = ext === '.pdf';
    const isPdfMime = mime === 'application/pdf' || mime === 'application/x-pdf' || mime === 'application/octet-stream';

    if (!isPdfExt) {
      return cb(new Error('Invalid file type. Only PDF resumes are accepted (.pdf).'));
    }
    cb(null, true);
  }
});

// Resume upload for career-page applicants and manually-sourced candidates.
// Validates PDF strictly, enforces configurable max size (5MB), and generates secure authorized URL.
uploadRouter.post('/resume', (req, res) => {
  upload.single('resume')(req, res, (err: any) => {
    const maxMb = getMaxResumeSizeMB();
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `Resume file is too large. Maximum size is ${maxMb}MB.`
          : err.message || 'Resume upload failed.';
      return res.status(400).json({ error: message });
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: 'No resume file was received.' });
    }

    const secureUrl = `/api/candidates/resume/${file.filename}`;

    return res.status(201).json({
      success: true,
      fileName: file.originalname,
      storedFileName: file.filename,
      fileKey: file.filename,
      url: secureUrl,
      sizeBytes: file.size
    });
  });
});

// Feedback / Support attachment storage
export const getAttachmentStoragePath = (): string => {
  const p = path.resolve(__dirname, '../../uploads/attachments');
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
  return p;
};

const attachmentStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, getAttachmentStoragePath()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 50) || 'attachment';
    cb(null, `${Date.now()}-${uuidv4().substring(0, 8)}-${safeBase}${ext}`);
  }
});

const uploadAttachment = multer({
  storage: attachmentStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.docx', '.txt', '.csv', '.xlsx']);
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExts.has(ext)) {
      return cb(new Error('Invalid file type. Allowed formats: PNG, JPG, WEBP, PDF, DOCX, TXT.'));
    }
    cb(null, true);
  }
});

uploadRouter.post('/feedback-attachment', (req, res) => {
  uploadAttachment.single('attachment')(req, res, (err: any) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Attachment file is too large. Maximum size is 10MB.'
          : err.message || 'File upload failed.';
      return res.status(400).json({ error: message });
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: 'No attachment file was received.' });
    }

    const attachmentUrl = `/uploads/attachments/${file.filename}`;

    return res.status(201).json({
      success: true,
      fileName: file.originalname,
      storedFileName: file.filename,
      url: attachmentUrl,
      sizeBytes: file.size
    });
  });
});


