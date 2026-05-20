with open('index.html', 'rb') as f:
    raw = f.read()

content = raw.decode('utf-8')

# The planning panel currently ends at line 709 (</section> of RDV section)
# then line 710 is blank, then lines 711-731 are "atelier" content (no panel wrapper)
# then lines 733-765 are "livraison" content (no panel wrapper) + malformed closing

# Strategy: find the planning panel's closing </section> that should come after RDV,
# then add proper panel wrappers

# Find the point right after the RDV section closes (after proposal-grid div)
# The planning panel should end after the RDV section
# We need to insert: </section> (close planning) then new atelier panel then new livraison panel

# Current buggy structure (simplified):
# <section data-case-panel="planning">
#   [durations section]
#   [RDV section]
#                          <-- line 710: blank, SHOULD close planning here
#   [atelier content without wrapper]
#   [livraison content without wrapper]
# </section>      </section>   <-- line 765: double close

# The fix: close planning after RDV, wrap atelier content, wrap livraison content

OLD_PLANNING_END = '''          <div class="proposal-grid" data-field="proposals"></div>\r
        </section>\r
      \r
        <section class="detail-section full-width">\r
          <div class="section-heading">\r
            <h2>R\u00e9ception v\u00e9hicule &amp; travaux atelier</h2>'''

NEW_PLANNING_END = '''          <div class="proposal-grid" data-field="proposals"></div>\r
        </section>\r
      </section>\r
\r
      <section class="case-panel" data-case-panel="atelier" hidden>\r
        <section class="detail-section full-width">\r
          <div class="section-heading">\r
            <h2>R\u00e9ception v\u00e9hicule &amp; travaux atelier</h2>'''

OLD_ATELIER_END = '''          <div class="assignment-list" data-field="assignments"></div>\r
        </section>\r
      \r
        <section class="detail-section full-width">\r
          <div class="section-heading">\r
            <h2>Contr\u00f4le qualit\u00e9, livraison &amp; cl\u00f4ture</h2>'''

NEW_ATELIER_END = '''          <div class="assignment-list" data-field="assignments"></div>\r
        </section>\r
      </section>\r
\r
      <section class="case-panel" data-case-panel="livraison" hidden>\r
        <section class="detail-section full-width">\r
          <div class="section-heading">\r
            <h2>Contr\u00f4le qualit\u00e9, livraison &amp; cl\u00f4ture</h2>'''

OLD_LIVRAISON_END = '      </section>      </section>'
NEW_LIVRAISON_END = '      </section>'

checks = [
    (OLD_PLANNING_END, 'planning end split'),
    (OLD_ATELIER_END, 'atelier end split'),
    (OLD_LIVRAISON_END, 'double close fix'),
]

for old, name in checks:
    if old in content:
        print(f"  FOUND: {name}")
    else:
        print(f"  MISSING: {name}")

# Apply all three fixes in order
if OLD_PLANNING_END in content:
    content = content.replace(OLD_PLANNING_END, NEW_PLANNING_END, 1)
    print("Applied: planning panel split")

if OLD_ATELIER_END in content:
    content = content.replace(OLD_ATELIER_END, NEW_ATELIER_END, 1)
    print("Applied: atelier panel added")

if OLD_LIVRAISON_END in content:
    content = content.replace(OLD_LIVRAISON_END, NEW_LIVRAISON_END, 1)
    print("Applied: double close fixed")

with open('index.html', 'wb') as f:
    f.write(content.encode('utf-8'))

print("Done.")

# Verify
result = open('index.html', encoding='utf-8').read()
for p in ['claims', 'photos', 'planning', 'atelier', 'livraison']:
    tag = f'data-case-panel="{p}"'
    found = tag in result
    print(f'  panel {p}: {"OK" if found else "MISSING"}')
