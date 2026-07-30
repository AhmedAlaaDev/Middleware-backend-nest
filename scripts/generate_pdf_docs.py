import os
import re
import sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

# Define Palette
PRIMARY_COLOR = colors.HexColor("#1A365D")    # Deep Navy
SECONDARY_COLOR = colors.HexColor("#2B6CB0")  # Slate Blue
ACCENT_COLOR = colors.HexColor("#319795")     # Teal
TEXT_DARK = colors.HexColor("#2D3748")        # Dark Charcoal
BG_LIGHT = colors.HexColor("#F7FAFC")         # Very Light Gray
BG_ALT = colors.HexColor("#EDF2F7")           # Light Gray Table Alt
BORDER_COLOR = colors.HexColor("#CBD5E0")     # Light Border

class NumberedCanvas(canvas.Canvas):
    """Canvas for adding page numbers and running headers/footers."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 9)
        self.setFillColor(colors.HexColor("#718096"))

        # Skip header on page 1 if cover-like
        if self._pageNumber > 1:
            self.drawString(54, 842 - 36, "D365FO Middleware Backend — Technical & Business Documentation")
            self.setStrokeColor(BORDER_COLOR)
            self.setLineWidth(0.5)
            self.line(54, 842 - 42, 595 - 54, 842 - 42)

        # Footer on all pages
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(595 - 54, 36, page_str)
        self.drawString(54, 36, "CONFIDENTIAL — D365FO Middleware Integration Guide")
        self.setStrokeColor(BORDER_COLOR)
        self.setLineWidth(0.5)
        self.line(54, 48, 595 - 54, 48)

        self.restoreState()


def create_stylesheet():
    styles = getSampleStyleSheet()

    # Modify Normal
    styles['Normal'].textColor = TEXT_DARK
    styles['Normal'].fontSize = 10
    styles['Normal'].leading = 14
    styles['Normal'].fontName = 'Helvetica'

    # Custom Headings
    h1 = ParagraphStyle(
        'CustomH1',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=PRIMARY_COLOR,
        spaceAfter=12,
        spaceBefore=18,
        keepWithNext=True
    )
    styles.add(h1)

    h2 = ParagraphStyle(
        'CustomH2',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=SECONDARY_COLOR,
        spaceAfter=8,
        spaceBefore=14,
        keepWithNext=True
    )
    styles.add(h2)

    h3 = ParagraphStyle(
        'CustomH3',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=PRIMARY_COLOR,
        spaceAfter=6,
        spaceBefore=10,
        keepWithNext=True
    )
    styles.add(h3)

    body = ParagraphStyle(
        'CustomBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9.5,
        leading=13.5,
        spaceAfter=6
    )
    styles.add(body)

    bullet = ParagraphStyle(
        'CustomBullet',
        parent=body,
        leftIndent=15,
        firstLineIndent=-10,
        spaceAfter=4
    )
    styles.add(bullet)

    blockquote = ParagraphStyle(
        'CustomBlockquote',
        parent=body,
        fontName='Helvetica-Oblique',
        fontSize=9,
        leading=13,
        textColor=colors.HexColor("#2D3748"),
        leftIndent=15,
        rightIndent=15,
        spaceBefore=6,
        spaceAfter=8
    )
    styles.add(blockquote)

    table_cell = ParagraphStyle(
        'TableCell',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=11
    )
    styles.add(table_cell)

    table_header = ParagraphStyle(
        'TableHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white
    )
    styles.add(table_header)

    code_block = ParagraphStyle(
        'CodeBlock',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=8,
        leading=10.5,
        textColor=colors.HexColor("#2C5282"),
        leftIndent=10,
        spaceAfter=6
    )
    styles.add(code_block)

    return styles


def parse_inline_markdown(text):
    """Converts bold, italic, code, and links to ReportLab HTML tags."""
    # Escape HTML special chars first
    text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    
    # Re-allow basic reportlab tags
    # Bold **text**
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    # Italic *text*
    text = re.sub(r'\*(.*?)\*', r'<i>\1</i>', text)
    # Inline code `code`
    text = re.sub(r'`(.*?)`', r'<font face="Courier" color="#2C5282"><b>\1</b></font>', text)
    return text


def markdown_to_pdf(md_file_path, pdf_file_path):
    print(f"Compiling {os.path.basename(md_file_path)} -> {os.path.basename(pdf_file_path)}...")
    
    with open(md_file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    styles = create_stylesheet()
    story = []

    in_table = False
    table_data = []
    in_code = False
    code_lines = []

    for line in lines:
        raw_line = line.rstrip('\r\n')
        stripped = raw_line.strip()

        # Handle Code Block ```
        if stripped.startswith('```'):
            if in_code:
                # Close code block
                code_text = "<br/>".join([parse_inline_markdown(l) for l in code_lines])
                story.append(Paragraph(code_text, styles['CodeBlock']))
                story.append(Spacer(1, 6))
                in_code = False
                code_lines = []
            else:
                in_code = True
                code_lines = []
            continue

        if in_code:
            code_lines.append(raw_line)
            continue

        # Handle Markdown Tables
        if '|' in stripped and ('---' in stripped or len(table_data) > 0 or stripped.startswith('|')):
            if '---' in stripped:
                # Separator line, ignore
                continue
            
            # Parse table row
            cells = [c.strip() for c in stripped.split('|')[1:-1]]
            if len(cells) > 0:
                in_table = True
                table_data.append(cells)
                continue
        else:
            if in_table and len(table_data) > 0:
                # Render table
                formatted_table = []
                for row_idx, row in enumerate(table_data):
                    formatted_row = []
                    for cell in row:
                        cell_text = parse_inline_markdown(cell)
                        if row_idx == 0:
                            p = Paragraph(cell_text, styles['TableHeader'])
                        else:
                            p = Paragraph(cell_text, styles['TableCell'])
                        formatted_row.append(p)
                    formatted_table.append(formatted_row)

                # Calculate Column Widths
                num_cols = len(table_data[0])
                available_width = 595 - 108  # 487 pt
                col_width = available_width / max(1, num_cols)
                col_widths = [col_width] * num_cols

                t = Table(formatted_table, colWidths=col_widths)
                t_style = [
                    ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_COLOR),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                    ('BOX', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
                    ('TOPPADDING', (0, 0), (-1, -1), 5),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ]
                for r in range(1, len(formatted_table)):
                    if r % 2 == 0:
                        t_style.append(('BACKGROUND', (0, r), (-1, r), BG_ALT))
                    else:
                        t_style.append(('BACKGROUND', (0, r), (-1, r), BG_LIGHT))

                t.setStyle(TableStyle(t_style))
                story.append(t)
                story.append(Spacer(1, 10))

                in_table = False
                table_data = []

        if not stripped:
            story.append(Spacer(1, 4))
            continue

        # Headings
        if stripped.startswith('# '):
            title_text = parse_inline_markdown(stripped[2:])
            story.append(Paragraph(title_text, styles['CustomH1']))
            story.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY_COLOR, spaceBefore=2, spaceAfter=10))
        elif stripped.startswith('## '):
            h2_text = parse_inline_markdown(stripped[3:])
            story.append(Paragraph(h2_text, styles['CustomH2']))
        elif stripped.startswith('### '):
            h3_text = parse_inline_markdown(stripped[4:])
            story.append(Paragraph(h3_text, styles['CustomH3']))
        elif stripped.startswith('#### '):
            h4_text = parse_inline_markdown(stripped[5:])
            story.append(Paragraph(h4_text, styles['CustomH3']))
        elif stripped.startswith('> '):
            quote_text = parse_inline_markdown(stripped[2:])
            story.append(Paragraph(quote_text, styles['CustomBlockquote']))
        elif stripped.startswith('- ') or stripped.startswith('* '):
            bullet_text = "• " + parse_inline_markdown(stripped[2:])
            story.append(Paragraph(bullet_text, styles['CustomBullet']))
        elif re.match(r'^\d+\.\s', stripped):
            num_text = parse_inline_markdown(stripped)
            story.append(Paragraph(num_text, styles['CustomBullet']))
        else:
            body_text = parse_inline_markdown(stripped)
            story.append(Paragraph(body_text, styles['CustomBody']))

    # Check if table ended at EOF
    if in_table and len(table_data) > 0:
        formatted_table = []
        for row_idx, row in enumerate(table_data):
            formatted_row = []
            for cell in row:
                cell_text = parse_inline_markdown(cell)
                if row_idx == 0:
                    p = Paragraph(cell_text, styles['TableHeader'])
                else:
                    p = Paragraph(cell_text, styles['TableCell'])
                formatted_row.append(p)
            formatted_table.append(formatted_row)

        num_cols = len(table_data[0])
        available_width = 595 - 108
        col_widths = [available_width / max(1, num_cols)] * num_cols

        t = Table(formatted_table, colWidths=col_widths)
        t_style = [
            ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_COLOR),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('BOX', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ]
        for r in range(1, len(formatted_table)):
            if r % 2 == 0:
                t_style.append(('BACKGROUND', (0, r), (-1, r), BG_ALT))
            else:
                t_style.append(('BACKGROUND', (0, r), (-1, r), BG_LIGHT))

        t.setStyle(TableStyle(t_style))
        story.append(t)
        story.append(Spacer(1, 10))

    # Build PDF
    doc = SimpleDocTemplate(
        pdf_file_path,
        pagesize=A4,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated: {pdf_file_path}")


def main():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    docs_dir = os.path.join(base_dir, "docs")
    pdf_dir = os.path.join(base_dir, "docs_pdf")

    os.makedirs(pdf_dir, exist_ok=True)

    file_mapping = {
        "00_key_names_and_concepts_reference.md": "00_Key_Names_and_Concepts_Reference.pdf",
        "01_system_architecture_and_cycles.md": "01_Middleware_System_Architecture_and_Cycles.pdf",
        "02_core_infrastructure_modules.md": "02_Core_Infrastructure_Modules.pdf",
        "03_accounts_receivable_module.md": "03_Accounts_Receivable_Module.pdf",
        "04_vendor_ap_module.md": "04_Vendor_Module.pdf",
        "05_cash_management_module.md": "05_Cash_Module.pdf",
        "06_closing_and_master_data_modules.md": "06_Closing_and_Master_Data_Modules.pdf",
        "07_developer_and_operations_guide.md": "07_Complete_Middleware_Developer_Reference.pdf"
    }

    for md_name, pdf_name in file_mapping.items():
        md_path = os.path.join(docs_dir, md_name)
        pdf_path = os.path.join(pdf_dir, pdf_name)
        if os.path.exists(md_path):
            try:
                markdown_to_pdf(md_path, pdf_path)
            except Exception as e:
                print(f"Error compiling {md_name}: {e}")
        else:
            print(f"Warning: File not found: {md_path}")

if __name__ == "__main__":
    main()
