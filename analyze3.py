import re, sys
sys.stdout.reconfigure(encoding='utf-8')
with open(r'F:\WFProj\Warframe\[B] Warframes.html', 'r', encoding='utf-8') as f:
    content = f.read()
tbody_start = content.find('<tbody>')
tbody_end = content.find('</tbody>')
tbody = content[tbody_start:tbody_end+8]
rows = re.findall(r'<tr.*?</tr>', tbody, re.DOTALL)

# Build column header map by examining rows 0-5
print('=== COLUMN HEADER MAPPING ===')
for r_idx in range(0, 6):
    row = rows[r_idx]
    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
    non_empty = [(j, re.sub(r'<[^>]+>', '', c).strip()) for j, c in enumerate(cells)]
    non_empty = [(j, v) for j, v in non_empty if v and v != '&nbsp;']
    print(f'Row {r_idx} (non-empty cols): {[j for j,v in non_empty]}')
    for j, v in non_empty[:25]:
        print(f'  Col {j}: {v[:80]}')
    print()

# Identify sections by looking at unique row patterns
print('=== SECTION ANALYSIS ===')
for r_idx, row in enumerate(rows[:70]):
    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
    non_empty = [(j, re.sub(r'<[^>]+>', '', c).strip()) for j, c in enumerate(cells)]
    non_empty = [(j, v) for j, v in non_empty if v and v != '&nbsp;']
    if non_empty:
        # Determine section type
        first_vals = [v for j,v in non_empty[:5]]
        section = 'unknown'
        if any('Complete' in v for v in first_vals):
            section = 'summary/status'
        elif any('Prime' in v for v in first_vals) and any('X' in v for v in first_vals):
            section = 'prime_data'
        elif 'Acquisition' in first_vals:
            section = 'acquisition_header'
        elif len([v for j,v in non_empty if j >= 15]) > 5:
            section = 'companion_or_weapon'
        print(f'Row {r_idx}: section={section}, cols={[j for j,v in non_empty[:5]]}')
