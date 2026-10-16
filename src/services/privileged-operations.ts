import { assertPermission, assertSchoolScope } from '../permissions/authorize';
import type { Role } from '../permissions/roles';
import type { AuthContext } from '../types/context';

type SchoolRole = Exclude<Role, 'moderator'>;

export type IdentityGateway = {
  provision(
    input: Readonly<{ schoolId: string; email: string; role: SchoolRole; invitedBy: string }>,
  ): Promise<{ userId: string }>;
};

export class IdentityProvisioningService {
  constructor(private readonly gateway: IdentityGateway) {}

  provision(
    context: AuthContext,
    input: Readonly<{ schoolId: string; email: string; role: SchoolRole }>,
  ) {
    assertSchoolScope(context, input.schoolId);
    assertPermission(context, 'staff.manage');
    return this.gateway.provision({ ...input, invitedBy: context.userId });
  }
}

export type PaymentGateway = {
  recordVerified(
    input: Readonly<{
      schoolId: string;
      studentId: string;
      reference: string;
      amountMinor: number;
      provider: string;
      recordedBy: string;
      paidAt: string;
    }>,
  ): Promise<void>;
};

export class PaymentVerificationService {
  constructor(private readonly gateway: PaymentGateway) {}

  record(
    context: AuthContext,
    input: Readonly<{
      schoolId: string;
      studentId: string;
      reference: string;
      amountMinor: number;
      provider: string;
      paidAt: string;
      providerVerified: true;
    }>,
  ) {
    assertSchoolScope(context, input.schoolId);
    assertPermission(context, 'payments.verify');
    return this.gateway.recordVerified({ ...input, recordedBy: context.userId });
  }
}

export type DomainGateway = {
  createPending(
    input: Readonly<{
      schoolId: string;
      hostname: string;
      domainType: 'public_site' | 'portal';
      verificationTokenHash: string;
    }>,
  ): Promise<void>;
};

export class DomainProvisioningService {
  constructor(private readonly gateway: DomainGateway) {}

  async create(
    context: AuthContext,
    input: Readonly<{
      schoolId: string;
      hostname: string;
      domainType: 'public_site' | 'portal';
      verificationToken: string;
    }>,
  ) {
    assertSchoolScope(context, input.schoolId);
    assertPermission(context, 'domains.manage');
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(input.verificationToken),
    );
    const verificationTokenHash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return this.gateway.createPending({
      schoolId: input.schoolId,
      hostname: input.hostname,
      domainType: input.domainType,
      verificationTokenHash,
    });
  }
}

export type ModeratorGateway = {
  setSchoolStatus(
    input: Readonly<{ schoolId: string; status: 'active' | 'suspended' }>,
  ): Promise<void>;
};

export class ModeratorService {
  constructor(private readonly gateway: ModeratorGateway) {}

  setSchoolStatus(
    context: AuthContext,
    input: Readonly<{ schoolId: string; status: 'active' | 'suspended' }>,
  ) {
    assertPermission(context, 'platform.schools.manage');
    return this.gateway.setSchoolStatus(input);
  }
}
