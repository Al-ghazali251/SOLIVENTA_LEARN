import type { Permission } from '../permissions/permissions';
import type { Role } from '../permissions/roles';

export type DomainType = 'public' | 'portal' | 'platform';

export type TenantContext = Readonly<{
  schoolId: string;
  hostname: string;
  domainType: DomainType;
  configurationVersion: number;
  configurationVersionId: string;
}>;

export type PrincipalContext = Readonly<{
  userId: string;
  token: string;
}>;

export type AuthorizationScope = Readonly<{
  kind: 'school-wide' | 'assigned-resources' | 'linked-children' | 'self' | 'platform';
}>;

export type AuthContext = Readonly<{
  userId: string;
  schoolId: string;
  roles: readonly Role[];
  roleCodes?: readonly string[];
  permissions: ReadonlySet<Permission>;
  scope: AuthorizationScope;
  membershipId?: string | null;
  membershipKind?:
    'applicant' | 'guardian' | 'student' | 'teacher' | 'administrator' | 'specialist' | null;
  lifecycleState?: string | null;
  resourceScopes?: Readonly<Record<string, unknown>>;
  supportSession?: Readonly<{ id:string;operatorId:string;targetAccountId:string;reason:string;expiresAt:string }>;
}>;

export type AppVariables = {
  requestId: string;
  requestHostname: string;
  tenant: TenantContext;
  principal: PrincipalContext;
  auth: AuthContext;
  requiredPermission: Permission;
  errorCode?: string;
};
