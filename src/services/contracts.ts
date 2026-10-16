import type { Bindings } from '../config/bindings';
import type { Role } from '../permissions/roles';
import type { Permission } from '../permissions/permissions';
import type { TenantContext } from '../types/context';
import type { ConfigurationStudioGateway } from './configuration-studio.service';
import type { AcademicStructureGateway } from './academic-structure.service';
import type { DomainDirectoryGateway } from './domain-provisioning.service';
import type { JobGateway } from './background-jobs.service';
import type { CorePortalGateway } from './core-portal.service';
import type { PaymentGateway } from './payments.service';
import type { CompletePlatformGateway } from './complete-platform.service';
import type { PlatformStudioGateway } from './platform-studio.service';
import type { ApplicantGateway } from './applicant.service';
import type { TenantConfiguration } from '../configuration/model';
import type { CommunicationsGateway } from './communications.service';

export type MembershipResult = Readonly<{
  roles: readonly Role[];
  roleCodes?: readonly string[];
  permissions?: readonly Permission[];
  membershipId?: string | null;
  membershipKind?:
    'applicant' | 'guardian' | 'student' | 'teacher' | 'administrator' | 'specialist' | null;
  lifecycleState?: string | null;
  resourceScopes?: Readonly<Record<string, unknown>>;
  isModerator: boolean;
}>;

export interface TenantDirectory {
  findActiveByHostname(bindings: Bindings, hostname: string): Promise<TenantContext | null>;
}

export interface TokenVerifier {
  verify(bindings: Bindings, token: string): Promise<{ userId: string }>;
}

export interface MembershipDirectory {
  findForUser(bindings: Bindings, schoolId: string, userId: string): Promise<MembershipResult>;
  resolveSupportSession?(bindings:Bindings,input:{schoolId:string;operatorId:string;token:string}):Promise<{membership:MembershipResult;targetAccountId:string;session:{id:string;reason:string;expiresAt:string}} | null>;
  auditSupportRequest?(bindings:Bindings,input:{schoolId:string;operatorId:string;targetAccountId:string;sessionId:string;method:string;route:string;status:number}):Promise<void>;
}

export interface ReadinessProbe {
  check(bindings: Bindings): Promise<void>;
}

export type Branding = Readonly<{
  logo: Readonly<{ url: string | null }>;
  colors: Readonly<{ primary: string; secondary: string; accent: string }>;
  fonts: Readonly<{ heading: string; body: string }>;
  favicon: Readonly<{ url: string | null }>;
}>;

export type NavigationItem = Readonly<{ label: string; href: string }>;

export type PublicBootstrap = Readonly<{
  tenant: Readonly<{ id: string; name: string; primaryDomain: string }>;
  branding: Branding;
  template: string;
  features: Readonly<Record<string, boolean>>;
  navigation: readonly NavigationItem[];
  configuration: TenantConfiguration;
  configurationVersion: number;
}>;

export type PortalBootstrapDetails = Readonly<{
  tenant: Readonly<{ id: string; name: string; primaryDomain: string }>;
  contact: Readonly<{ email: string; phone: string; address: string }>;
  schoolBranding: TenantConfiguration['branding'];
  profile: Readonly<{
    id: string;
    displayName: string;
    email: string | null;
    avatarUrl: string | null;
  }>;
  portal: TenantConfiguration['portal'];
  portalFeatures: Readonly<Record<string, boolean>>;
  navigation: readonly NavigationItem[];
  schoolStatus: 'active' | 'suspended';
  unreadCounts: Readonly<Record<string, number>>;
  configurationVersion: number;
}>;

export interface BootstrapDirectory {
  loadPublic(bindings: Bindings, tenant: TenantContext): Promise<PublicBootstrap>;
  loadPortal(
    bindings: Bindings,
    tenant: TenantContext,
    userId: string,
  ): Promise<PortalBootstrapDetails>;
}

export type BackendServices = Readonly<{
  tenantDirectory: TenantDirectory;
  tokenVerifier: TokenVerifier;
  membershipDirectory: MembershipDirectory;
  readinessProbe: ReadinessProbe;
  bootstrapDirectory: BootstrapDirectory;
  configurationStudio: ConfigurationStudioGateway;
  academicStructure: AcademicStructureGateway;
  domainDirectory: DomainDirectoryGateway;
  jobs: JobGateway;
  corePortal: CorePortalGateway;
  payments: PaymentGateway;
  completePlatform: CompletePlatformGateway;
  platformStudio: PlatformStudioGateway;
  applicant: ApplicantGateway;
  communications: CommunicationsGateway;
}>;
