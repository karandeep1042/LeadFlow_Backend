export const BROKERAGES_CONFIG = [
  {
    name: 'HypoExpat Berlin GmbH',
    subdomain: 'hypo-expat-berlin',
    city: 'Berlin',
    phone: '+49 30 55667788',
    adminEmail: 'berlin.admin@yopmail.com',
    adminName: 'Klaus Becker',
    metrics: {
      totalLeadsIngested: 48,
      acquiredClientsCount: 16,
      documentsAcceptedCount: 220,
      documentsRejectedCount: 18,
      totalMortgageVolumeEur: 18450000,
    },
  },
  {
    name: 'Bavaria Prime Mortgages',
    subdomain: 'bavaria-prime',
    city: 'Munich',
    phone: '+49 89 23456789',
    adminEmail: 'munich.admin@yopmail.com',
    adminName: 'Markus Lindner',
    metrics: {
      totalLeadsIngested: 36,
      acquiredClientsCount: 12,
      documentsAcceptedCount: 164,
      documentsRejectedCount: 12,
      totalMortgageVolumeEur: 16800000,
    },
  },
  {
    name: 'Rhein-Main Baufinanzierung',
    subdomain: 'rhein-main-baufi',
    city: 'Frankfurt',
    phone: '+49 69 98765432',
    adminEmail: 'frankfurt.admin@yopmail.com',
    adminName: 'Dr. Wolfgang Richter',
    metrics: {
      totalLeadsIngested: 29,
      acquiredClientsCount: 9,
      documentsAcceptedCount: 130,
      documentsRejectedCount: 8,
      totalMortgageVolumeEur: 12900000,
    },
  },
  {
    name: 'Hanseatic Expat Lending',
    subdomain: 'hanseatic-lending',
    city: 'Hamburg',
    phone: '+49 40 11223344',
    adminEmail: 'hamburg.admin@yopmail.com',
    adminName: 'Henrik Hansen',
    metrics: {
      totalLeadsIngested: 24,
      acquiredClientsCount: 8,
      documentsAcceptedCount: 98,
      documentsRejectedCount: 6,
      totalMortgageVolumeEur: 9750000,
    },
  },
];

export const ADVISORS_CONFIG = [
  // Berlin
  { name: 'Sarah Jenkins', email: 'sarah.advisor@yopmail.com', subdomain: 'hypo-expat-berlin', phone: '+49 170 8899112' },
  { name: 'Maximilian Weber', email: 'max.advisor@yopmail.com', subdomain: 'hypo-expat-berlin', phone: '+49 171 3344556' },
  { name: 'Chloe Dubois', email: 'chloe.advisor@yopmail.com', subdomain: 'hypo-expat-berlin', phone: '+49 172 5566778' },
  // Munich
  { name: 'Florian Bauer', email: 'florian.advisor@yopmail.com', subdomain: 'bavaria-prime', phone: '+49 175 4455667' },
  { name: 'Lena Schmidt', email: 'lena.advisor@yopmail.com', subdomain: 'bavaria-prime', phone: '+49 176 7788990' },
  // Frankfurt
  { name: 'Sebastian Koch', email: 'sebastian.advisor@yopmail.com', subdomain: 'rhein-main-baufi', phone: '+49 177 1239876' },
  { name: 'Claudia Hoffmann', email: 'claudia.advisor@yopmail.com', subdomain: 'rhein-main-baufi', phone: '+49 178 9871234' },
  // Hamburg
  { name: 'Jan Novák', email: 'jan.advisor@yopmail.com', subdomain: 'hanseatic-lending', phone: '+49 173 7788990' },
  { name: 'Sophie Larsson', email: 'sophie.advisor@yopmail.com', subdomain: 'hanseatic-lending', phone: '+49 174 5544332' },
];
