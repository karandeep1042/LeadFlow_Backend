import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

/**
 * Safely updates or appends a key-value pair in backend/.env
 */
export const updateEnvVariable = (key, value) => {
  try {
    if (!fs.existsSync(envPath)) return false;
    let content = fs.readFileSync(envPath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
    fs.writeFileSync(envPath, content, 'utf8');
    return true;
  } catch (err) {
    console.warn(`[EnvHelper] Could not write to .env for key ${key}:`, err.message);
    return false;
  }
};

export default updateEnvVariable;
