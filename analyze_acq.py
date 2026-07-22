import re, sys
sys.stdout.reconfigure(encoding='utf-8')
with open(r'F:\WFProj\Warframe\[B] Warframes.html', 'r', encoding='utf-8') as f:
    content = f.read()
tbody_start = content.find('<tbody>')
tbody_end = content.find('</tbody>')
tbody = content[tbody_start:tbody_end+8]
rows = re.findall(r'<tr.*?</tr>', tbody, re.DOTALL)

# Search all rows for acquisition keywords
acq_keywords = ['Acquisition', 'Relic', 'Drop', 'Vaulted', 'Market', 'Foundry', 'Blueprint', 'Boss', 'Farm', 'Cipher', 'Merchant', 'Store', 'Purchase', 'Craft', 'Research', 'Clan', 'Dojo', 'Syndicate', 'Alert', 'Event', 'Quest', 'Nightwave', 'Sortie', 'Steel Path', 'Baro', 'Trading', 'Standing', 'Rank', 'Grendel', 'Fortuna', 'Deimos', 'Standing', 'Eris', 'Ceres', 'Jupiter', 'Neptune', 'Sedna', 'Zariman', 'Kahl', 'Garrison', 'Duviri', 'Granum', 'Eidolon', 'Orb', 'Vallis', 'Cambion', 'Drift', 'Tempestarii', 'Waverider', 'Ropalolyst', 'Assassination']
acq_locations = []

for r_idx, row in enumerate(rows):
    cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
    for c_idx, c in enumerate(cells):
        clean = re.sub(r'<[^>]+>', '', c).strip()
        for kw in acq_keywords:
            if kw.lower() in clean.lower():
                acq_locations.append((r_idx, c_idx, kw, clean))
                break

print(f'Total acquisition keyword cells: {len(acq_locations)}')
# Remove Craft duplicates and focus on non-Craft
real_acq = [x for x in acq_locations if x[2] != 'Craft']
print(f'Non-Craft acquisition cells: {len(real_acq)}')
for r, c, kw, txt in real_acq:
    print(f'Row {r}, Col {c}: [{kw}] {txt}')
