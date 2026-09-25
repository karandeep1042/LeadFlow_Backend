export const ROLES = {
  PLATFORM_ADMIN: 'platform_admin',
  BROKERAGE_ADMIN: 'brokerage_admin',
  ADVISOR: 'advisor',
  CLIENT: 'client',
};

export const ALL_ROLES = Object.values(ROLES);

export const STAFF_ROLES = [ROLES.BROKERAGE_ADMIN, ROLES.ADVISOR];

export const ADMIN_ROLES = [ROLES.PLATFORM_ADMIN, ROLES.BROKERAGE_ADMIN];
