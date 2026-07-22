import re, sys
sys.stdout.reconfigure(encoding='utf-8')
with open(r'F:\WFProj\Warframe\[B] Warframes.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Get file stats
lines = content.count('\n') + 1
size = len(content)
print('=== FILE STATS ===')
print(f'Physical lines: {lines}')
print(f'Size: {size:,} bytes ({size/1024/1024:.1f} MB)')
print()

# First ~3000 chars of file
print('=== FILE START (first 3000 chars) ===')
print(content[:3000])
