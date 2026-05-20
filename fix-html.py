import re

with open('index.html', 'r', encoding='utf8') as f:
    html = f.read()

# Merge infos
html = re.sub(r'</section>\s*<section class="case-panel" data-case-panel="infos" hidden>', '', html)

# Merge atelier
html = re.sub(r'</section>\s*<section class="case-panel" data-case-panel="atelier" hidden>', '', html)

# Merge livraison
html = re.sub(r'</section>\s*<section class="case-panel" data-case-panel="livraison" hidden>', '', html)

with open('index.html', 'w', encoding='utf8') as f:
    f.write(html)
