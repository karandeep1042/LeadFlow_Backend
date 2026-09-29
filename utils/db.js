import mongoose from 'mongoose';

let currentMongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/leadflow';

export const connectDB = async (uri = currentMongoUri) => {
  currentMongoUri = uri;
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`[MongoDB Connected]: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[MongoDB Connection Error]: ${error.message}`);
    console.warn('[MongoDB Warning]: Server continuing in decoupled mode. Ensure MongoDB is running.');
  }
};

export const testDatabaseConnection = async (testUri) => {
  const targetUri = testUri || currentMongoUri;
  const startTime = Date.now();

  try {
    if (!testUri && mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.admin().ping();
      const latencyMs = Date.now() - startTime;
      const collections = await mongoose.connection.db.listCollections().toArray();
      return {
        success: true,
        message: 'MongoDB database is operational and responsive.',
        latencyMs,
        details: {
          host: mongoose.connection.host,
          port: mongoose.connection.port,
          name: mongoose.connection.name,
          collectionsCount: collections.length,
          readyState: 'Connected',
        },
      };
    }

    // Testing new/isolated URI
    const testConnection = await mongoose.createConnection(targetUri, {
      serverSelectionTimeoutMS: 5000,
    }).asPromise();

    await testConnection.db.admin().ping();
    const latencyMs = Date.now() - startTime;
    const collections = await testConnection.db.listCollections().toArray();
    const details = {
      host: testConnection.host,
      port: testConnection.port,
      name: testConnection.name,
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

export const getCurrentMongoUri = () => currentMongoUri;

