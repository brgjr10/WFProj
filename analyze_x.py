import re, sys
sys.stdout.reconfigure(encoding='utf-8')
with open(r'F:\WFProj\Warframe\[B] Warframes.html', 'r', encoding='utf-8') as f:
    content = f.read()
tbody_start = content.find('<tbody>')
tbody_end = content.find('</tbody>')
tbody = content[tbody_start:tbody_end+8]
rows = re.findall(r'<tr.*?</tr>', tbody, re.DOTALL)

print('All X occurrences with context:')
for r_idx, row in enumerate(rows):
    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
    for c_idx, c in enumerate(cells):
        clean = re.sub(r'<[^>]+>', '', c).strip()
        if clean == 'X':
            context = []
            for j in range(max(0, c_idx-3), min(len(cells), c_idx+4)):
                v = re.sub(r'<[^>]+>', '', cells[j]).strip()
                if v:
                    context.append(f'Col{j}={v[:30]}')
            print(f'Row {r_idx}, Col {c_idx}: ' + ' | '.join(context))
