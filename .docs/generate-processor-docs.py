#!/usr/bin/env python3
"""
Script to generate HTML documentation for processor types.
Reads processor data from processor-docs-data.json and generates HTML files.
"""

import json
import os
from datetime import datetime
from pathlib import Path

def escape_html(text):
    """Escape HTML special characters."""
    if text is None:
        return ""
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def generate_dimension_table(dimensions, trucking_only=None):
    """Generate HTML for dimension validation list."""
    html = '<div class="validation-list">\n'
    for dim in dimensions:
        html += f'        <div class="validation-item"><h5>{dim}</h5><p><span class="required">Required</span> - Must exist in {dim} dimension. Cannot be empty or "000".</p></div>\n'
    if trucking_only:
        for dim in trucking_only:
            html += f'        <div class="validation-item"><h5>{dim}</h5><p><span class="required">Required</span> - Must exist in {dim} dimension. Cannot be empty or "000".</p></div>\n'
    html += '      </div>'
    return html

def generate_input_table(columns):
    """Generate HTML table for input columns."""
    html = '            <table>\n                <thead>\n                    <tr>\n                        <th>Column Name</th>\n                        <th>Type</th>\n                        <th>Required</th>\n                        <th>Description</th>\n                    </tr>\n                </thead>\n                <tbody>\n'
    for col in columns:
        req_class = 'required' if col['required'] else 'optional'
        req_text = 'Required' if col['required'] else 'Optional'
        html += f'                    <tr>\n                        <td><span class="code">{escape_html(col["name"])}</span></td>\n                        <td>{escape_html(col["type"])}</td>\n                        <td class="{req_class}">{req_text}</td>\n                        <td>{escape_html(col["description"])}</td>\n                    </tr>\n'
    html += '                </tbody>\n            </table>'
    return html

def generate_processor_table(processors):
    """Generate HTML table for processors."""
    html = '            <table class="comparison-table">\n                <thead>\n                    <tr>\n                        <th>Processor</th>\n                        <th>Service Type</th>\n                        <th>Journal Name</th>\n                        <th>Can Insert to D365</th>\n                    </tr>\n                </thead>\n                <tbody>\n'
    for proc in processors:
        badge_class = "badge-trucking" if proc['serviceType'] == 'Trucking' else "badge-freight"
        can_insert = '<span class="check">Yes</span>' if proc['canInsertToD365'] else '<span class="cross">No</span>'
        html += f'                    <tr>\n                        <td>\n                            <span class="processor-badge {badge_class}">{escape_html(proc["serviceType"])}</span>\n                        </td>\n                        <td>{escape_html(proc["serviceType"])}</td>\n                        <td><span class="code">{escape_html(proc["journalName"])}</span></td>\n                        <td>{can_insert}</td>\n                    </tr>\n'
    html += '                </tbody>\n            </table>'
    return html

