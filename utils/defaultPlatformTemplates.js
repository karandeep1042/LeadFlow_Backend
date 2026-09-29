export const DEFAULT_PLATFORM_TEMPLATES = [
  {
    key: 'org_welcome',
    name: 'Organization Welcome & Onboarding',
    category: 'Onboarding',
    subject: 'Welcome to {{brokerage_name}} – Your LeadFlow Platform Workspace is Ready',
    body: `Dear {{admin_name}},

Welcome to LeadFlow! Your dedicated brokerage workspace for {{brokerage_name}} has been created and provisioned on our German mortgage platform.

Your Administrator Credentials:
Login Portal: {{login_url}}
Login Email: {{admin_email}}
Temporary Password: {{temporary_password}}

You can now log in to configure your lead ingestion webhooks, invite your mortgage advisory team, and manage your borrower applications.

If you have any questions or require custom compliance configuration, please contact us at {{support_email}}.

Best regards,
LeadFlow Platform Team`,
    description: 'Automated welcome message with login credentials dispatched to the primary brokerage admin when a new organization is provisioned.',
    availableTags: [
      '{{brokerage_name}}',
      '{{admin_name}}',
      '{{admin_email}}',
      '{{temporary_password}}',
      '{{login_url}}',
      '{{support_email}}',
    ],
    defaultSubject: 'Welcome to {{brokerage_name}} – Your LeadFlow Platform Workspace is Ready',
    defaultBody: `Dear {{admin_name}},

Welcome to LeadFlow! Your dedicated brokerage workspace for {{brokerage_name}} has been created and provisioned on our German mortgage platform.

Your Administrator Credentials:
Login Portal: {{login_url}}
Login Email: {{admin_email}}
Temporary Password: {{temporary_password}}

You can now log in to configure your lead ingestion webhooks, invite your mortgage advisory team, and manage your borrower applications.

If you have any questions or require custom compliance configuration, please contact us at {{support_email}}.

Best regards,
LeadFlow Platform Team`,
  },
  {
    key: 'org_banned',
    name: 'Organization Account Suspended / Banned',
    category: 'Account Status',
    subject: 'Important: Your Brokerage Subscription for {{brokerage_name}} Has Been Suspended',
    body: `Dear {{admin_name}},

We are writing to notify you that the LeadFlow workspace and portal access for {{brokerage_name}} has been temporarily suspended by the platform administration.

Reason for Suspension:
{{ban_reason}}

During this suspension period:
1. Your brokerage admin and advisor team will be unable to access the workspace.
2. Ingested lead workflows and client portals have been put on hold.
3. All customer data, leads, and compliance records remain securely preserved in cold storage.

To appeal this decision or restore your workspace access, please contact our platform support desk at {{support_email}}.

Sincerely,
LeadFlow Compliance & Platform Security`,
    description: 'Dispatched to the brokerage admin when an organization is banned or suspended by the platform admin.',
    availableTags: [
      '{{brokerage_name}}',
      '{{admin_name}}',
      '{{admin_email}}',
      '{{ban_reason}}',
      '{{support_email}}',
    ],
    defaultSubject: 'Important: Your Brokerage Subscription for {{brokerage_name}} Has Been Suspended',
    defaultBody: `Dear {{admin_name}},

We are writing to notify you that the LeadFlow workspace and portal access for {{brokerage_name}} has been temporarily suspended by the platform administration.

Reason for Suspension:
{{ban_reason}}

During this suspension period:
1. Your brokerage admin and advisor team will be unable to access the workspace.
2. Ingested lead workflows and client portals have been put on hold.
3. All customer data, leads, and compliance records remain securely preserved in cold storage.

To appeal this decision or restore your workspace access, please contact our platform support desk at {{support_email}}.

Sincerely,
LeadFlow Compliance & Platform Security`,
  },
  {
    key: 'org_reactivated',
    name: 'Organization Account Reactivated',
    category: 'Account Status',
    subject: 'Your Brokerage Workspace for {{brokerage_name}} is Now Fully Reactivated',
    body: `Dear {{admin_name}},

Good news! Your LeadFlow brokerage workspace for {{brokerage_name}} has been reviewed and successfully reactivated by the platform administration.

Your mortgage advisors and client borrowers can now log in and resume all application and document verification workflows immediately.

Access Workspace: {{login_url}}

If you need any assistance getting back up to speed, feel free to reach out to {{support_email}}.

Welcome back,
LeadFlow Platform Team`,
    description: 'Dispatched to the brokerage admin when an organization account is restored to active status.',
    availableTags: [
      '{{brokerage_name}}',
      '{{admin_name}}',
      '{{admin_email}}',
      '{{login_url}}',
      '{{support_email}}',
    ],
    defaultSubject: 'Your Brokerage Workspace for {{brokerage_name}} is Now Fully Reactivated',
    defaultBody: `Dear {{admin_name}},

Good news! Your LeadFlow brokerage workspace for {{brokerage_name}} has been reviewed and successfully reactivated by the platform administration.

Your mortgage advisors and client borrowers can now log in and resume all application and document verification workflows immediately.

Access Workspace: {{login_url}}

If you need any assistance getting back up to speed, feel free to reach out to {{support_email}}.

Welcome back,
LeadFlow Platform Team`,
  },
  {
    key: 'signup_verification',
    name: 'Signup Email Verification Code (OTP)',
    category: 'Authentication & Security',
    subject: 'Your LeadFlow Verification Code: {{reset_code}}',
    body: `Dear {{user_name}},

Thank you for signing up with LeadFlow. Please use the following 6-digit verification code to confirm your email address and activate your brokerage registration:

Verification Code: {{reset_code}}

This verification code expires in 15 minutes. If you did not initiate this registration request, please disregard this message.

Best regards,
LeadFlow Security Team`,
    description: 'Dispatched during self-service brokerage admin signup to verify email authenticity.',
    availableTags: [
      '{{user_name}}',
      '{{user_email}}',
      '{{reset_code}}',
      '{{support_email}}',
    ],
    defaultSubject: 'Your LeadFlow Verification Code: {{reset_code}}',
    defaultBody: `Dear {{user_name}},

Thank you for signing up with LeadFlow. Please use the following 6-digit verification code to confirm your email address and activate your brokerage registration:

Verification Code: {{reset_code}}

This verification code expires in 15 minutes. If you did not initiate this registration request, please disregard this message.

Best regards,
LeadFlow Security Team`,
  },
  {
    key: 'password_reset_code',
    name: 'Password Reset Verification Code',
    category: 'Authentication & Security',
    subject: 'Your Password Reset Code: {{reset_code}} – {{brokerage_name}}',
    body: `Dear {{user_name}},

We received a request to reset your password for your LeadFlow account ({{user_email}}).

Your 6-digit verification code is:
{{reset_code}}

This code will expire in 15 minutes. If you did not request this password reset, you can safely ignore this email.

Direct Reset Link: {{reset_url}}

Best regards,
LeadFlow Security Desk`,
    description: 'Dispatched to any platform user requesting a forgotten password reset.',
    availableTags: [
      '{{user_name}}',
      '{{user_email}}',
      '{{reset_code}}',
      '{{reset_url}}',
      '{{brokerage_name}}',
      '{{support_email}}',
    ],
    defaultSubject: 'Your Password Reset Code: {{reset_code}} – {{brokerage_name}}',
    defaultBody: `Dear {{user_name}},

We received a request to reset your password for your LeadFlow account ({{user_email}}).

Your 6-digit verification code is:
{{reset_code}}

This code will expire in 15 minutes. If you did not request this password reset, you can safely ignore this email.

Direct Reset Link: {{reset_url}}

Best regards,
LeadFlow Security Desk`,
  },
  {
    key: 'password_reset_confirmation',
    name: 'Password Reset Security Confirmation',
    category: 'Authentication & Security',
    subject: 'Security Alert: Your LeadFlow Password Was Successfully Changed',
    body: `Dear {{user_name}},

This email confirms that the password for your LeadFlow account ({{user_email}}) was successfully updated.

If you did not perform this update, please contact our platform security team immediately at {{support_email}}.

Sign In: {{login_url}}

Best regards,
LeadFlow Security Desk`,
    description: 'Dispatched when a user successfully updates or resets their password.',
    availableTags: [
      '{{user_name}}',
      '{{user_email}}',
      '{{login_url}}',
      '{{support_email}}',
    ],
    defaultSubject: 'Security Alert: Your LeadFlow Password Was Successfully Changed',
    defaultBody: `Dear {{user_name}},

This email confirms that the password for your LeadFlow account ({{user_email}}) was successfully updated.

If you did not perform this update, please contact our platform security team immediately at {{support_email}}.

Sign In: {{login_url}}

Best regards,
LeadFlow Security Desk`,
  },
];
