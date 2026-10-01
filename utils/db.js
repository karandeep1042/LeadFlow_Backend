import './dotenvLoader.js';
import mongoose from 'mongoose';

/**
 * Ensures a database name is always present in the connection string.
 * Prevents unintentional fallbacks to default empty 'test' database in MongoDB Atlas.
 */
export const normalizeMongoUri = (rawUri) => {
  if (!rawUri || !rawUri.trim()) return 'mongodb://127.0.0.1:27017/leadflow';
  let uri = rawUri.trim();

  // If URI matches mongodb://.../?query or mongodb+srv://.../?query without a DB name
  if (/mongodb(?:\+srv)?:\/\/[^/]+\/\?[^/]*$/.test(uri)) {
    uri = uri.replace(/\/\?/, '/leadflow?');
  } else if (/mongodb(?:\+srv)?:\/\/[^/]+\/$/.test(uri)) {
    uri = uri + 'leadflow';
  } else if (/mongodb(?:\+srv)?:\/\/[^/?#]+$/.test(uri)) {
    uri = uri + '/leadflow';
  }

  return uri;
};

let currentMongoUri = normalizeMongoUri(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/leadflow');

/**
 * Extracts cluster hostname, database name, and Atlas detection from connection string.
 */
export const parseMongoUriInfo = (rawUri) => {
  const uri = normalizeMongoUri(rawUri || currentMongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/leadflow');
  try {
    const isAtlas = uri.includes('mongodb.net') || uri.startsWith('mongodb+srv://');
    let host = '127.0.0.1';
    let databaseName = 'leadflow';

    const hostMatch = uri.match(/@([^/?#]+)/);
    if (hostMatch && hostMatch[1]) {
      host = hostMatch[1];
    } else {
      const directMatch = uri.match(/mongodb(?:\+srv)?:\/\/([^/?#]+)/);
      if (directMatch && directMatch[1]) {
        host = directMatch[1];
      }
    }

    const dbMatch = uri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?&#]+)/);
    if (dbMatch && dbMatch[1]) {
      databaseName = dbMatch[1];
    }

    return { host, databaseName, isAtlas, rawUri: uri };
  } catch (_) {
    return { host: '127.0.0.1', databaseName: 'leadflow', isAtlas: false, rawUri: uri };
  }
};

/**
 * Connects or switches connection to target MongoDB URI.
 */
export const connectDB = async (uri = (currentMongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/leadflow')) => {
  const targetUri = normalizeMongoUri(uri);
  currentMongoUri = targetUri;

  try {
    if (mongoose.connection.readyState !== 0) {
      console.log('[MongoDB] Disconnecting previous session before establishing new connection...');
      await mongoose.disconnect();
    }

    const conn = await mongoose.connect(targetUri, {
      serverSelectionTimeoutMS: 6000,
    });

    const info = parseMongoUriInfo(targetUri);
    console.log(`[MongoDB Connected]: Host: ${info.host} | DB: ${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB Connection Error]: ${error.message}`);
    console.warn('[MongoDB Warning]: Server continuing in decoupled mode. Ensure MongoDB is reachable.');
  }
};

/**
 * Performs non-blocking ping and collection discovery on the active or provided URI.
 */
export const testDatabaseConnection = async (testUri) => {
  const targetUri = normalizeMongoUri(testUri || currentMongoUri || process.env.MONGO_URI || '');
  const startTime = Date.now();

  try {
    // If no testUri provided and active mongoose connection is healthy
    if (!testUri && mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
      const latencyMs = Date.now() - startTime;
      const collections = await mongoose.connection.db.listCollections().toArray();
      const uriInfo = parseMongoUriInfo(currentMongoUri);
      const displayHost = uriInfo.host || mongoose.connection.host || 'MongoDB Cluster';
      const displayName = mongoose.connection.name || uriInfo.databaseName || 'leadflow';

      return {
        success: true,
        message: `Database connection verified successfully. Host: ${displayHost}/${displayName}`,
        latencyMs,
        details: {
          host: displayHost,
          port: mongoose.connection.port || 27017,
          name: displayName,
          collectionsCount: collections.length,
          readyState: 'Connected',
        },
      };
    }

    // Testing isolated or new URI
    const testConnection = await mongoose.createConnection(targetUri, {
      serverSelectionTimeoutMS: 6000,
    }).asPromise();

    await testConnection.db.admin().ping();
    const latencyMs = Date.now() - startTime;
    const collections = await testConnection.db.listCollections().toArray();
    const uriInfo = parseMongoUriInfo(targetUri);
    const displayHost = uriInfo.host || testConnection.host || 'MongoDB Cluster';
    const displayName = testConnection.name || uriInfo.databaseName || 'leadflow';

    const details = {
      host: displayHost,
      port: testConnection.port || 27017,
      name: displayName,
      collectionsCount: collections.length,
      readyState: 'Verified',
    };

    await testConnection.close();

    return {
      success: true,
      message: `Database connection verified successfully. Host: ${details.host}/${details.name}`,
      latencyMs,
      details,
    };
  } catch (error) {
    return {
      success: false,
      message: `Database connection failed: ${error.message}`,
      latencyMs: Date.now() - startTime,
    };
  }
};

export const getCurrentMongoUri = () => currentMongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/leadflow';

export const maskMongoUri = (uri) => {
  if (!uri) return '';
  return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@.+)/i, '$1••••••••$3');
};



