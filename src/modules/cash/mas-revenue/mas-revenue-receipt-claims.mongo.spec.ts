/**
 * Real-database checks for the receipt claims: the unique indexes, not the in-memory
 * fake, decide concurrent reservations. Runs only when MAS_REVENUE_TEST_MONGO_URI is
 * set, and must point at an isolated test database (never a connected or shared one).
 *
 *   MAS_REVENUE_TEST_MONGO_URI=mongodb://localhost:27027/mas_revenue_identity_test
 */
import { Connection, createConnection } from 'mongoose';

import { masRevenueIdentity } from './mas-revenue-identity';
import {
  MasRevenueReceiptClaim,
  MasRevenueReceiptClaimSchema,
  MasRevenueReview,
  MasRevenueReviewLine,
  MasRevenueReviewLineSchema,
  MasRevenueReviewSchema,
} from './mas-revenue-review.schema';
import {
  MongoMasRevenueReviewStore,
  type NewMasRevenueReceiptClaim,
} from './mas-revenue-review.store';

const uri = process.env.MAS_REVENUE_TEST_MONGO_URI;
const describeWithMongo = uri ? describe : describe.skip;

function claimFor(
  invoiceNumber: string,
  transactionDate: string,
): NewMasRevenueReceiptClaim {
  const identity = masRevenueIdentity({ transactionDate, invoiceNumber });
  return {
    company: 'mas',
    identityKey: identity.key,
    paymentIdBase: identity.paymentIdBase,
    invoiceNumber,
    year: identity.year,
    fingerprint: `fp-${invoiceNumber}-${identity.year}`,
  };
}

describeWithMongo(
  'MongoMasRevenueReviewStore receipt claims (real unique indexes)',
  () => {
    let connection: Connection;
    let store: MongoMasRevenueReviewStore;
    let claims: ReturnType<Connection['model']>;
    let lines: ReturnType<Connection['model']>;

    beforeAll(async () => {
      connection = await createConnection(uri as string).asPromise();
      await connection.db?.dropDatabase();
      const reviews = connection.model(
        MasRevenueReview.name,
        MasRevenueReviewSchema,
      );
      lines = connection.model(
        MasRevenueReviewLine.name,
        MasRevenueReviewLineSchema,
      );
      claims = connection.model(
        MasRevenueReceiptClaim.name,
        MasRevenueReceiptClaimSchema,
      );
      await reviews.init();
      await lines.init();
      await claims.init();
      store = new MongoMasRevenueReviewStore(
        reviews as never,
        lines as never,
        claims as never,
      );
    });

    afterAll(async () => {
      await connection.db?.dropDatabase();
      await connection.close();
    });

    beforeEach(async () => {
      await claims.deleteMany({});
    });

    it('creates both unique indexes on the claims collection', async () => {
      const indexes = await claims.collection.indexes();
      expect(indexes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'uniq_company_identity',
            unique: true,
          }),
          expect.objectContaining({
            name: 'uniq_company_payment_id_base',
            unique: true,
          }),
        ]),
      );
    });

    it('of two concurrent reservations of the same receipt, exactly one succeeds', async () => {
      const same = claimFor('1', '2026-10-28');
      const results = await Promise.all([
        store.claimReceiptIdentities('review-a', [same]),
        store.claimReceiptIdentities('review-b', [same]),
      ]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toEqual({
        ok: false,
        reason: 'IDENTITY_TAKEN',
      });
      expect(
        await claims.countDocuments({ identityKey: same.identityKey }),
      ).toBe(1);
    });

    it('a refused reservation leaves no partial claim of its own review', async () => {
      await store.claimReceiptIdentities('review-owner', [
        claimFor('7', '2026-10-28'),
      ]);
      const batch = [claimFor('8', '2026-10-28'), claimFor('7', '2026-10-28')];

      const result = await store.claimReceiptIdentities('review-late', batch);

      expect(result.ok).toBe(false);
      expect(await claims.countDocuments({ reviewId: 'review-late' })).toBe(0);
      expect(await claims.countDocuments({ invoiceNumber: '8' })).toBe(0);
    });

    it('the same invoice in another year is a distinct claim; a PaymentId base collision is refused', async () => {
      expect(
        await store.claimReceiptIdentities('review-2026', [
          claimFor('9', '2026-10-28'),
        ]),
      ).toEqual({ ok: true });
      expect(
        await store.claimReceiptIdentities('review-2027', [
          claimFor('9', '2027-01-05'),
        ]),
      ).toEqual({ ok: true });

      const forged = {
        ...claimFor('10', '2026-10-28'),
        paymentIdBase: claimFor('9', '2026-10-28').paymentIdBase,
      };
      expect(
        await store.claimReceiptIdentities('review-forged', [forged]),
      ).toEqual({
        ok: false,
        reason: 'PAYMENT_ID_TAKEN',
      });
    });

    it('release removes only this review without a batch; attach records the batch', async () => {
      await store.claimReceiptIdentities('review-kept', [
        claimFor('11', '2026-10-28'),
      ]);
      await store.claimReceiptIdentities('review-failed', [
        claimFor('12', '2026-10-28'),
      ]);

      await store.releaseUnbatchedReceiptClaims('review-failed');
      expect(await claims.countDocuments({ reviewId: 'review-failed' })).toBe(
        0,
      );

      await store.attachBatchToReceiptClaims('review-kept', 'batch-42');
      const kept = (await claims
        .findOne({ reviewId: 'review-kept' })
        .lean()) as unknown as {
        batchId?: string;
      } | null;
      expect(kept?.batchId).toBe('batch-42');
    });

    it('releaseBatchReceipts removes the claims and clears the lines of a deleted batch', async () => {
      await store.claimReceiptIdentities('review-del', [
        claimFor('21', '2026-10-28'),
      ]);
      await store.attachBatchToReceiptClaims('review-del', 'batch-gone');
      await (
        lines as unknown as { create: (doc: unknown) => Promise<unknown> }
      ).create({
        reviewId: 'review-del',
        company: 'mas',
        position: 1,
        invoiceNumber: '21',
        transactionDate: '2026-10-28',
        currency: '',
        raw: { InvoiceNumber: '21' },
        batchId: 'batch-gone',
      });

      await store.releaseBatchReceipts('batch-gone');

      expect(await claims.countDocuments({ batchId: 'batch-gone' })).toBe(0);
      expect(await store.findSubmittedReceiptLines('mas', ['21'])).toEqual([]);
      // The identity can be claimed again.
      expect(
        await store.claimReceiptIdentities('review-new', [
          claimFor('21', '2026-10-28'),
        ]),
      ).toEqual({ ok: true });
    });

    it('findReceiptClaims returns claims of every year for the invoice', async () => {
      await store.claimReceiptIdentities('review-y1', [
        claimFor('13', '2026-10-28'),
      ]);
      await store.claimReceiptIdentities('review-y2', [
        claimFor('13', '2027-01-05'),
      ]);
      const found = await store.findReceiptClaims('mas', ['13']);
      expect(found.map((c) => c.year).sort()).toEqual([2026, 2027]);
    });
  },
);
