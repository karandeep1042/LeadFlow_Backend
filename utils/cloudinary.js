import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getCloudinaryConfig = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY || process.env.CLOUDINARY_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.CLOUDINARY_SECRET;
  const cloudinaryUrl = process.env.CLOUDINARY_URL;

  return { cloudName, apiKey, apiSecret, cloudinaryUrl };
};

export const initCloudinary = () => {
  const { cloudName, apiKey, apiSecret, cloudinaryUrl } = getCloudinaryConfig();

  if (cloudinaryUrl && cloudinaryUrl.startsWith('cloudinary://')) {
    cloudinary.config({
      cloudinary_url: cloudinaryUrl,
      secure: true,
    });
  } else if (cloudName && apiKey && apiSecret) {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  return cloudinary;
};

// Initialize on module load
initCloudinary();

export const isCloudinaryConfigured = () => {
  const { cloudName, apiKey, apiSecret, cloudinaryUrl } = getCloudinaryConfig();
  if (cloudinaryUrl && cloudinaryUrl.startsWith('cloudinary://')) return true;
  return Boolean(cloudName && apiKey && apiSecret);
};

/**
 * Saves file buffer to backend local uploads folder and returns working URL
 */
export const saveBufferLocally = async (buffer, options = {}) => {
  const uploadsDir = path.resolve(__dirname, '../uploads/documents');
  await fs.promises.mkdir(uploadsDir, { recursive: true });

  const rawFilename = options.filename || `doc_${Date.now()}`;
  const cleanName = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const localFileName = `${Date.now()}_${cleanName}`;
  const localFilePath = path.join(uploadsDir, localFileName);

  if (buffer) {
    await fs.promises.writeFile(localFilePath, buffer);
  }

  const serverBaseUrl = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`;
  const fileUrl = `${serverBaseUrl}/uploads/documents/${localFileName}`;

  return {
    secure_url: fileUrl,
    url: fileUrl,
    public_id: `local_${localFileName}`,
    bytes: buffer ? buffer.length : 0,
    format: path.extname(cleanName).replace('.', '') || 'bin',
    resource_type: 'auto',
  };
};

/**
 * Uploads a file buffer directly to Cloudinary via stream.
 * If Cloudinary credentials are incomplete or upload encounters an error,
 * falls back seamlessly to local storage so files remain viewable.
 * 
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {Object} options - Cloudinary upload options (folder, docType, filename, etc.)
 * @returns {Promise<Object>} Cloudinary or Local upload result object
 */
export const uploadBufferToCloudinary = async (buffer, options = {}) => {
  initCloudinary();

  if (!isCloudinaryConfigured()) {
    console.warn(
      '[Cloudinary Info]: Cloudinary credentials incomplete. Storing file in local disk storage (backend/uploads/documents).'
    );
    return await saveBufferLocally(buffer, options);
  }

  return new Promise((resolve, reject) => {
    const {
      folder = 'leadflow/documents',
      filename = `doc_${Date.now()}`,
      resource_type = 'auto',
      tags = ['leadflow', 'client_document'],
      ...extraOptions
    } = options;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: filename.replace(/\.[^/.]+$/, ''), // remove extension for public_id
        resource_type,
        tags,
        use_filename: true,
        unique_filename: true,
        overwrite: true,
        access_mode: 'public',
        ...extraOptions,
      },
      async (error, result) => {
        if (error) {
          console.error('[Cloudinary Upload Error]:', error.message || error);
          console.warn('[Storage Fallback]: Falling back to local disk storage...');
          try {
            const localResult = await saveBufferLocally(buffer, options);
            return resolve(localResult);
          } catch (localErr) {
            return reject(error);
          }
        }
        resolve(result);
      }
    );

    uploadStream.end(buffer);
  });
};

/**
 * Deletes an asset from Cloudinary or local uploads folder.
 */
export const deleteFromCloudinary = async (publicId, resourceType = 'image') => {
  if (!publicId) return;

  if (publicId.startsWith('local_')) {
    try {
      const fileName = publicId.replace('local_', '');
      const filePath = path.resolve(__dirname, '../uploads/documents', fileName);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (err) {
      console.warn('[Local File Delete Warning]:', err.message);
    }
    return;
  }

  if (!isCloudinaryConfigured()) return;
  try {
    initCloudinary();
    return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.warn('[Cloudinary Delete Error]:', err.message);
  }
};

export default cloudinary;
