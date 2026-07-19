/**
 * Fetch vendors by account number via GetVendorsQuery and export to Excel.
 *
 * Uses a minimal Nest context (Vendor repo + GetVendorsHandler) so the script
 * can run under ts-node without bootstrapping the full AppModule.
 *
 * Usage (from D365FOMiddleware_Nestbackend):
 *   pnpm export:vendors-by-accounts
 *   docker compose exec app pnpm export:vendors-by-accounts
 *
 * Change the constants below as needed.
 */
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CqrsModule, QueryBus } from '@nestjs/cqrs';
import { MongooseModule } from '@nestjs/mongoose';

import { ExcelJsAdapter } from '@/modules/excel/adapters/exceljs.adapter';
import { ExcelService } from '@/modules/excel/excel.service';
import {
  IVendor,
  IVendorListFilter,
} from '@/modules/master-data/interfaces/vendor.interface';
import { GetVendorsQuery } from '@/modules/master-data/queries/get-vendors.query';
import { GetVendorsHandler } from '@/modules/master-data/queries/handlers/get-vendors.handler';
import { VendorRepository } from '@/modules/master-data/repositories/interfaces';
import { VendorMongoRepository } from '@/modules/master-data/repositories/vendor.mongo.repository';
import {
  Vendor,
  VendorSchema,
} from '@/modules/master-data/schemas/vendor.schema';
import { MasterDataService } from '@/modules/master-data/services/master-data.service';

/** Vendor account numbers to look up (case-insensitive exact match). */
const VENDOR_ACCOUNT_NUMBERS: string[] = [
  'Al-000001',
  'Al-000003',
  'Al-000004',
  'Al-000006',
  'Al-000007',
  'Al-000009',
  'Al-000015',
  'Al-000017',
  'Al-000019',
  'Al-000020',
  'Al-000021',
  'Al-000022',
  'Al-000024',
  'Al-000055',
  'RP-000001',
  'RP-000002',
  'RP-000004',
  'RP-000005',
  'RP-000007',
  'RP-000011',
  'Sl-000001',
  'Sl-000002',
  'Sl-000003',
  'Sl-000004',
  'Sl-000005',
  'Sl-000007',
  'Sl-000008',
  'Sl-000009',
  'Sl-000010',
  'Sl-000011',
  'Sl-000012',
  'Sl-000014',
  'Sl-000015',
  'Sl-000016',
  'Sl-000017',
  'Sl-000020',
  'Sl-000022',
  'Sl-000023',
  'Sl-000025',
  'Sl-000028',
  'Sl-000029',
  'Sl-000035',
  'Sl-000036',
  'Sl-000041',
  'Sl-000043',
  'Sl-000051',
  'Sl-000052',
  'Sl-000055',
  'Sl-000056',
  'Sl-000080',
  'Sl-000092',
  'Sl-000098',
  'Sl-000101',
  'Sl-000104',
  'Sl-000120',
  'Su-000083',
  'Su-000099',
];

/** Optional company filter. Leave undefined to search across all companies. */
const COMPANY: string | undefined = undefined;

/** Output path relative to cwd (or absolute). */
const OUTPUT_EXCEL_PATH = '.reports/vendors-by-account-numbers.xlsx';

function loadEnvFiles(): void {
  const environment = process.env.NODE_ENV ?? 'development';
  for (const envPath of [`.env.${environment}`, '.env.local', '.env']) {
    if (existsSync(envPath)) {
      process.loadEnvFile(envPath);
    }
  }
}

// Load env before Nest module metadata is evaluated (forRoot reads MONGODB_URI).
loadEnvFiles();

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI ?? '', {
      serverSelectionTimeoutMS: 15_000,
    }),
    MongooseModule.forFeature([{ name: Vendor.name, schema: VendorSchema }]),
    CqrsModule.forRoot(),
  ],
  providers: [
    { provide: VendorRepository, useClass: VendorMongoRepository },
    {
      provide: MasterDataService,
      useFactory: (vendorRepo: VendorRepository) =>
        ({
          getVendorsAsync: async (
            filter?: IVendorListFilter,
            skipCount?: number,
            maxCount?: number,
          ) => {
            const items = await vendorRepo.getList(filter ?? {}, {
              skipCount,
              maxCount,
            });
            const total = await vendorRepo.getCount(filter ?? {});
            return { items, total };
          },
        }) as Pick<MasterDataService, 'getVendorsAsync'> as MasterDataService,
      inject: [VendorRepository],
    },
    GetVendorsHandler,
  ],
})
class ExportVendorsScriptModule {}

async function exportVendorsByAccountNumbers(): Promise<void> {
  if (VENDOR_ACCOUNT_NUMBERS.length === 0) {
    throw new Error(
      'VENDOR_ACCOUNT_NUMBERS is empty. Add account numbers at the top of the script.',
    );
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not set.');
  }

  const app = await NestFactory.createApplicationContext(
    ExportVendorsScriptModule,
    {
      logger: ['error', 'warn', 'log'],
    },
  );

  try {
    const queryBus = app.get(QueryBus);
    const excelService = new ExcelService(new ExcelJsAdapter());

    console.info(
      `Fetching ${VENDOR_ACCOUNT_NUMBERS.length} vendor account number(s)` +
        (COMPANY ? ` for company ${COMPANY}` : '') +
        '…',
    );

    const result = await queryBus.execute(
      new GetVendorsQuery({
        company: COMPANY,
        accountNumbers: VENDOR_ACCOUNT_NUMBERS,
      }),
    );

    const vendors: IVendor[] = result.items ?? [];
    console.info(
      `Found ${vendors.length} vendor(s) (totalCount=${result.totalCount}).`,
    );

    const rows = vendors.map((v) => ({
      id: v.id,
      company: v.company,
      vendorAccountNumber: v.vendorAccountNumber,
      vendorOrganizationName: v.vendorOrganizationName ?? '',
      vendorSearchName: v.vendorSearchName ?? '',
      vendorGroupId: v.vendorGroupId ?? '',
      currencyCode: v.currencyCode ?? '',
      defaultPaymentTermsName: v.defaultPaymentTermsName ?? '',
      salesTaxGroupCode: v.salesTaxGroupCode ?? '',
      onHoldStatus: v.onHoldStatus ?? '',
    }));

    const requested = new Set(
      VENDOR_ACCOUNT_NUMBERS.map((a) => a.trim().toLowerCase()),
    );
    const found = new Set(
      vendors.map((v) => v.vendorAccountNumber.trim().toLowerCase()),
    );
    const missing = [...requested].filter((a) => !found.has(a));
    if (missing.length > 0) {
      console.warn(
        `Missing ${missing.length} account number(s): ${missing.join(', ')}`,
      );
    }

    const buffer = await excelService.jsonToExcel(rows);
    const outputPath = resolve(process.cwd(), OUTPUT_EXCEL_PATH);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, buffer);

    console.info(`Excel written to ${outputPath}`);
  } finally {
    await app.close();
  }
}

exportVendorsByAccountNumbers().catch((error: unknown) => {
  console.error('Failed to export vendors by account numbers.');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
