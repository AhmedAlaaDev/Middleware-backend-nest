/**
 * Quick MongoDB query for batch error
 * Usage: node src/scripts/quick-batch-query.mjs <batchId>
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://root:sp3awi@localhost:27017/d365fo?authSource=admin';
const batchId = process.argv[2];

if (!batchId) {
  console.error('Usage: node src/scripts/quick-batch-query.mjs <batchId>');
  process.exit(1);
}

console.log(`\n🔍 Querying batch: ${batchId}\n`);

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  const db = client.db();
  
  // Get batch
  const batch = await db.collection('data_batches').findOne({ _id: batchId });
  
  if (!batch) {
    console.error(`❌ Batch not found: ${batchId}`);
    process.exit(1);
  }

  console.log('📦 Batch Information:');
  console.log(`  ID: ${batch._id}`);
  console.log(`  Status: ${batch.status}`);
  console.log(`  Processor Type: ${batch.entryProcessorType}`);
  console.log(`  Processor Name: ${batch.entryProcessorName}`);
  console.log(`  Company: ${batch.company}`);
  console.log(`  Description: ${batch.description || 'N/A'}`);
  console.log(`  Total Uploaded: ${batch.totalUploadedCount}`);
  console.log(`  Total Formatted: ${batch.totalFormattedCount}`);
  console.log(`  Success Count: ${batch.successCount}`);
  console.log(`  Error Count: ${batch.errorCount}`);
  
  if (batch.dfoPostingErrors && batch.dfoPostingErrors.length > 0) {
    console.log(`\n🔴 D365FO Posting Errors (${batch.dfoPostingErrors.length}):`);
    batch.dfoPostingErrors.forEach((error, index) => {
      console.log(`\n  [${index + 1}] ${error}`);
    });
  }

  if (batch.dfoAttemptedIds && batch.dfoAttemptedIds.length > 0) {
    console.log(`\n📝 Attempted D365FO IDs (${batch.dfoAttemptedIds.length}):`);
    batch.dfoAttemptedIds.slice(0, 10).forEach((id) => {
      console.log(`  - ${id}`);
    });
    if (batch.dfoAttemptedIds.length > 10) {
      console.log(`  ... and ${batch.dfoAttemptedIds.length - 10} more`);
    }
  }

  if (batch.dfoIds && batch.dfoIds.length > 0) {
    console.log(`\n✅ Successfully Posted D365FO IDs (${batch.dfoIds.length}):`);
    batch.dfoIds.slice(0, 10).forEach((id) => {
      console.log(`  - ${id}`);
    });
    if (batch.dfoIds.length > 10) {
      console.log(`  ... and ${batch.dfoIds.length - 10} more`);
    }
  }

  // Get validation errors
  if (batch.errorCount > 0) {
    console.log(`\n🔴 Validation Errors:`);
    const errors = await db.collection('data_batch_errors')
      .find({ batchId: batchId })
      .limit(5)
      .toArray();
    
    for (const error of errors) {
      console.log(`\n  Error ID: ${error._id}`);
      if (error.sourceRecordIds) {
        console.log(`  Source Record IDs: ${error.sourceRecordIds.join(', ')}`);
      }
      console.log(`  Error Messages:`);
      error.errorMessages.forEach((msg) => {
        console.log(`    - ${msg}`);
      });
      
      if (error.enhancedData) {
        console.log(`  Enhanced Data Sample:`);
        const data = Array.isArray(error.enhancedData) 
          ? error.enhancedData[0] 
          : error.enhancedData;
        if (data) {
          console.log(`    UniqueId: ${data.UniqueId || 'N/A'}`);
          console.log(`    PaymentId: ${data.PaymentId || 'N/A'}`);
          console.log(`    AccountType: ${data.AccountType || 'N/A'}`);
          console.log(`    OffsetAccountType: ${data.OffsetAccountType || 'N/A'}`);
          console.log(`    Currency: ${data.Currency || 'N/A'}`);
          console.log(`    Amount: ${data.Amount || 'N/A'}`);
        }
      }
    }
    
    if (errors.length < batch.errorCount) {
      console.log(`\n  ... and ${batch.errorCount - errors.length} more errors`);
    }
  }

  // Get some enhanced records to see the data structure
  console.log(`\n📄 Sample Enhanced Records (first 3):`);
  const enhancedRecords = await db.collection('data_enhanced_records')
    .find({ batchId: batchId })
    .limit(3)
    .toArray();
  
  enhancedRecords.forEach((record, index) => {
    console.log(`\n  [${index + 1}] ${JSON.stringify(record.data, null, 2)}`);
  });

  console.log('\n✅ Query complete\n');

} catch (error) {
  console.error('❌ Error querying batch:', error);
  throw error;
} finally {
  await client.close();
}