def generate_html(data, output_file):
    """Generate complete HTML documentation."""
    
    title = data['title']
    description = data['description']
    overview = data['overview']
    processors = data['processors']
    input_columns = data['inputColumns']
    
    # Determine if this is closing or vendor
    is_closing = 'closing' in output_file.lower()
    
    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - Technical Documentation</title>
    <style>
        :root {{
            --primary-color: #2563eb;
            --primary-dark: #1d4ed8;
            --secondary-color: #64748b;
            --success-color: #16a34a;
            --warning-color: #d97706;
            --error-color: #dc2626;
            --bg-color: #f8fafc;
            --card-bg: #ffffff;
            --text-color: #1e293b;
            --text-muted: #64748b;
            --border-color: #e2e8f0;
        }}

        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}

        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            line-height: 1.6;
        }}

        .container {{
            max-width: 1200px;
            margin: 0 auto;
            padding: 40px 20px;
        }}

        header {{
            text-align: center;
            margin-bottom: 50px;
            padding-bottom: 30px;
            border-bottom: 2px solid var(--border-color);
        }}

        header h1 {{
            font-size: 2.5rem;
            color: var(--primary-color);
            margin-bottom: 10px;
        }}

        header p {{
            font-size: 1.1rem;
            color: var(--text-muted);
        }}

        .toc {{
            background: var(--card-bg);
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 40px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}

        .toc h2 {{
            color: var(--primary-color);
            margin-bottom: 20px;
            font-size: 1.3rem;
        }}

        .toc ul {{
            list-style: none;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 10px;
        }}

        .toc a {{
            color: var(--text-color);
            text-decoration: none;
            padding: 8px 15px;
            display: block;
            border-radius: 6px;
            transition: all 0.2s;
        }}

        .toc a:hover {{
            background: var(--bg-color);
            color: var(--primary-color);
        }}

        section {{
            background: var(--card-bg);
            border-radius: 12px;
            padding: 35px;
            margin-bottom: 30px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}

        section h2 {{
            color: var(--primary-color);
            font-size: 1.6rem;
            margin-bottom: 25px;
            padding-bottom: 15px;
            border-bottom: 2px solid var(--border-color);
        }}

        section h3 {{
            color: var(--text-color);
            font-size: 1.25rem;
            margin: 25px 0 15px 0;
        }}

        section h4 {{
            color: var(--secondary-color);
            font-size: 1.1rem;
            margin: 20px 0 12px 0;
        }}

        p {{
            margin-bottom: 15px;
        }}

        .processor-badge {{
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
            margin-right: 8px;
            margin-bottom: 8px;
        }}

        .badge-trucking {{
            background: #dbeafe;
            color: #1d4ed8;
        }}

        .badge-freight {{
            background: #dcfce7;
            color: #16a34a;
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 0.95rem;
        }}

        th, td {{
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
        }}

        th {{
            background: var(--bg-color);
            font-weight: 600;
            color: var(--text-color);
        }}

        tr:hover {{
            background: #f9fafb;
        }}

        .required {{
            color: var(--error-color);
            font-weight: bold;
        }}

        .optional {{
            color: var(--secondary-color);
        }}

        .code {{
            background: #f1f5f9;
            padding: 2px 8px;
            border-radius: 4px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 0.9em;
            color: var(--primary-dark);
        }}

        .code-block {{
            background: #1e293b;
            color: #e2e8f0;
            padding: 20px;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 0.9rem;
            margin: 15px 0;
        }}

        .code-block .comment {{
            color: #6b7280;
        }}

        .code-block .string {{
            color: #34d399;
        }}

        .code-block .keyword {{
            color: #f472b6;
        }}

        .info-box {{
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
        }}

        .info-box.note {{
            background: #eff6ff;
            border-left: 4px solid var(--primary-color);
        }}

        .info-box.warning {{
            background: #fffbeb;
            border-left: 4px solid var(--warning-color);
        }}

        .info-box.success {{
            background: #f0fdf4;
            border-left: 4px solid var(--success-color);
        }}

        .info-box.error {{
            background: #fef2f2;
            border-left: 4px solid var(--error-color);
        }}

        .info-box strong {{
            display: block;
            margin-bottom: 8px;
        }}

        .flow-diagram {{
            display: flex;
            align-items: center;
            justify-content: center;
            flex-wrap: wrap;
            gap: 10px;
            margin: 25px 0;
            padding: 20px;
            background: var(--bg-color);
            border-radius: 8px;
        }}

        .flow-step {{
            background: var(--primary-color);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: 500;
            text-align: center;
            min-width: 140px;
        }}

        .flow-arrow {{
            color: var(--secondary-color);
            font-size: 1.5rem;
        }}

        .validation-list {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }}

        .validation-item {{
            background: var(--bg-color);
            padding: 15px;
            border-radius: 8px;
            border-left: 3px solid var(--primary-color);
        }}

        .validation-item h5 {{
            color: var(--text-color);
            margin-bottom: 8px;
        }}

        .validation-item p {{
            color: var(--text-muted);
            font-size: 0.9rem;
            margin: 0;
        }}

        .comparison-table {{
            margin: 20px 0;
        }}

        .comparison-table th {{
            background: var(--primary-color);
            color: white;
        }}

        .check {{
            color: var(--success-color);
            font-weight: bold;
        }}

        .cross {{
            color: var(--error-color);
            font-weight: bold;
        }}

        footer {{
            text-align: center;
            padding: 30px;
            color: var(--text-muted);
            border-top: 1px solid var(--border-color);
            margin-top: 40px;
        }}

        @media print {{
            body {{
                background: white;
            }}
            
            section {{
                box-shadow: none;
                border: 1px solid var(--border-color);
                page-break-inside: avoid;
            }}
            
            .toc {{
                page-break-after: always;
            }}
        }}

        @media (max-width: 768px) {{
            header h1 {{
                font-size: 1.8rem;
            }}
            
            section {{
                padding: 20px;
            }}
            
            table {{
                font-size: 0.85rem;
            }}
            
            th, td {{
                padding: 8px 10px;
            }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>{title}</h1>
            <p>{description}</p>
            <p style="margin-top: 10px; font-size: 0.9rem;">Version 1.0 | Last Updated: {datetime.now().strftime('%B %Y')}</p>
        </header>

        <nav class="toc">
            <h2>Table of Contents</h2>
            <ul>
                <li><a href="#overview">1. Overview</a></li>
                <li><a href="#processors">2. Available Processors</a></li>
                <li><a href="#input-mapping">3. Input File Mapping</a></li>
                <li><a href="#dimensions">4. Dimension String Format</a></li>'''
    
    if is_closing:
        html += '''
                <li><a href="#output-mapping">5. Output Mapping (D365FO)</a></li>
                <li><a href="#validation">6. Validation Rules</a></li>
                <li><a href="#processing-flow">7. Processing Flow</a></li>
                <li><a href="#grouping">8. Grouping and Batching</a></li>
                <li><a href="#exchange-rates">9. Exchange Rate Calculation</a></li>
                <li><a href="#special-behaviors">10. Special Behaviors</a></li>
                <li><a href="#error-handling">11. Error Handling</a></li>
                <li><a href="#examples">12. Examples</a></li>'''
    else:
        html += '''
                <li><a href="#output-mapping">5. Output Mapping (D365FO)</a></li>
                <li><a href="#validation">6. Validation Rules</a></li>
                <li><a href="#processing-flow">7. Processing Flow</a></li>
                <li><a href="#batch-processing">8. Batch Processing</a></li>
                <li><a href="#custody-filtering">9. Custody Account Filtering</a></li>
                <li><a href="#exchange-rates">10. Exchange Rate Calculation</a></li>
                <li><a href="#special-behaviors">11. Special Behaviors</a></li>
                <li><a href="#error-handling">12. Error Handling</a></li>
                <li><a href="#examples">13. Examples</a></li>'''
    
    html += f'''
            </ul>
        </nav>

        <!-- Section 1: Overview -->
        <section id="overview">
            <h2>1. Overview</h2>
            <p>{overview}</p>
            <ul style="margin-left: 20px; margin-bottom: 15px;">
                <li>Data mapping and enrichment</li>
                <li>Financial dimension parsing and validation</li>
                <li>Exchange rate calculations</li>'''
    
    if is_closing:
        html += '''
                <li>Month and cost center grouping</li>
                <li>Journal entry creation in D365FO</li>'''
    else:
        html += '''
                <li>Custody account filtering</li>
                <li>Vendor master data lookup</li>
                <li>Journal entry creation in D365FO</li>'''
    
    html += '''            </ul>
            
            <div class="info-box note">
                <strong>Key Concept</strong>
                Each processor is specialized for a specific service type (Trucking or Freight), ensuring accurate processing based on business requirements.
            </div>
        </section>

        <!-- Section 2: Available Processors -->
        <section id="processors">
            <h2>2. Available Processors</h2>
            <p>The system includes specialized processors:'''
    
    html += f'</p>\n            {generate_processor_table(processors)}'
    
    if not is_closing:
        html += '''
            
            <div class="info-box warning">
                <strong>*Insert Limitation</strong>
                Vendor processors do not directly insert into D365FO. They prepare and validate the data for manual processing or future integration.
            </div>'''
    
    # Required dimensions section
    html += '\n\n            <h3>Required Financial Dimensions by Processor</h3>'
    
    if is_closing:
        html += '\n            <h4>Freight Closing Processor</h4>'
        html += f'\n            {generate_dimension_table(data["requiredDimensions"]["common"])}'
        html += '\n            <h4>Trucking Closing Processor</h4>'
        html += f'\n            <p>Same as Freight, <strong>plus</strong>:</p>'
        html += f'\n            {generate_dimension_table(data["requiredDimensions"]["truckingOnly"])}'
    else:
        html += '\n            <h4>Freight Processors (Entry & Adjustment)</h4>'
        html += f'\n            {generate_dimension_table(data["requiredDimensions"]["freight"])}'
        html += '\n            <h4>Trucking Processors (Entry & Adjustment)</h4>'
        html += f'\n            <p>Same as Freight, <strong>plus</strong>:</p>'
        trucking_extra = [d for d in data["requiredDimensions"]["trucking"] if d not in data["requiredDimensions"]["freight"]]
        html += f'\n            {generate_dimension_table(trucking_extra)}'
    
    html += f'''
        </section>

        <!-- Section 3: Input File Mapping -->
        <section id="input-mapping">
            <h2>3. Input File Mapping</h2>
            <p>The processors expect data from an Excel file with the following column structure.'''
    
    if is_closing:
        html += ' Each row represents a ledger entry line.</p>'
    else:
        html += ' Each row represents either a <strong>Vendor (Vend)</strong> line or a <strong>Ledger</strong> line.</p>'
    
    html += f'\n            {generate_input_table(input_columns)}'
    
    if not is_closing:
        html += '''
            
            <div class="info-box note">
                <strong>Line Grouping</strong>
                Lines are grouped by <span class="code">VOUCHER</span> + <span class="code">INVOICE</span> combination. Each group should contain one <span class="code">Vend</span> line (header) and one or more <span class="code">Ledger</span> lines (detail).
            </div>'''
    
    html += '''
        </section>

        <!-- Section 4: Dimension String Format -->
        <section id="dimensions">
            <h2>4. Dimension String Format</h2>
            <p>The <span class="code">ACCOUNTDISPLAYVALUE</span> column contains a pipe-separated (<span class="code">|</span>) string with financial dimensions in a specific order:</p>
            
            <div class="code-block">
<span class="comment">// Format:</span>
MainAccount|CostCenter|ActivityName|BusinessUnit|Location|Customer|SubCustomer|Vendor|SubVendor|ChargeType|SalesMan|CoordinatorMan|FreightType|TruckerType|TruckNumber|Direction|Worker|FixedAsset|Lease

<span class="comment">// Example:</span>
<span class="string">401001|CC001|ACT-001|BU-TRUCK|CAI|CUST001|SUBCUST001|VEND001|SUBVEND001|FREIGHT|SM001|COORD001|Payable|TT001|TRK-123|Import|W001||</span>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Position</th>
                        <th>Dimension</th>
                        <th>Example</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td>0</td><td>MainAccount</td><td><span class="code">401001</span></td></tr>
                    <tr><td>1</td><td>CostCenter</td><td><span class="code">CC001</span></td></tr>
                    <tr><td>2</td><td>ActivityName</td><td><span class="code">ACT-001</span></td></tr>
                    <tr><td>3</td><td>BusinessUnit</td><td><span class="code">BU-TRUCK</span></td></tr>
                    <tr><td>4</td><td>Location</td><td><span class="code">CAI</span> or <span class="code">002</span></td></tr>
                    <tr><td>5</td><td>Customer</td><td><span class="code">CUST001</span></td></tr>
                    <tr><td>6</td><td>SubCustomer</td><td><span class="code">SUBCUST001</span></td></tr>
                    <tr><td>7</td><td>Vendor</td><td><span class="code">VEND001</span></td></tr>
                    <tr><td>8</td><td>SubVendor</td><td><span class="code">SUBVEND001</span></td></tr>
                    <tr><td>9</td><td>ChargeType</td><td><span class="code">FREIGHT</span></td></tr>
                    <tr><td>10</td><td>SalesMan</td><td><span class="code">SM001</span></td></tr>
                    <tr><td>11</td><td>CoordinatorMan</td><td><span class="code">COORD001</span></td></tr>
                    <tr><td>12</td><td>FreightType</td><td><span class="code">Payable</span> (default)</td></tr>
                    <tr><td>13</td><td>TruckerType</td><td><span class="code">TT001</span></td></tr>
                    <tr><td>14</td><td>TruckNumber</td><td><span class="code">TRK-123</span></td></tr>
                    <tr><td>15</td><td>Direction</td><td><span class="code">Import</span> / <span class="code">Export</span></td></tr>
                    <tr><td>16</td><td>Worker</td><td><span class="code">W001</span></td></tr>
                    <tr><td>17</td><td>FixedAsset</td><td><span class="code">FA001</span></td></tr>
                    <tr><td>18</td><td>Lease</td><td><span class="code">L001</span></td></tr>
                </tbody>
            </table>

            <div class="info-box warning">
                <strong>Location Transformation</strong>
                The value <span class="code">CAI</span> (case-insensitive) is automatically converted to <span class="code">002</span> during processing and vice versa when converting back to string format.
            </div>

            <div class="info-box note">
                <strong>FreightType Default</strong>
                If <span class="code">FreightType</span> (position 12) is empty, it defaults to <span class="code">Payable</span>.
            </div>
        </section>'''
    
    # Output mapping section
    html += '''
        <!-- Section 5: Output Mapping -->
        <section id="output-mapping">
            <h2>5. Output Mapping (D365FO)</h2>'''
    
    if is_closing:
        html += '''
            <p>After processing, each line is transformed into a <span class="code">DynLedgerClosingJournalEntryDto</span> object for D365FO integration:</p>
            
            <table>
                <thead>
                    <tr>
                        <th>Output Field</th>
                        <th>Source</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><span class="code">JournalBatchNumber</span></td>
                        <td>Generated</td>
                        <td>Sequential batch number per month/cost center</td>
                    </tr>
                    <tr>
                        <td><span class="code">JournalName</span></td>
                        <td>GL-Freight or GL-Fleet</td>
                        <td>Journal name based on processor type</td>
                    </tr>
                    <tr>
                        <td><span class="code">Description</span></td>
                        <td>Generated</td>
                        <td>Closing Entry {Month} {Year} (Forwarding - {costCenterName})</td>
                    </tr>
                    <tr>
                        <td><span class="code">Voucher</span></td>
                        <td>Generated</td>
                        <td>Sequential voucher number per source entry</td>
                    </tr>
                    <tr>
                        <td><span class="code">TransDate</span></td>
                        <td>TRANSDATE</td>
                        <td>Transaction date</td>
                    </tr>
                    <tr>
                        <td><span class="code">AccountDisplayValue</span></td>
                        <td>ACCOUNTDISPLAYVALUE</td>
                        <td>Dimension string</td>
                    </tr>
                    <tr>
                        <td><span class="code">DebitAmount</span></td>
                        <td>DEBITAMOUNT</td>
                        <td>Debit amount</td>
                    </tr>
                    <tr>
                        <td><span class="code">CreditAmount</span></td>
                        <td>CREDITAMOUNT</td>
                        <td>Credit amount</td>
                    </tr>
                    <tr>
                        <td><span class="code">CurrencyCode</span></td>
                        <td>CURRENCYCODE</td>
                        <td>Currency code</td>
                    </tr>
                    <tr>
                        <td><span class="code">ExchangeRate</span></td>
                        <td>Calculated</td>
                        <td>Monthly exchange rate to EGP (multiplied by 100)</td>
                    </tr>
                    <tr>
                        <td><span class="code">ReportingCurrencyExchRate</span></td>
                        <td>Calculated</td>
                        <td>Reporting currency exchange rate to USD (multiplied by 100)</td>
                    </tr>
                </tbody>
            </table>'''
    else:
        html += '''
            <p>After processing, each line is transformed into a vendor journal entry DTO object for D365FO integration:</p>
            
            <table>
                <thead>
                    <tr>
                        <th>Output Field</th>
                        <th>Source</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><span class="code">JOURNALBATCHNUMBER</span></td>
                        <td>Generated</td>
                        <td>Sequential batch number per month</td>
                    </tr>
                    <tr>
                        <td><span class="code">DESCRIPTION</span></td>
                        <td>Generated</td>
                        <td>Vendor Invoice {ServiceType} {MonthYear}</td>
                    </tr>
                    <tr>
                        <td><span class="code">VOUCHER</span></td>
                        <td>Generated</td>
                        <td>Sequential voucher number per invoice</td>
                    </tr>
                    <tr>
                        <td><span class="code">ACCOUNTTYPE</span></td>
                        <td>ACCOUNTTYPE</td>
                        <td>Ledger or Vend</td>
                    </tr>
                    <tr>
                        <td><span class="code">ACCOUNTDISPLAYVALUE</span></td>
                        <td>ACCOUNTDISPLAYVALUE</td>
                        <td>Dimension string or vendor account</td>
                    </tr>
                    <tr>
                        <td><span class="code">DEBIT</span></td>
                        <td>DEBITAMOUNT</td>
                        <td>Debit amount</td>
                    </tr>
                    <tr>
                        <td><span class="code">CREDIT</span></td>
                        <td>CREDITAMOUNT</td>
                        <td>Credit amount</td>
                    </tr>
                    <tr>
                        <td><span class="code">CURRENCY</span></td>
                        <td>CURRENCYCODE</td>
                        <td>Currency code</td>
                    </tr>
                    <tr>
                        <td><span class="code">EXCHRATE</span></td>
                        <td>Calculated</td>
                        <td>Exchange rate to EGP (multiplied by 100)</td>
                    </tr>
                    <tr>
                        <td><span class="code">REPORTINGCURRENCYEXCHRATE</span></td>
                        <td>Calculated</td>
                        <td>Reporting currency exchange rate to USD (multiplied by 100)</td>
                    </tr>
                    <tr>
                        <td><span class="code">TERMSOFPAYMENT</span></td>
                        <td>Vendor master data</td>
                        <td>Payment terms from vendor record</td>
                    </tr>
                </tbody>
            </table>'''
    
    html += '''
        </section>

        <!-- Section 6: Validation Rules -->
        <section id="validation">
            <h2>6. Validation Rules</h2>
            <p>Each line is validated against D365FO master data. Validation errors are collected and attached to each line for reporting.</p>
            
            <h3>Dimension Validations</h3>
            <p>All required dimensions are validated to ensure they exist in the D365FO system:</p>'''
    
    if is_closing:
        html += f'\n            {generate_dimension_table(data["requiredDimensions"]["common"])}'
        html += '\n            <h4>Additional Validations for Trucking</h4>'
        html += f'\n            {generate_dimension_table(data["requiredDimensions"]["truckingOnly"])}'
    else:
        html += '\n            <h4>Freight Processors</h4>'
        html += f'\n            {generate_dimension_table(data["requiredDimensions"]["freight"])}'
        html += '\n            <h4>Trucking Processors</h4>'
        trucking_extra = [d for d in data["requiredDimensions"]["trucking"] if d not in data["requiredDimensions"]["freight"]]
        html += f'\n            {generate_dimension_table(trucking_extra)}'
        html += '\n            <p>Plus all dimensions from Freight processors.</p>'
    
    html += '''
            <div class="info-box error">
                <strong>Validation Error Format</strong>
                Errors are stored with a key (dimension name) and message. Example: <br>
                Key: <span class="code">MainAccount</span><br>
                Message: <span class="code">"The main account 999999 does not exist in the system."</span>
            </div>
        </section>'''
    
    # Processing flow section
    html += '''
        <!-- Section 7: Processing Flow -->
        <section id="processing-flow">
            <h2>7. Processing Flow</h2>
            <p>The processing follows a three-stage pipeline:</p>
            
            <div class="flow-diagram">
                <div class="flow-step">1. Format & Enrich</div>
                <span class="flow-arrow">&#8594;</span>
                <div class="flow-step">2. Validate</div>
                <span class="flow-arrow">&#8594;</span>
                <div class="flow-step">3. Insert to D365</div>
            </div>'''
    
    if is_closing:
        html += '''
            <h3>Stage 1: Format and Enrich (<span class="code">formatAndEnrichAsync</span>)</h3>
            <ol style="margin-left: 20px; margin-bottom: 20px;">
                <li>Load customer-account mappings for the service type (Trucking/Freight)</li>
                <li>Load cost center dimensions</li>
                <li>Load and sort exchange rates</li>
                <li>Load batch and voucher counters</li>
                <li>Filter and map ledger data</li>
                <li>Group entries by month and cost center</li>
                <li>Match vouchers to entry pairs</li>
                <li>Apply batch numbers and aggregate entries</li>
                <li>Finalize counters and settings</li>
            </ol>

            <h3>Stage 2: Validate (<span class="code">validateAsync</span>)</h3>
            <ol style="margin-left: 20px; margin-bottom: 20px;">
                <li>Load all main accounts from D365FO</li>
                <li>Load financial dimension values for each required dimension</li>
                <li>For each journal entry line, validate all required dimensions</li>
                <li>Attach validation errors to each line</li>
            </ol>

            <h3>Stage 3: Insert to Dynamics (<span class="code">insertIntoDynamicsAsync</span>)</h3>
            <ol style="margin-left: 20px;">
                <li>Group validated lines by journal batch number</li>
                <li>For each batch:
                    <ul style="margin-left: 20px;">
                        <li>Create journal header</li>
                        <li>Create journal lines for each entry</li>
                    </ul>
                </li>
            </ol>'''
    else:
        html += '''
            <h3>Stage 1: Format and Enrich (<span class="code">formatAndEnrichAsync</span>)</h3>
            <ol style="margin-left: 20px; margin-bottom: 20px;">
                <li>Fetch custody account numbers for the company</li>
                <li>Filter raw data (exclude custody accounts except Ledger lines)</li>
                <li>Sort lines by line number</li>
                <li>Build month → voucher map</li>
                <li>Initialize batch processing</li>
                <li>For each month → voucher:
                    <ul style="margin-left: 20px;">
                        <li>Check if new batch needed (month change or 1000 line limit)</li>
                        <li>Calculate exchange rates for invoice header</li>
                        <li>Process invoice lines and build DTO objects</li>
                        <li>Add to current batch</li>
                    </ul>
                </li>
                <li>Final flush of remaining batch</li>
            </ol>

            <h3>Stage 2: Validate (<span class="code">validateAsync</span>)</h3>
            <ol style="margin-left: 20px; margin-bottom: 20px;">
                <li>Load all main accounts from D365FO</li>
                <li>Load financial dimension values for each required dimension</li>
                <li>For each line, validate all required dimensions</li>
                <li>Attach validation errors to each line</li>
            </ol>

            <h3>Stage 3: Insert to Dynamics (<span class="code">insertIntoDynamicsAsync</span>)</h3>
            <ol style="margin-left: 20px;">
                <li>Currently not implemented - returns resolved promise</li>
                <li>Data is prepared for manual processing or future integration</li>
            </ol>'''
    
    html += '''
        </section>'''
    
    # Additional sections based on type
    if is_closing:
        html += '''
        <!-- Section 8: Grouping and Batching -->
        <section id="grouping">
            <h2>8. Grouping and Batching</h2>
            <p>Entries are grouped hierarchically:</p>
            <ol style="margin-left: 20px;">
                <li><strong>By Month:</strong> Entries are first grouped by transaction date (year-month)</li>
                <li><strong>By Cost Center:</strong> Within each month, entries are grouped by cost center</li>
                <li><strong>By Source Entry:</strong> Entries with the same source UniqueId are paired in vouchers</li>
            </ol>
            
            <h3>Batch Numbering</h3>
            <p>Each cost center within a month gets its own batch number. Batches are numbered sequentially using the <span class="code">LedgerEntryBatchCounter</span>.</p>
            
            <h3>Voucher Numbering</h3>
            <p>Vouchers are assigned per source entry pair. Each unique source entry gets a sequential voucher number from the <span class="code">LedgerVoucherCounter</span> for the specific journal name.</p>
            
            <h3>Line Numbering</h3>
            <p>Within each batch, line numbers are sequential starting from 1. If a batch would exceed 1000 lines, a new batch is created.</p>
        </section>

        <!-- Section 9: Exchange Rate Calculation -->
        <section id="exchange-rates">
            <h2>9. Exchange Rate Calculation</h2>
            <p>Exchange rates are calculated based on the transaction date:</p>
            
            <h3>Monthly Exchange Rate (to EGP)</h3>
            <ul style="margin-left: 20px;">
                <li>If currency is EGP: rate = 1</li>
                <li>Otherwise: lookup exchange rate from D365FO for the transaction date</li>
                <li>Rate is multiplied by 100 for storage</li>
            </ul>
            
            <h3>Reporting Currency Exchange Rate (to USD)</h3>
            <ul style="margin-left: 20px;">
                <li>If currency is USD: rate = 1</li>
                <li>If currency is EGP: invert USD→EGP rate</li>
                <li>Otherwise: lookup exchange rate from D365FO for the transaction date</li>
                <li>Rate is multiplied by 100 for storage</li>
            </ul>
        </section>'''
    else:
        html += '''
        <!-- Section 8: Batch Processing -->
        <section id="batch-processing">
            <h2>8. Batch Processing</h2>
            <p>Entries are processed in batches with the following rules:</p>
            
            <h3>Batch Creation Rules</h3>
            <ul style="margin-left: 20px;">
                <li>A new batch is created when the month changes</li>
                <li>A new batch is created when adding entries would exceed 1000 lines</li>
                <li>Each batch has a unique sequential batch number</li>
            </ul>
            
            <h3>Voucher Assignment</h3>
            <p>Each invoice (grouped by VOUCHER) gets a unique sequential voucher number. Vouchers are assigned per invoice, not per line.</p>
            
            <h3>Line Numbering</h3>
            <p>Within each batch, line numbers are sequential starting from 1. Line numbers reset when a new batch is created.</p>
        </section>

        <!-- Section 9: Custody Account Filtering -->
        <section id="custody-filtering">
            <h2>9. Custody Account Filtering</h2>
            <p>The processors filter out custody accounts to prevent duplicate processing:</p>
            
            <div class="info-box warning">
                <strong>Filtering Logic</strong>
                <ul style="margin-left: 20px; margin-top: 10px;">
                    <li>All <span class="code">Ledger</span> lines are included regardless of account</li>
                    <li><span class="code">Vend</span> lines with account numbers in the "Custody" vendor group are excluded</li>
                    <li>All other <span class="code">Vend</span> lines are included</li>
                </ul>
            </div>
            
            <p>The custody vendor group is identified by querying D365FO for vendors with <span class="code">vendorGroupIds: ['Custody']</span>.</p>
        </section>

        <!-- Section 10: Exchange Rate Calculation -->
        <section id="exchange-rates">
            <h2>10. Exchange Rate Calculation</h2>
            <p>Exchange rates are calculated once per invoice header (first line of each voucher group):</p>
            
            <h3>Monthly Exchange Rate (to EGP)</h3>
            <ul style="margin-left: 20px;">
                <li>If currency is EGP: rate = 100 (100%)</li>
                <li>Otherwise: lookup exchange rate from D365FO for the transaction month</li>
                <li>Uses <span class="code">getMonthRange(date)</span> to find the month boundaries</li>
            </ul>
            
            <h3>Reporting Currency Exchange Rate (to USD)</h3>
            <ul style="margin-left: 20px;">
                <li>If currency is USD: rate = 100 (100%)</li>
                <li>If currency is EGP: lookup USD→EGP rate and invert</li>
                <li>Otherwise: lookup exchange rate from D365FO for the transaction month</li>
            </ul>
            
            <div class="info-box note">
                <strong>Rate Application</strong>
                The same exchange rates calculated for the invoice header are applied to all lines within that invoice.
            </div>
        </section>'''
    
    # Special behaviors section
    html += '''
        <!-- Section 10/11: Special Behaviors -->
        <section id="special-behaviors">
            <h2>'''
    html += '10. Special Behaviors' if is_closing else '11. Special Behaviors'
    html += '''</h2>'''
    
    if is_closing:
        html += '''
            <h3>Tax Group Derivation</h3>
            <p>The <span class="code">SalesTaxGroup</span> and <span class="code">ItemSalesTaxGroup</span> are derived with special rules:</p>
            
            <div class="code-block">
<span class="comment">// SalesTaxGroup Logic:</span>
<span class="keyword">if</span> (!SALESTAXGROUP || !ITEMSALESTAXGROUP) <span class="keyword">return</span> <span class="string">'Non-Taxabl'</span>;
<span class="keyword">if</span> (ITEMSALESTAXGROUP.includes(<span class="string">'VAT-0%'</span>)) <span class="keyword">return</span> <span class="string">'Non-Taxabl'</span>;
<span class="keyword">return</span> SALESTAXGROUP;

<span class="comment">// ItemSalesTaxGroup Logic:</span>
<span class="keyword">if</span> (!ITEMSALESTAXGROUP) <span class="keyword">return</span> <span class="string">''</span>;
<span class="keyword">if</span> (ITEMSALESTAXGROUP.includes(<span class="string">'14%SUPPLIE'</span>) || ITEMSALESTAXGROUP.includes(<span class="string">'14'</span>)) <span class="keyword">return</span> <span class="string">'VAT-14%'</span>;
<span class="keyword">if</span> (ITEMSALESTAXGROUP.includes(<span class="string">'VAT-0%'</span>)) <span class="keyword">return</span> <span class="string">''</span>;
<span class="keyword">return</span> ITEMSALESTAXGROUP;
            </div>

            <h3>SubCustomer Mapping</h3>
            <p>When processing, the SubCustomer dimension value is mapped to the corresponding <span class="code">invoiceAccount</span> from the customer-account mapping master data:</p>
            <ol style="margin-left: 20px;">
                <li>Check if the Customer dimension exists in the account mappings</li>
                <li>If found, look up the SubCustomer in the same mappings</li>
                <li>If a match is found, replace SubCustomer with the <span class="code">invoiceAccount</span> value</li>
            </ol>

            <h3>Location Normalization</h3>
            <p>Location values are normalized during processing:</p>
            <ul style="margin-left: 20px;">
                <li><span class="code">CAI</span> (case-insensitive) is converted to <span class="code">002</span></li>
                <li>When converting back to string, <span class="code">002</span> is converted to <span class="code">cai</span></li>
            </ul>

            <h3>Date Coercion</h3>
            <p>The processors handle multiple date formats:</p>
            <ul style="margin-left: 20px;">
                <li><strong>Date object:</strong> Used as-is</li>
                <li><strong>String:</strong> Parsed using JavaScript Date constructor</li>
                <li><strong>Number (Excel serial):</strong> Converted using formula: <span class="code">(value - 25569) * 86400 * 1000</span> milliseconds</li>
            </ul>

            <h3>Entry Sorting</h3>
            <p>Within each cost center, entries are sorted by:</p>
            <ol style="margin-left: 20px;">
                <li>Transaction date (ascending)</li>
                <li>UniqueId (ascending)</li>
                <li>Cost center (alphabetical)</li>
                <li>Debit amount (ascending)</li>
                <li>Credit amount (ascending)</li>
            </ol>'''
    else:
        html += '''
            <h3>Vendor Master Data Lookup</h3>
            <p>For vendor lines (<span class="code">ACCOUNTTYPE = 'Vend'</span>), the processor looks up vendor information:</p>
            <ul style="margin-left: 20px;">
                <li><strong>Tax Number:</strong> Retrieved from <span class="code">salesTaxGroupCode</span> field</li>
                <li><strong>Terms of Payment:</strong> Retrieved from <span class="code">defaultPaymentTermsName</span> field</li>
            </ul>
            
            <h3>Dimension Parsing</h3>
            <p>Dimensions are parsed differently based on account type:</p>
            <ul style="margin-left: 20px;">
                <li><strong>Ledger lines:</strong> Parse from <span class="code">ACCOUNTDISPLAYVALUE</span></li>
                <li><strong>Vendor lines:</strong> Parse from <span class="code">DEFAULTDIMENSIONDISPLAYVALUE</span></li>
            </ul>
            
            <h3>Currency and Company Normalization</h3>
            <p>The processors normalize currency codes and company codes to ensure consistency:</p>
            <ul style="margin-left: 20px;">
                <li>Currency codes are normalized to uppercase</li>
                <li>Company codes are normalized according to business rules</li>
                <li>Transaction type is set to "vendor" for all entries</li>
            </ul>
            
            <h3>TruckNumber Validation (Trucking Only)</h3>
            <p>For trucking processors, <span class="code">TruckNumber</span> is only validated when <span class="code">TruckerType</span> is "11" or "12".</p>'''
        
        if 'specialBehaviors' in data:
            for behavior, description in data['specialBehaviors'].items():
                html += f'\n            <h3>{behavior.replace("_", " ").title()}</h3>\n            <p>{description}</p>'
    
    html += '''
        </section>

        <!-- Section 11/12: Error Handling -->
        <section id="error-handling">
            <h2>'''
    html += '11. Error Handling' if is_closing else '12. Error Handling'
    html += '''</h2>
            <p>Errors are handled at multiple levels and collected for reporting:</p>
            
            <h3>Validation Errors</h3>
            <p>Each line can accumulate validation errors. These errors do not stop processing but are attached to the line for reporting.</p>
            
            <h4>Common Validation Error Messages</h4>
            <table>
                <thead>
                    <tr>
                        <th>Error Key</th>
                        <th>Message Pattern</th>
                        <th>Cause</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td><span class="code">MainAccount</span></td>
                        <td>"Main Account is required"</td>
                        <td>Missing or empty value</td>
                    </tr>
                    <tr>
                        <td><span class="code">MainAccount</span></td>
                        <td>"The main account {value} does not exist in the system."</td>
                        <td>Value not in Chart of Accounts</td>
                    </tr>
                    <tr>
                        <td><span class="code">CustomerDimensions</span></td>
                        <td>"Customer is required"</td>
                        <td>Missing, empty, or "000"</td>
                    </tr>
                    <tr>
                        <td><span class="code">CustomerDimensions</span></td>
                        <td>"The dimension {value} does not exist in the system."</td>
                        <td>Value not in Customer dimension</td>
                    </tr>
                </tbody>
            </table>

            <h3>Processing Errors</h3>
            <div class="info-box error">
                <strong>Counter Not Found</strong>
                If <span class="code">LedgerEntryBatchCounter</span> or <span class="code">LedgerVoucherCounter</span> is not found for the company/journal, processing throws an error.
            </div>'''
    
    if not is_closing:
        html += '''
            <div class="info-box warning">
                <strong>Insert Not Implemented</strong>
                The <span class="code">insertIntoDynamicsAsync</span> method currently returns a resolved promise without inserting data. Data is prepared for manual processing.
            </div>'''
    
    html += '''
        </section>

        <!-- Section 12/13: Examples -->
        <section id="examples">
            <h2>'''
    html += '12. Examples' if is_closing else '13. Examples'
    html += '''</h2>'''
    
    if is_closing:
        html += '''
            <h3>Example 1: Closing Entry Input</h3>
            <div class="code-block">
<span class="comment">// Input Row:</span>
LINENUMBER: 1
VOUCHER: <span class="string">"V00001"</span>
TRANSDATE: <span class="string">"2024-01-15"</span>
ACCOUNTTYPE: <span class="string">"Ledger"</span>
ACCOUNTDISPLAYVALUE: <span class="string">"401001|CC001|ACT001|BU001|CAI|CUST001|SUBCUST001|VEND001|SUBVEND001|FREIGHT|SM001|COORD001|Payable|TT001|TRK001|Import|W001||"</span>
DEBITAMOUNT: 5000.00
CREDITAMOUNT: 0
CURRENCYCODE: <span class="string">"EGP"</span>
SALESTAXGROUP: <span class="string">"VAT-14%"</span>
ITEMSALESTAXGROUP: <span class="string">"14%SUPPLIE"</span>
            </div>

            <h3>Example 2: Expected Output</h3>
            <div class="code-block">
{{
  <span class="string">"JournalBatchNumber"</span>: <span class="string">"1"</span>,
  <span class="string">"JournalName"</span>: <span class="string">"GL-Freight"</span>,
  <span class="string">"Description"</span>: <span class="string">"Closing Entry January 2024 (Forwarding - Cost Center 001)"</span>,
  <span class="string">"Voucher"</span>: <span class="string">"1"</span>,
  <span class="string">"TransDate"</span>: <span class="string">"2024-01-15T00:00:00.000Z"</span>,
  <span class="string">"DebitAmount"</span>: 5000.00,
  <span class="string">"CreditAmount"</span>: 0,
  <span class="string">"CurrencyCode"</span>: <span class="string">"EGP"</span>,
  <span class="string">"ExchangeRate"</span>: 100,
  <span class="string">"ReportingCurrencyExchRate"</span>: 30.5
}}
            </div>'''
    else:
        html += '''
            <h3>Example 1: Vendor Invoice Input</h3>
            <div class="code-block">
<span class="comment">// Row 1 (Vendor Line):</span>
LINENUMBER: 1
VOUCHER: <span class="string">"V00001"</span>
INVOICE: <span class="string">"INV-1234"</span>
ACCOUNTTYPE: <span class="string">"Vend"</span>
ACCOUNTDISPLAYVALUE: <span class="string">"VEND001"</span>
TRANSDATE: <span class="string">"2024-01-15"</span>
DUEDATE: <span class="string">"2024-02-15"</span>
TEXT: <span class="string">"Vendor Service Invoice"</span>
DEFAULTDIMENSIONDISPLAYVALUE: <span class="string">"CC001|ACT001|BU001|CAI|..."</span>

<span class="comment">// Row 2 (Ledger Line):</span>
LINENUMBER: 2
VOUCHER: <span class="string">"V00001"</span>
INVOICE: <span class="string">"INV-1234"</span>
ACCOUNTTYPE: <span class="string">"Ledger"</span>
ACCOUNTDISPLAYVALUE: <span class="string">"401001|CC001|ACT001|BU001|CAI|||VEND001|SUBVEND001|FREIGHT|SM001|COORD001|Payable|||Import|||"</span>
CREDITAMOUNT: 5000.00
DEBITAMOUNT: 0
CURRENCYCODE: <span class="string">"EGP"</span>
SALESTAXGROUP: <span class="string">"VAT-14%"</span>
ITEMSALESTAXGROUP: <span class="string">"14%SUPPLIE"</span>
            </div>

            <h3>Example 2: Expected Output</h3>
            <div class="code-block">
{{
  <span class="string">"JOURNALBATCHNUMBER"</span>: <span class="string">"1"</span>,
  <span class="string">"DESCRIPTION"</span>: <span class="string">"Vendor Invoice Freight January 2024"</span>,
  <span class="string">"VOUCHER"</span>: <span class="string">"1"</span>,
  <span class="string">"ACCOUNTTYPE"</span>: <span class="string">"Ledger"</span>,
  <span class="string">"DEBIT"</span>: 0,
  <span class="string">"CREDIT"</span>: 5000.00,
  <span class="string">"CURRENCY"</span>: <span class="string">"EGP"</span>,
  <span class="string">"EXCHRATE"</span>: 100,
  <span class="string">"REPORTINGCURRENCYEXCHRATE"</span>: 30.5,
  <span class="string">"TERMSOFPAYMENT"</span>: <span class="string">"Net 30"</span>
}}
            </div>'''
    
    html += '''
        </section>

        <footer>
            <p>D365FO Middleware - ''' + title + ''' Documentation</p>
            <p>Generated for internal use | Contact: Development Team</p>
        </footer>
    </div>
</body>
</html>'''
    
    return html

def main():
    """Main function to generate HTML files."""
    script_dir = Path(__file__).parent
    data_file = script_dir / 'processor-docs-data.json'
    output_dir = script_dir
    
    # Load data
    with open(data_file, 'r', encoding='utf-8') as f:
        all_data = json.load(f)
    
    # Generate closing processors HTML
    closing_data = all_data['closing']
    closing_html = generate_html(closing_data, 'CLOSING_PROCESSORS.html')
    closing_output = output_dir / 'CLOSING_PROCESSORS.html'
    with open(closing_output, 'w', encoding='utf-8') as f:
        f.write(closing_html)
    print(f"Generated: {closing_output}")
    
    # Generate vendor processors HTML
    vendor_data = all_data['vendor']
    vendor_html = generate_html(vendor_data, 'VENDOR_PROCESSORS.html')
    vendor_output = output_dir / 'VENDOR_PROCESSORS.html'
    with open(vendor_output, 'w', encoding='utf-8') as f:
        f.write(vendor_html)
    print(f"Generated: {vendor_output}")
    
    print("\nDocumentation generation complete!")

if __name__ == '__main__':
    main()
