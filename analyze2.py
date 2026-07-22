import re, sys
sys.stdout.reconfigure(encoding='utf-8')
with open(r'F:\WFProj\Warframe\[B] Warframes.html', 'r', encoding='utf-8') as f:
    content = f.read()
tbody_start = content.find('<tbody>')
tbody_end = content.find('</tbody>')
tbody = content[tbody_start:tbody_end+8]
rows = re.findall(r'<tr.*?</tr>', tbody, re.DOTALL)

# Check rows 60-100 and 800-863
print('Rows 60-100:')
for r_idx in range(60, 100):
    row = rows[r_idx]
    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
    non_empty = [(j, re.sub(r'<[^>]+>', '', c).strip()) for j, c in enumerate(cells)]
    non_empty = [(j, v) for j, v in non_empty if v and v != '&nbsp;']
    if non_empty:
        print(f'Row {r_idx}:')
        for j, v in non_empty[:20]:
            print(f'  {j}: {v[:100]}')
    else:
        print(f'Row {r_idx}: [empty]')

print('\nLast 10 rows:')
for r_idx in range(len(rows)-10, len(rows)):
    row = rows[r_idx]
    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
    non_empty = [(j, re.sub(r'<[^>]+>', '', c).strip()) for j, c in enumerate(cells)]
    non_empty = [(j, v) for j, v in non_empty if v and v != '&nbsp;']
    if non_empty:
        print(f'Row {r_idx}:')
        for j, v in non_empty[:20]:
            print(f'  {j}: {v[:100]}')
    else:
        print(f'Row {r_idx}: [empty]')
