with open('index.html', 'rb') as f:
    raw = f.read()

content = raw.decode('utf-8')

# Find the planning panel and split it
PLANNING_START = '      <section class="case-panel" data-case-panel="planning" hidden>'
PLANNING_END = '      </section>\r\n    </template>'

start_idx = content.index(PLANNING_START)
end_idx = content.index(PLANNING_END, start_idx)

planning_block = content[start_idx:end_idx]
print(f"Found planning block ({len(planning_block)} chars)")
print("First 100:", repr(planning_block[:100]))
print("Last 100:", repr(planning_block[-100:]))

# Build the 3 new panels
DURATIONS_SECTION = '''        <section class="detail-section full-width">\r
          <div class="section-heading">\r
            <h2>Dur\u00e9es estim\u00e9es</h2>\r
            <span>Total atelier: <strong data-field="total-duration"></strong></span>\r
          </div>\r
          <div class="duration-grid" data-field="durations"></div>\r
        </section>'''

RDV_SECTION = '''        <section class="detail-section full-width">\r
          <div class="section-heading">\r
            <h2>Prise / report de rendez-vous</h2>\r
            <button class="primary-button" type="button" id="generate-proposals">\r
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>\r
              Calculer RDV\r
            </button>\r
          </div>\r
          <div class="appointment-actions">\r
            <button class="ghost-button" type="button" id="mark-no-show">Client absent / RDV manqu\u00e9</button>\r
            <button class="ghost-button" type="button" id="reschedule-appointment">Reporter le RDV</button>\r
          </div>\r
          <div class="proposal-grid" data-field="proposals"></div>\r
        </section>'''

new_panels = (
    '      <section class="case-panel" data-case-panel="planning" hidden>\r\n'
    + DURATIONS_SECTION + '\r\n'
    + RDV_SECTION + '\r\n'
    + '      </section>\r\n'
    + '\r\n'
    + '      <section class="case-panel" data-case-panel="atelier" hidden>\r\n'
    + '        <section class="detail-section full-width">\r\n'
    + '          <div class="section-heading">\r\n'
    + '            <h2>R\u00e9ception v\u00e9hicule &amp; travaux atelier</h2>\r\n'
    + '            <span data-field="delivery-estimate"></span>\r\n'
    + '          </div>\r\n'
    + '          <div class="approval-row">\r\n'
    + '            <button class="primary-button" type="button" data-action-flag="received">\r\n'
    + '              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>\r\n'
    + '              Confirmer v\u00e9hicule re\u00e7u\r\n'
    + '            </button>\r\n'
    + '            <button class="primary-button" type="button" data-action-flag="workStarted">\r\n'
    + '              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>\r\n'
    + '              D\u00e9marrer travaux\r\n'
    + '            </button>\r\n'
    + '            <button class="primary-button" type="button" data-action-flag="workCompleted">\r\n'
    + '              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>\r\n'
    + '              Terminer travaux\r\n'
    + '            </button>\r\n'
    + '          </div>\r\n'
    + '          <div class="assignment-list" data-field="assignments"></div>\r\n'
    + '        </section>\r\n'
    + '      </section>\r\n'
    + '\r\n'
    + '      <section class="case-panel" data-case-panel="livraison" hidden>\r\n'
    + '        <section class="detail-section full-width">\r\n'
    + '          <div class="section-heading">\r\n'
    + '            <h2>Contr\u00f4le qualit\u00e9, livraison &amp; cl\u00f4ture</h2>\r\n'
    + '          </div>\r\n'
    + '          <div class="approval-row">\r\n'
    + '            <label class="check-card"><input type="checkbox" data-toggle="qualityApproved" /><span>Contr\u00f4le qualit\u00e9 valid\u00e9</span></label>\r\n'
    + '            <label class="check-card"><input type="checkbox" data-toggle="delivered" /><span>Livraison effectu\u00e9e</span></label>\r\n'
    + '            <label class="check-card"><input type="checkbox" data-toggle="invoiced" /><span>Dossier Factur\u00e9 &amp; Cl\u00f4tur\u00e9</span></label>\r\n'
    + '          </div>\r\n'
    + '          <div class="quality-checklist" data-field="quality-checklist"></div>\r\n'
    + '        </section>\r\n'
    + '        <section class="detail-section full-width">\r\n'
    + '          <div class="section-heading">\r\n'
    + '            <h2>Dossier Windows complet</h2>\r\n'
    + '            <div class="case-actions">\r\n'
    + '              <button class="primary-button" type="button" id="export-case-folder">\r\n'
    + '                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>\r\n'
    + '                Exporter dossier ZIP\r\n'
    + '              </button>\r\n'
    + '              <button class="ghost-button" type="button" id="export-client-folder">Exporter dossier client</button>\r\n'
    + '              <button class="ghost-button danger-button" type="button" id="delete-case">Supprimer dossier</button>\r\n'
    + '            </div>\r\n'
    + '          </div>\r\n'
    + '          <p class="muted" data-field="dossier-export-summary"></p>\r\n'
    + '        </section>\r\n'
    + '        <section class="detail-section full-width">\r\n'
    + '          <div class="section-heading">\r\n'
    + '            <h2>Historique du dossier</h2>\r\n'
    + '            <span data-field="history-count"></span>\r\n'
    + '          </div>\r\n'
    + '          <div class="history-list" data-field="history"></div>\r\n'
    + '        </section>\r\n'
    + '      </section>'
)

new_content = content[:start_idx] + new_panels + content[end_idx:]

with open('index.html', 'wb') as f:
    f.write(new_content.encode('utf-8'))

print('SUCCESS: panels split correctly')
print(f'Original length: {len(content)}, New length: {len(new_content)}')
