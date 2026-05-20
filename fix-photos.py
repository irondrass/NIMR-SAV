with open('index.html', 'rb') as f:
    content = f.read().decode('utf-8')

# Fix 1: repair the broken photos panel
# Current broken state (lines 632-638):
# <label class="file-button">
#   <input type="file" id="photo-input" accept="image/*" multiple />
#   <svg viewBox="0 0 24 24" aria-hidden      </section>   <-- BROKEN
#   <p class="muted">...supplements astuce...</p>
#   <div class="supplement-list" ...></div>
# </section>
# </section>

# We need to replace lines 632-638 with the correct photos panel ending

BROKEN_PHOTOS = '''            <label class="file-button">\r
              <input type="file" id="photo-input" accept="image/*" multiple />\r
              <svg viewBox="0 0 24 24" aria-hidden      </section>\r
         <p class="muted">Astuce\u00a0: ajoutez les photos justificatives dans l\u2019onglet Photos avec la cat\u00e9gorie \u201cCompl\u00e9ment avant accord\u201d.</p>\r
          <div class="supplement-list" data-field="supplements"></div>\r
        </section>\r
      </section>'''

FIXED_PHOTOS = '''            <label class="file-button">\r
              <input type="file" id="photo-input" accept="image/*" multiple />\r
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l2-2h6l2 2h3v12H4z" /><circle cx="12" cy="13" r="3" /></svg>\r
              Ajouter\r
            </label>\r
          </div>\r\n          <div class="photo-grid" data-field="photos"></div>\r
        </section>\r
      </section>'''

if BROKEN_PHOTOS in content:
    content = content.replace(BROKEN_PHOTOS, FIXED_PHOTOS, 1)
    print("Fixed: photos panel restored")
else:
    print("ERROR: broken photos pattern not found")
    # Debug
    lines = content.split('\n')
    for i, line in enumerate(lines[630:640], start=631):
        print(f"{i}: {repr(line[:120])}")

with open('index.html', 'wb') as f:
    f.write(content.encode('utf-8'))

# Verify panels
result = open('index.html', encoding='utf-8').read()
for p in ['claims', 'photos', 'planning', 'atelier', 'livraison']:
    tag = f'data-case-panel="{p}"'
    found = tag in result
    print(f'  panel {p}: {"OK" if found else "MISSING"}')

# Check for supplement-form in atelier
if 'data-case-panel="atelier"' in result:
    atelier_start = result.index('data-case-panel="atelier"')
    atelier_end = result.index('data-case-panel="livraison"')
    atelier_content = result[atelier_start:atelier_end]
    print(f'  supplement-form in atelier: {"OK" if "supplement-form" in atelier_content else "MISSING"}')

# Check supplement-form NOT in photos
if 'data-case-panel="photos"' in result:
    photos_start = result.index('data-case-panel="photos"')
    photos_end = result.index('data-case-panel="planning"')
    photos_content = result[photos_start:photos_end]
    print(f'  supplement-form NOT in photos: {"OK" if "supplement-form" not in photos_content else "STILL THERE"}')

print("Done.")
