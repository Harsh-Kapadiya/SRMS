import { eq } from 'drizzle-orm';
import { users } from '@srms/db';
import { maskAadhaar } from '@srms/shared';
import { db } from './db';
import { notFound } from './http';

/** The logged-in user as the web apps see it (never includes Aadhaar ciphertext or password hash). */
export async function profileFor(userId: string) {
  const u = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { passwordHash: false },
    with: {
      beneficiary: {
        columns: { aadhaarEnc: false, aadhaarHash: false },
        with: {
          district: true,
          homeShop: { columns: { id: true, shopCode: true, name: true, address: true, status: true } },
          familyMembers: { columns: { beneficiaryId: false } },
        },
      },
      dealer: {
        with: {
          district: true,
          shops: { columns: { id: true, shopCode: true, name: true, address: true, status: true } },
        },
      },
      official: { with: { district: true } },
    },
  });
  if (!u) throw notFound('User');
  const b = u.beneficiary;
  return {
    ...u,
    beneficiary: b
      ? { ...b, aadhaarMasked: maskAadhaar(b.aadhaarLast4), familySize: Math.max(1, b.familyMembers.length) }
      : null,
  };
}
