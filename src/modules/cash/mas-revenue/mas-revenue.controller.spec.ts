import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import request from 'supertest';

import { MasRevenueReviewService } from './mas-revenue-review.service';
import { MasRevenueController } from './mas-revenue.controller';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbookBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Row Data').addRow(['Date']);
  return Buffer.from(await workbook.xlsx.writeBuffer()) as Buffer;
}

describe('MAS Revenue HTTP contract', () => {
  let app: INestApplication;
  const service = {
    preview: jest.fn(),
    getReview: jest.fn(),
    getLines: jest.fn(),
    submit: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MasRevenueController],
      providers: [{ provide: MasRevenueReviewService, useValue: service }],
    }).compile();

    app = moduleRef.createNestApplication();
    // The test user comes from a header, standing in for the real authentication guard.
    app.use(
      (
        req: { headers: Record<string, string>; user?: unknown },
        _res: unknown,
        next: () => void,
      ) => {
        const id = req.headers['x-test-user'];
        if (id) req.user = { id, role: 'user' };
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const base = '/DataMigration/Cash';

  describe('template and guide', () => {
    it('serves the clean template with its file name and contract version', async () => {
      const res = await request(app.getHttpServer())
        .get(`${base}/CashIn-MAS-Revenue-Template`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(XLSX_TYPE);
      expect(res.headers['content-disposition']).toContain(
        'MAS-Revenue-Cash-In-Template-v1.xlsx',
      );
      expect(res.headers['x-template-version']).toBe('v1');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        res.body as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
      expect(workbook.worksheets.map((ws) => ws.name)).toEqual(['Row Data']);
      expect(workbook.getWorksheet('Row Data')!.getRow(1).cellCount).toBe(14);
      const zip = await JSZip.loadAsync(res.body as Buffer);
      expect(
        Object.keys(zip.files).some((name) => name.includes('externalLink')),
      ).toBe(false);
    });

    it('serves the column guide as Markdown', async () => {
      const res = await request(app.getHttpServer()).get(
        `${base}/CashIn-MAS-Revenue-Guide`,
      );
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.text).toContain('# MAS Revenue Cash In: upload template v1');
    });
  });

  describe('preview', () => {
    const preview = (fields: Record<string, string>) => {
      const req = request(app.getHttpServer())
        .post(`${base}/CashIn-MAS-Revenue-Preview`)
        .set('x-test-user', 'user-1');
      for (const [key, value] of Object.entries(fields)) req.field(key, value);
      return req;
    };

    it('uploads with companyId mas and returns the review', async () => {
      service.preview.mockResolvedValue({ reviewId: 'r1', uploadValid: true });
      const res = await preview({
        companyId: 'mas',
        templateVersion: '1',
        transactionCurrency: 'egp',
      }).attach('dataFile', await workbookBuffer(), {
        filename: 'upload.xlsx',
        contentType: XLSX_TYPE,
      });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ reviewId: 'r1', uploadValid: true });
      expect(service.preview).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'mas',
          templateVersion: 1,
          transactionCurrency: 'egp',
          user: { id: 'user-1', role: 'user' },
        }),
      );
    });

    it('rejects a missing or other company before any service call', async () => {
      const invalidFields: Array<Record<string, string>> = [
        { templateVersion: '1', transactionCurrency: 'EGP' },
        { companyId: 'm-p', templateVersion: '1', transactionCurrency: 'EGP' },
      ];
      for (const fields of invalidFields) {
        const res = await preview(fields).attach(
          'dataFile',
          await workbookBuffer(),
          {
            filename: 'upload.xlsx',
            contentType: XLSX_TYPE,
          },
        );
        expect(res.status).toBe(400);
      }
      expect(service.preview).not.toHaveBeenCalled();
    });

    it('rejects an unsupported template version', async () => {
      const res = await preview({
        companyId: 'mas',
        templateVersion: '2',
        transactionCurrency: 'EGP',
      }).attach('dataFile', await workbookBuffer(), {
        filename: 'upload.xlsx',
        contentType: XLSX_TYPE,
      });
      expect(res.status).toBe(400);
      expect(service.preview).not.toHaveBeenCalled();
    });

    it('rejects a request without a workbook', async () => {
      const res = await preview({
        companyId: 'mas',
        templateVersion: '1',
        transactionCurrency: 'EGP',
      });
      expect(res.status).toBe(400);
      expect(service.preview).not.toHaveBeenCalled();
    });

    it('rejects a file that is not an Excel workbook', async () => {
      const res = await preview({
        companyId: 'mas',
        templateVersion: '1',
        transactionCurrency: 'EGP',
      }).attach('dataFile', Buffer.from('plain text'), {
        filename: 'upload.csv',
        contentType: 'text/csv',
      });
      expect(res.status).toBe(400);
      expect(service.preview).not.toHaveBeenCalled();
    });

    it('requires an authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .post(`${base}/CashIn-MAS-Revenue-Preview`)
        .field('companyId', 'mas')
        .field('templateVersion', '1')
        .field('transactionCurrency', 'EGP')
        .attach('dataFile', await workbookBuffer(), {
          filename: 'upload.xlsx',
          contentType: XLSX_TYPE,
        });
      expect(res.status).toBe(401);
      expect(service.preview).not.toHaveBeenCalled();
    });
  });

  describe('submit', () => {
    const url = `${base}/CashIn-MAS-Revenue-Reviews/r1/submit`;
    const hash = 'b'.repeat(64);

    it('creates the batch for the reviewed snapshot with the user and the review id', async () => {
      service.submit.mockResolvedValue({ reviewId: 'r1', batchId: 'batch-1' });
      const res = await request(app.getHttpServer())
        .post(url)
        .set('x-test-user', 'user-1')
        .send({ reviewVersion: 1, payloadHash: hash, idempotencyKey: 'k1' });

      expect(res.status).toBe(201);
      expect(service.submit).toHaveBeenCalledWith(
        'r1',
        { reviewVersion: 1, payloadHash: hash, idempotencyKey: 'k1' },
        { id: 'user-1', role: 'user' },
      );
    });

    it('rejects an unknown review version, a bad hash and a missing key', async () => {
      const bodies = [
        { reviewVersion: 2, payloadHash: hash, idempotencyKey: 'k1' },
        { reviewVersion: 1, payloadHash: 'short', idempotencyKey: 'k1' },
        { reviewVersion: 1, payloadHash: hash },
      ];
      for (const body of bodies) {
        const res = await request(app.getHttpServer())
          .post(url)
          .set('x-test-user', 'user-1')
          .send(body);
        expect(res.status).toBe(400);
      }
      expect(service.submit).not.toHaveBeenCalled();
    });

    it('is not reachable without an authenticated user', async () => {
      const res = await request(app.getHttpServer())
        .post(url)
        .send({ reviewVersion: 1, payloadHash: hash, idempotencyKey: 'k1' });
      expect(res.status).toBe(401);
      expect(service.submit).not.toHaveBeenCalled();
    });
  });
});
