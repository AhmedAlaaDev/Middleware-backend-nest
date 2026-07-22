const { MongoClient, ObjectId } = require('mongodb');

async function run() {
  const uri = 'mongodb://root:sp3awi@localhost:27017/d365fo?authSource=admin';
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const database = client.db('d365fo');
    const batches = database.collection('data_batches');

    // Get the most recent CashOutFreightEntryProcessor batch
    const batch = await batches.find({ entryProcessorType: 22 }).sort({ _id: -1 }).limit(1).toArray();
    
    if (batch.length > 0) {
      console.log('--- LATEST BATCH IN MONGODB ---');
      console.log(JSON.stringify(batch[0], null, 2));
      
      const records = database.collection('data_records');
      const batchRecords = await records.find({ batchId: batch[0]._id }).toArray();
      console.log(`\n--- RECORDS FOR BATCH (${batchRecords.length}) ---`);
      for (const r of batchRecords) {
        console.log(`Record Status: ${r.status}, Error: ${r.errorMessage}`);
      }
    } else {
      console.log('No batches found');
    }
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
