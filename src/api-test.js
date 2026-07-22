const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

async function runTest() {
  const filePath = 'src/excel-sources/Cash/Test_Slice.xlsx';
  const form = new FormData();
  form.append('dataFile', fs.createReadStream(filePath));
  form.append('companyId', 'm-p');

  try {
    console.log('Uploading sliced Excel file to http://localhost:3001/api/v1/DataMigration/Cash/CashOut-Freight-Document ...');
    const uploadRes = await axios.post('http://localhost:3001/api/v1/DataMigration/Cash/CashOut-Freight-Document', form, {
      headers: {
        ...form.getHeaders()
      }
    });

    console.log('Upload response:', uploadRes.data);
    const batchId = uploadRes.data?.data?.id;
    
    if (!batchId) {
       console.log('No batchId found in response', uploadRes.data);
       return;
    }

    console.log('Waiting 10 seconds for the background job to finish processing the excel...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    console.log(`\nTriggering PostToDFO with batchId: ${batchId}...`);
    const postRes = await axios.post('http://localhost:3001/api/v1/DataMigration/Cash/PostToDFO', {
      batchId: batchId
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('PostToDFO Response:');
    console.log(JSON.stringify(postRes.data, null, 2));
    
  } catch (error) {
    console.error('Error during test:');
    if (error.response) {
      console.error(error.response.status, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

runTest();
