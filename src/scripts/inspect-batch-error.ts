/**
 * Script to inspect batch errors from MongoDB
 * Usage: ts-node -r tsconfig-paths/register src/scripts/inspect-batch-error.ts <batchId>
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';

import { DataBatchService } from '@/modules/data-batch/services/data-batch.service';

async function main(): Promise<void> {
  const batchId = process.argv[2];

  if (!batchId) {
    console.error(
      'Usage: ts-node -r tsconfig-paths/register src/scripts/inspect-batch-error.ts <batchId>',
    );
    process.exit(1);
  }

  console.log(`\n🔍 Inspecting batch: ${batchId}\n`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const dataBatchService = app.get(DataBatchService);

  try {
    // Get batch info
    const batch = await dataBatchService.getByIdAsync(batchId);

    if (!batch) {
      console.error(`❌ Batch not found: ${batchId}`);
      process.exit(1);
    }

    console.log('📦 Batch Information:');
    console.log(`  ID: ${batch.id}`);
    console.log(`  Status: ${batch.status}`);
    console.log(`  Processor Type: ${batch.entryProcessorType}`);
    console.log(`  Processor Name: ${batch.entryProcessorName}`);
    console.log(`  Company: ${batch.company}`);
    console.log(`  Description: ${batch.description || 'N/A'}`);
    console.log(`  Created: ${batch.creationDate?.toISOString() ?? 'N/A'}`);
    console.log(`  Total Uploaded: ${batch.totalUploadedCount}`);
    console.log(`  Total Formatted: ${batch.totalFormattedCount}`);
    console.log(`  Success Count: ${batch.successCount}`);
    console.log(`  Error Count: ${batch.errorCount}`);

    if (batch.dfoPostingErrors && batch.dfoPostingErrors.length > 0) {
      console.log(
        `\n🔴 D365FO Posting Errors (${batch.dfoPostingErrors.length}):`,
      );
      batch.dfoPostingErrors.forEach((error: string, index: number) => {
        console.log(`\n  [${index + 1}] ${error}`);
      });
    }

    if (batch.dfoIds && batch.dfoIds.length > 0) {
      console.log(
        `\n✅ Successfully Posted D365FO IDs (${batch.dfoIds.length}):`,
      );
      batch.dfoIds.forEach((id: string) => {
        console.log(`  - ${id}`);
      });
    }

    // Get validation errors
    if (batch.errorCount > 0) {
      console.log(`\n🔴 Validation Errors:`);
      const errors = await dataBatchService.getErrorsAsync(batchId);

      for (const error of errors) {
        console.log(
          `\n  Source Record IDs: ${error.sourceRecordIds?.join(', ')}`,
        );
        console.log(`  Error Messages:`);
        error.errorMessages.forEach((msg: string) => {
          console.log(`    - ${msg}`);
        });

        if (error.enhancedData) {
          console.log(`  Enhanced Data Sample:`);
          const data = Array.isArray(error.enhancedData)
            ? error.enhancedData[0]
            : error.enhancedData;
          console.log(`    UniqueId: ${data.UniqueId || 'N/A'}`);
          console.log(`    PaymentId: ${data.PaymentId || 'N/A'}`);
          console.log(`    AccountType: ${data.AccountType || 'N/A'}`);
          console.log(
            `    Offset AccountType: ${data.OffsetAccountType || 'N/A'}`,
          );
        }
      }
    }

    console.log('\n✅ Inspection complete\n');
  } catch (error) {
    console.error('❌ Error inspecting batch:', error);
    throw error;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('Failed to inspect batch error.');
  console.error(error);
  process.exitCode = 1;
});
