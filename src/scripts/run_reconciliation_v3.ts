import fs from 'fs';
import path from 'path';
import { ReconciliationService } from '../modules/reconciliation/reconciliation.service';

async function run() {
  const bankPath = 'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\ALL banks 31-5-2026 update.xlsx';
  const istPath = 'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\IST Report from jan to apr 2026.xlsx';

  console.log('Reading files...');
  const bankBuffer = fs.readFileSync(bankPath);
  const istBuffer = fs.readFileSync(istPath);

  const service = new ReconciliationService();
  const options = service.parseOptions({
    toleranceDays: 3,
    amountTolerance: 0.01,
    amountTolerancePercent: 0.05,
    amountToleranceCap: 100,
    confidenceThreshold: 0.75,
    audit: true,
    allowManyToOne: false,
    forceAll: true
  });

  console.log('Running reconciliation engine (Version 3)...');
  const result = await service.reconcileWithReport(istBuffer, bankBuffer, options);

  console.log('\n================ RECONCILIATION SUMMARY (VERSION 3) ================');
  console.log(JSON.stringify(result.report.summary, null, 2));

  console.log('\nSaving output workbook...');
  const outPath = 'e:\\OneDrive - MESCO\\Desktop\\MiddleWare\\D365FOMiddleware_Nestbackend\\IST_Report_After_Matching_Version3.xlsx';
  fs.writeFileSync(outPath, result.workbook);
  console.log(`Saved result to: ${outPath}`);
}

run().catch(err => {
  console.error('Error running reconciliation:', err);
  process.exit(1);
});
