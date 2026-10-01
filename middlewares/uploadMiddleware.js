import multer from 'multer';

// Use memory storage so files are streamed directly into Cloudinary without disk I/O
const storage = multer.memoryStorage();

// Supported MIME types for German mortgage documents (PDFs, Images, Office Docs)
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/tiff',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype) || file.originalname.match(/\.(pdf|jpe?g|png|webp|tiff|doc|docx)$/i)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type (${file.mimetype}). Please upload a PDF, PNG, or JPEG file.`), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size limit
  },
  fileFilter,
});

/**
 * Middleware wrapper for single file uploads that returns structured JSON errors if upload fails.
 */
export const handleSingleUpload = (fieldName = 'file') => {
  const single = upload.single(fieldName);
  return (req, res, next) => {
    single(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: 'File is too large. Maximum file size allowed is 25MB.',
          });
        }
        return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }
      next();
    });
  };
};

export default upload;
