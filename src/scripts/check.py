import pandas as pd
df = pd.read_json(r'e:\OneDrive - MESCO\Desktop\MiddleWare\D365FOMiddleware_Nestbackend\src\scripts\test_data.json')
withholding = df[(df['ACCOUNTTYPE'] == 'Ledger') & (df['ACCOUNTDISPLAYVALUE'].astype(str).str.startswith('223304'))]
print('Withholding lines count:', len(withholding))
for idx, row in withholding.iterrows():
    print(f"Voucher: {row['VOUCHER']}, Invoice: {row['INVOICE']}, Amount: {row['CREDITAMOUNT']} {row['DEBITAMOUNT']}")
