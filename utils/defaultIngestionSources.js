import crypto from 'crypto';
import IngestionSource from '../models/IngestionSource.js';

export const DEFAULT_INGESTION_SOURCES = [
  {
    name: 'Immobilienscout24 Expat Leads',
    provider: 'custom',
    totalLeadsIngested: 42,
    lastPayloadReceivedAt: new Date(Date.now() - 15 * 60 * 1000),
    fieldMapping: {
      firstName: 'first_name',
      lastName: 'last_name',
      email: 'email',
      phone: 'phone',
      loanAmount: 'loan_amount',
      notes: 'notes',
    },
  },
  {
    name: 'Typeform Expat Mortgage Funnel',
    provider: 'typeform',
    totalLeadsIngested: 28,
    lastPayloadReceivedAt: new Date(Date.now() - 65 * 60 * 1000),
    fieldMapping: {
      firstName: 'firstName',
      lastName: 'lastName',
      email: 'email',
      phone: 'phone',
      loanAmount: 'loanAmount',
      notes: 'notes',
    },
  },
  {
    name: 'Calendly Consultation Booking',
    provider: 'calendly',
    totalLeadsIngested: 14,
    lastPayloadReceivedAt: new Date(Date.now() - 120 * 60 * 1000),
    fieldMapping: {
      firstName: 'firstName',
      lastName: 'lastName',
      email: 'email',
      phone: 'phone',
      loanAmount: 'loanAmount',
      notes: 'notes',
    },
  },
];

export const seedDefaultIngestionSources = async (brokerageId) => {
  if (!brokerageId) return [];
  try {
    const existingCount = await IngestionSource.countDocuments({ brokerageId });
    if (existingCount > 0) {
      return await IngestionSource.find({ brokerageId }).sort({ createdAt: -1 });
    }

    const createdSources = [];
    for (const src of DEFAULT_INGESTION_SOURCES) {
      const rawKey = `lf_live_${crypto.randomBytes(24).toString('hex')}`;
      const apiKeyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const created = await IngestionSource.create({
        brokerageId,
        name: src.name,
        provider: src.provider,
        apiKeyPrefix: rawKey.substring(0, 12) + '...',
        apiKeyHash,
        fieldMapping: src.fieldMapping,
        status: 'active',
        totalLeadsIngested: src.totalLeadsIngested || 0,
        lastPayloadReceivedAt: src.lastPayloadReceivedAt || null,
      });
      createdSources.push(created);
    }
    return createdSources;
  } catch (error) {
    console.error('[DefaultIngestionSources Error]:', error.message);
    return [];
  }
};
