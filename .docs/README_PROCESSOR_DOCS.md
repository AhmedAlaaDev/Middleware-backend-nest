# Processor Documentation Generator

This directory contains tools to generate HTML documentation for processor types.

## Files

- **`processor-docs-data.json`** - Data file containing processor-specific information (editable)
- **`generate-processor-docs.py`** - Python script that generates HTML from the data file
- **`CLOSING_PROCESSORS.html`** - Generated documentation for closing entry processors
- **`VENDOR_PROCESSORS.html`** - Generated documentation for vendor (AP) processors
- **`CASH_PROCESSORS.html`** - Generated documentation for cash-in-freight (Cust-Pay) processors

## How to Update Documentation

### Step 1: Edit the Data File

Open `processor-docs-data.json` and update the relevant sections:

- **Processors**: Add/remove/modify processor entries
- **Required Dimensions**: Update dimension lists for each processor type
- **Input Columns**: Modify column definitions
- **Special Behaviors**: Update behavior descriptions

### Step 2: Regenerate HTML

Run the Python script to regenerate the HTML files:

```bash
cd .docs
python generate-processor-docs.py
```

Or on Windows PowerShell:
```powershell
cd .docs
python generate-processor-docs.py
```

The script will:
- Read `processor-docs-data.json`
- Generate `CLOSING_PROCESSORS.html`
- Generate `VENDOR_PROCESSORS.html`
- Generate `CASH_PROCESSORS.html`

## Data File Structure

The JSON file has two main sections:

### `closing`
- `title`: Page title
- `description`: Page description
- `overview`: Overview text
- `processors`: Array of processor objects
- `requiredDimensions`: Dimension lists (common and truckingOnly)
- `inputColumns`: Array of column definitions

### `vendor`
- Same structure as `closing`
- Additional `specialBehaviors` object for vendor-specific behaviors

## Processor Object Structure

```json
{
  "name": "ProcessorClassName",
  "serviceType": "Freight" or "Trucking",
  "journalName": "Journal name in D365FO",
  "entryProcessorType": "Enum value",
  "canInsertToD365": true or false,
  "description": "Description template"
}
```

## Column Object Structure

```json
{
  "name": "COLUMNNAME",
  "type": "Number" or "String" or "Date" or "Boolean",
  "required": true or false,
  "description": "Column description"
}
```

## Notes

- The HTML template matches the style of `ACCOUNT_RECEIVABLE_PROCESSORS.html`
- All HTML is generated automatically - do not edit the HTML files directly
- Make changes in the JSON file and regenerate
- The script preserves the exact styling and structure of the original documentation
