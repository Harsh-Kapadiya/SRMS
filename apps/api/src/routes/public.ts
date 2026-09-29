import { Router } from 'express';
import { and, asc, eq } from 'drizzle-orm';
import { commodities, districts, shops } from '@srms/db';
import { z } from 'zod';
import { db } from '../db';

/** Reference data needed before login (registration form). */
export const publicRouter = Router();

publicRouter.get('/districts', async (_req, res) => {
  res.set('cache-control', 'public, max-age=3600');
  res.json(await db.select().from(districts).orderBy(asc(districts.name)));
});

publicRouter.get('/shops', async (req, res) => {
  const { districtId } = z.object({ districtId: z.coerce.number().int().positive() }).parse(req.query);
  res.json(
    await db
      .select({ id: shops.id, shopCode: shops.shopCode, name: shops.name, address: shops.address })
      .from(shops)
      .where(and(eq(shops.districtId, districtId), eq(shops.status, 'ACTIVE')))
      .orderBy(asc(shops.name)),
  );
});

publicRouter.get('/commodities', async (_req, res) => {
  res.json(await db.select().from(commodities).where(eq(commodities.isActive, true)).orderBy(asc(commodities.sortOrder)));
});
