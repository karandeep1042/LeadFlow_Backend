export const ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  BROKERAGE_ADMIN: 'brokerage_admin',
  ADVISOR: 'advisor',
  CLIENT: 'client',
};

export const ALL_ROLES = Object.values(ROLES);

export const STAFF_ROLES = [ROLES.BROKERAGE_ADMIN, ROLES.ADVISOR];

export const ADMIN_ROLES = [ROLES.PLATFORM_ADMIN, ROLES.BROKERAGE_ADMIN];

export const REQUIRED_COMPLIANCE_DOC_TYPES = [
  'passport',
  'residence_permit',
  'registration_cert',
  'marriage_cert',
  'payslip_1',
  'payslip_2',
  'payslip_3',
  'tax_summary',
  'employment_contract',
  'employer_confirmation',
  'schufa',
  'bank_statement_1',
  'bank_statement_2',
  'bank_statement_3',
  'equity_proof',
  'property_expose',
  'grundbuch',
  'floor_plan',
];

export const ALLOWED_STAGE_TRANSITIONS = {
  'New': ['Contacted'],
  'Contacted': ['Document Collection'],
  'Document Collection': ['Bank Submission'],
  'Bank Submission': ['Won', 'Document Collection'],
  'Won': ['Lost'],
  'Lost': [],
};
export const STAGE_DISPLAY_NAMES = {
  'New': 'Lead Ingestion',
  'Contacted': 'Initial Consultation',
  'Document Collection': 'Document Collection',
  'Bank Submission': 'Bank Submission',
  'Won': 'Loan Offer & Approval',
  'Lost': 'Notary & Closing',
};

export const getStageDisplayName = (stageKey) => {
  if (!stageKey) return 'Pipeline';
  return STAGE_DISPLAY_NAMES[stageKey] || stageKey;
};


