export {
  consoleRole,
  createOrgAuthorizer,
  type EventRoleResolver,
  memberRole,
  orgAuthorizer,
} from './authorizer.ts';
export {
  type AgencyAccess,
  type AgencyClientGrant,
  AgencyClientOrgDto,
  AgencyGrantDto,
  agencyAccess,
  agencyAccessTx,
  agencyClientGrantsTx,
  GrantAgencyAccessInput,
  grantAgencyAccessCommand,
  listAgencyGrantsQuery,
  liveAgencyGrantTx,
  MONEY_TABLES,
  myAgencyClients,
  revokeAgencyGrantCommand,
  UpdateAgencyGrantInput,
  updateAgencyGrantCommand,
} from './commands/agency.ts';
export {
  ApiUsageDto,
  apiUsageQuery,
  recordApiKeyUsage,
  summarizeApiKeyUsageCommand,
  unsummarizedApiKeyUsage,
} from './commands/api-key-usage.ts';
// M6.3a: key lifetimes and rotation, daily usage, sandbox orgs.
export {
  API_KEY_LIFETIMES,
  API_KEY_MODES,
  API_KEY_PATTERN,
  API_KEY_ROTATION_OVERLAPS,
  ApiKeyDto,
  type ApiKeyIdentity,
  type ApiKeyMode,
  type ApiKeySelf,
  apiKeyIdentity,
  apiKeySelf,
  CreateApiKeyInput,
  createApiKeyCommand,
  isApiKeyLive,
  listApiKeysQuery,
  RotateApiKeyInput,
  revokeApiKeyCommand,
  rotateApiKeyCommand,
} from './commands/api-keys.ts';
export {
  addDomainCommand,
  DomainDto,
  ensureManagedDomainCommand,
  listDomainsQuery,
  MAX_CUSTOM_DOMAINS,
  recordDomainCheckCommand,
  recordDomainWalletsCommand,
  removeDomainCommand,
  resolveHost,
  setPrimaryDomainCommand,
} from './commands/domains.ts';
export {
  EndImpersonationInput,
  endImpersonationCommand,
  IMPERSONATION_STARTED,
  impersonationNotice,
  StartImpersonationInput,
  startImpersonationCommand,
} from './commands/impersonation.ts';
export {
  acceptInvitation,
  createEventInvitationTx,
  type EventRoleGranter,
  eventInvitationsTx,
  inviteMemberCommand,
  lookupInvitation,
  removeIdleCollaboratorTx,
  revokeEventInvitationTx,
  revokeInvitationCommand,
} from './commands/invitations.ts';
export {
  type EnsureOutcome,
  ensureManagedMembershipTx,
  type ManagedRole,
  membershipRoleTx,
  type RemoveOutcome,
  removeManagedMembershipTx,
} from './commands/managed-members.ts';
export { addMemberCommand, changeMemberRoleCommand, removeMemberCommand } from './commands/members.ts';
export {
  completeOnboardingCommand,
  markOnboardingStepTx,
  ONBOARDING_COMPLETED,
  type Onboarding,
  OnboardingDto,
  onboardingQuery,
} from './commands/onboarding.ts';
export {
  ORG_STATUS_CHANGED,
  OrgStatusChangeDto,
  orgStatusGate,
  orgStatusHistoryQuery,
  orgStatusNotice,
  RestoreOrgInput,
  restoreOrgCommand,
  SetOrgStatusInput,
  setOrgStatusCommand,
} from './commands/org-status.ts';
export {
  createOrganization,
  createOrganizationCommand,
  hashSignupCode,
  NewSignupCodeInput,
  openSignupEnabled,
  platformFlagTx,
  randomSignupCode,
  SignUpOrganizationInput,
  signUpOrganization,
  signUpOrganizationCommand,
  signupCodeValid,
  updateOrganizationCommand,
} from './commands/organizations.ts';
export {
  CreateSandboxInput,
  createSandboxCommand,
  createSandboxOrg,
  deleteSandboxCommand,
  deleteSandboxOrg,
  isSandboxOrg,
  isSandboxOrgTx,
  listSandboxesQuery,
  MAX_SANDBOX_ORGS,
  provisionSandboxOrgCommand,
  retireSandboxOrgCommand,
  SandboxDto,
  sandboxOrgName,
  sandboxSlug,
} from './commands/sandbox.ts';
export {
  AgreementStatusDto,
  acceptAgreementCommand,
  agreementsQuery,
  hasAcceptedTermsTx,
  LegalPageDto,
  legalPagesQuery,
  legalPageTx,
  publicLegalPage,
  publicOrgProfile,
  setLegalPageCommand,
} from './commands/settings.ts';
export {
  activeSuspensionsTx,
  assertNotPausedTx,
  liftCapabilityTx,
  pauseCapabilityTx,
  SuspensionDto,
  type SuspensionKind,
  setSuspensionCommand,
  suspensionHistoryQuery,
  suspensionsQuery,
} from './commands/suspensions.ts';
export { tenancyDataSubjects } from './data-subject.ts';
export { AGREEMENT_DOCUMENTS, type AgreementDocument, PLATFORM_AGREEMENTS } from './domain/agreements.ts';
export { signInvitation } from './domain/invitation-token.ts';
export {
  initialOrgStatus,
  limitedRefusal,
  missingOnboardingSteps,
  type OnboardingStep,
  REQUIRED_ONBOARDING_STEPS,
  type SignupMode,
  signupPath,
} from './domain/onboarding.ts';
export {
  isOrgLive,
  nextOrgStatus,
  type OrgStatus,
  type OrgStatusAction,
  orgStatusActions,
  orgWriteRefusal,
  restoredOrgStatus,
} from './domain/org-status.ts';
export {
  AGENCY_CONSOLE_ROLES,
  AGENCY_FINANCE_PERMISSIONS,
  AGENCY_ROLE_PERMISSIONS,
  type AgencyConsoleRole,
  type AgencyGrantRole,
  agencyConsoleRole,
  type ConsoleRole,
  EVENT_ROLE_PERMISSIONS,
  EVENT_ROLE_SECTIONS,
  eventRoleCan,
  eventRolesOpenSection,
  GRANTABLE_ORG_ROLES,
  isAgencyConsoleRole,
  type OrgRole,
  PERMISSIONS,
  type Permission,
  ROLE_PERMISSIONS,
  roleCan,
  roleRequiresTwoFactor,
  TEAM_EVENT_ROLES,
  type TeamEventRole,
  TWO_FACTOR_ROLES,
} from './domain/permissions.ts';
export {
  accountMembershipTx,
  agreementsAcceptedByTx,
  eraseInvitationsDsarTx,
  invitationOrgs,
  invitationsDsarTx,
  leaveOrganizationTx,
  soleOwnerOrgs,
} from './dsar.ts';
export * from './dto.ts';
export { managedHostname, normalizeHostname, reservedHostname, tenantApex } from './hosting/hostnames.ts';
export {
  type DnsRecord,
  type DomainCheck,
  type DomainProvider,
  fakeDomainProvider,
} from './hosting/provider.ts';
export {
  providerBackoffMs,
  RECHECK_MAX_AGE_MS,
  recheckDue,
  recheckIntervalMs,
} from './hosting/recheck.ts';
export { privateColumns } from './private-columns.ts';
export {
  domainProblemsTx,
  getOrganizationQuery,
  listInvitationsQuery,
  listMembersQuery,
  memberRoleTx,
  memberUserIdsTx,
  myOrganizations,
  organizationBrandTx,
  organizationDefaultsTx,
  organizationLocaleTx,
  organizationLogoTx,
  organizationNameTx,
  organizationPublicTx,
  resolveOrgSlug,
  setOrganizationLogoTx,
  twoFactorRequiredBy,
} from './queries.ts';
export {
  AGENCY_GRANT_ROLES,
  API_KEY_SCOPES,
  type ApiKeyScope,
  DOMAIN_STATUSES,
  LEGAL_PAGE_KINDS,
  type LegalPageKind,
  ONBOARDING_STEPS,
  ORG_KINDS,
  ORG_ROLES,
  ORG_STATUS_ACTIONS,
  ORG_STATUS_CHANGE_ACTIONS,
  ORG_STATUSES,
  SIGNUP_MODES,
  SUSPENSION_KINDS,
  TEST_KEY_SCOPES,
} from './schema.ts';
export { invitationMailer } from './subscribers.ts';
