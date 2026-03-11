document.addEventListener('DOMContentLoaded', () => {
    // === ESTADO ===
    let db = null;
    let allSheetsData = {};
    let currentClinic = '';
    let calibrationDates = {};
    let instrumentsBank = [];
    let savedTemplates = [];
    let selectedSerieForEdit = null;

    // === SCHEMAS ===
    const SCHEMA_81 = [
        { code: '8.1.1', label: 'Sensores', row: 34 },
        { code: '8.1.2', label: 'Ubicación de los sensores', row: 35 },
        { code: '8.1.3', label: 'Vainas de sensores', row: 36 },
        { code: '8.1.4', label: 'Cables UTP', row: 37 },
        { code: '8.1.5', label: 'Interfaces LAN', row: 38 },
        { code: '8.1.6', label: 'Fuentes de alimentación', row: 39 },
    ];

    const EVALUATION_SCHEMA = [
        { label: 'Inspección superada, el equipo es apto para el uso', row: 29 },
        { label: 'El equipo ha necesitado reparación', row: 30 },
        { label: 'El equipo no está reparado. No se puede usar', row: 31 },
    ];

    const DB_NAME = 'CalibracionesDB_Mondis2_Standard_v1';
    const DB_VERSION = 1;

    // === DOM ELEMENTS ===
    const fileInput = document.getElementById('fileInput');
    const fileLabel = document.getElementById('fileLabel');
    const mainContent = document.getElementById('mainContent');
    const sheetSelector = document.getElementById('sheetSelector');
    const serieFilter = document.getElementById('serieFilter');
    const equiposTableBody = document.getElementById('equiposTableBody');
    const editModal = document.getElementById('editModal');
    const sensorsContainer = document.getElementById('sensorsContainer');
    const addSensorBlockBtn = document.getElementById('addSensorBlockBtn');
    const signatureCanvas = document.getElementById('signatureCanvas');
    const clearSignatureBtn = document.getElementById('clearSignatureBtn');
    const ctx = signatureCanvas.getContext('2d');
    const templateSelector = document.getElementById('templateSelector');
    const certFileInput = document.getElementById('certFileInput');
    const saveNewTemplateBtn = document.getElementById('saveNewTemplateBtn');
    const saveTemplateRow = document.getElementById('saveTemplateRow');
    const templateNameInput = document.getElementById('templateNameInput');

    // === INIT ===
    async function init() {
        try {
            await initDB();
            await loadSavedData();
            await loadTemplates();
            setupCanvas();
            setupEventListeners();
        } catch (err) {
            console.error('Init error:', err);
        }
    }

    function initDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains('calibrations')) d.createObjectStore('calibrations', { keyPath: 'serie' });
                if (!d.objectStoreNames.contains('appData')) d.createObjectStore('appData', { keyPath: 'id' });
                if (!d.objectStoreNames.contains('templates')) d.createObjectStore('templates', { keyPath: 'id', autoIncrement: true });
            };
            req.onsuccess = e => { db = e.target.result; resolve(); };
            req.onerror = e => reject(e.target.error);
        });
    }

    // --- PERSISTENCE ---
    async function loadSavedData() {
        if (!db) return;
        const tx = db.transaction('appData', 'readonly');
        const last = await new Promise(r => { const q = tx.objectStore('appData').get('lastExcel'); q.onsuccess = () => r(q.result); });
        if (!last) return;
        allSheetsData = last.allSheetsData;
        currentClinic = last.currentClinic;
        sheetSelector.innerHTML = '';
        last.sheetNames.forEach(n => {
            const o = document.createElement('option'); o.value = o.textContent = n;
            if (n === currentClinic) o.selected = true;
            sheetSelector.appendChild(o);
        });
        fileLabel.textContent = `✅ ${last.filename} (Recuperado)`;
        mainContent.classList.remove('hidden');
        document.getElementById('configActions').classList.remove('hidden');
        renderTable();
    }

    async function loadTemplates() {
        if (!db) return;
        const tx = db.transaction('templates', 'readonly');
        savedTemplates = await new Promise(r => { const q = tx.objectStore('templates').getAll(); q.onsuccess = () => r(q.result); });
        templateSelector.innerHTML = '<option value="">-- Seleccionar Plantilla --</option>';
        savedTemplates.forEach(t => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; templateSelector.appendChild(o); });
    }

    function updateInstrumentsBank() {
        const uniq = new Map();
        Object.values(calibrationDates).forEach(c => {
            (c.instruments || []).forEach(i => {
                if (i.name && !uniq.has(i.name.toUpperCase())) uniq.set(i.name.toUpperCase(), i);
            });
        });
        instrumentsBank = Array.from(uniq.values());
        const dl = document.getElementById('instrumentsHistory');
        if (dl) {
            dl.innerHTML = '';
            instrumentsBank.forEach(i => { const o = document.createElement('option'); o.value = i.name; dl.appendChild(o); });
        }
    }

    // --- SIGNATURE PAD ---
    let drawing = false;
    function setupCanvas() {
        const resize = () => {
            const rect = signatureCanvas.getBoundingClientRect();
            signatureCanvas.width = rect.width;
            signatureCanvas.height = 150;
        };
        window.addEventListener('resize', resize);
        resize();

        signatureCanvas.onmousedown = () => drawing = true;
        window.onmouseup = () => drawing = false;
        signatureCanvas.onmousemove = e => {
            if (!drawing) return;
            const rect = signatureCanvas.getBoundingClientRect();
            ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#fff';
            ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
            ctx.stroke(); ctx.beginPath(); ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
        };
        clearSignatureBtn.onclick = () => { ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height); ctx.beginPath(); };
    }

    // --- SENSOR BLOCKS ---
    function createSensorBlock(data = {}) {
        const div = document.createElement('div');
        div.className = 'sensor-block';
        div.innerHTML = `
            <div class="sensor-header">
                <input type="text" class="sensor-id" placeholder="ID Sensor" value="${data.sensorId || ''}" style="flex: 2; min-width: 150px;">
                <input type="text" class="sensor-location" placeholder="Ubicación" value="${data.location || ''}" style="flex: 1; min-width: 120px; margin-left: 10px;">
                <button type="button" class="btn btn-danger btn-small remove-sensor-btn" style="margin-left: 10px;">×</button>
            </div>
            <div class="readings-grid">
                ${[1, 2, 3].map(n => `
                <div class="reading-col">
                    <label>Lectura ${n}</label>
                    <input type="number" step="any" class="s-val" placeholder="ID Sensor/Valor" value="${data['s' + n] || ''}" style="flex: 1;">
                    <input type="number" step="any" class="p-val" placeholder="Patrón" value="${data['p' + n] || ''}" style="flex: 1;">
                </div>`).join('')}
            </div>
        `;
        div.querySelector('.remove-sensor-btn').onclick = () => div.remove();
        sensorsContainer.appendChild(div);
    }
    addSensorBlockBtn.onclick = () => createSensorBlock();

    // --- STATISTICS ---
    function calculateStats(sArr, pArr, fixed) {
        if (sArr.length < 2 || pArr.length < 2) return { Uc: 0, ES: 0, ETtx: 0, Corr: 0 };
        const meanS = sArr.reduce((a, b) => a + b, 0) / sArr.length;
        const meanP = pArr.reduce((a, b) => a + b, 0) / pArr.length;
        const stdS = Math.sqrt(sArr.map(x => Math.pow(x - meanS, 2)).reduce((a, b) => a + b, 0) / (sArr.length - 1));
        const stdP = Math.sqrt(pArr.map(x => Math.pow(x - meanP, 2)).reduce((a, b) => a + b, 0) / (pArr.length - 1));
        const ES = Math.abs(meanS - meanP);
        let Up = fixed.up29;
        if (meanP <= -70) Up = fixed.up70;
        else if (meanP <= -20.1) Up = fixed.up20;
        const maxUp = Math.max(fixed.up70, fixed.up20, fixed.up29);
        const Uc = 2 * Math.sqrt(Math.pow(stdS, 2) + Math.pow(stdP, 2) + 0.084 * Math.pow(Up, 2) + 0.084 * Math.pow(fixed.rp, 2) + 0.25 * Math.pow(maxUp, 2));
        return { Uc, ES, ETtx: ES + Uc, Corr: meanP - meanS };
    }

    // --- EVENT LISTENERS ---
    function setupEventListeners() {
        const dropZone = document.getElementById('dropZone');
        dropZone.onclick = () => fileInput.click();
        dropZone.ondragover = e => { e.preventDefault(); dropZone.classList.add('active'); };
        dropZone.ondragleave = () => dropZone.classList.remove('active');
        dropZone.ondrop = e => {
            e.preventDefault(); dropZone.classList.remove('active');
            const file = e.dataTransfer.files[0]; if (file) handleExcelUpload(file);
        };
        fileInput.onchange = e => { const file = e.target.files[0]; if (file) handleExcelUpload(file); };

        certFileInput.onchange = async e => {
            const file = e.target.files[0]; if (!file) return;
            const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
            saveTemplateRow.classList.toggle('hidden', !isExcel);
        };

        saveNewTemplateBtn.onclick = async () => {
            const file = certFileInput.files[0], name = templateNameInput.value.trim();
            if (!file || !name) { alert('Falta archivo o nombre'); return; }
            const tx = db.transaction('templates', 'readwrite');
            tx.objectStore('templates').add({ name, blob: file });
            tx.oncomplete = () => { alert('✅ Plantilla guardada'); templateNameInput.value = ''; saveTemplateRow.classList.add('hidden'); loadTemplates(); };
        };

        sheetSelector.onchange = e => { currentClinic = e.target.value; renderTable(); };
        serieFilter.oninput = renderTable;
        document.getElementById('saveCalibBtn').onclick = saveCalibration;
        document.getElementById('closeModalBtn').onclick = () => editModal.classList.add('hidden');
        document.getElementById('addInstrumentBtn').onclick = () => createInstrumentRow();
        document.getElementById('clearDataBtn').onclick = () => { if (confirm('¿Borrar datos cargados?')) { db.transaction('appData', 'readwrite').objectStore('appData').delete('lastExcel'); location.reload(); } };

        document.getElementById('exportBackupBtn').onclick = exportBackup;
        document.getElementById('importBackupBtn').onclick = () => document.getElementById('importBackupFile').click();
        document.getElementById('importBackupFile').onchange = importBackup;
    }

    function createInstrumentRow(data = {}) {
        const div = document.createElement('div'); div.className = 'instrument-item';
        div.innerHTML = `
            <button type="button" class="remove-instrument">×</button>
            <div class="field-group full-width"><label>Instrumento</label><input type="text" class="inst-name" list="instrumentsHistory" value="${data.name || ''}"></div>
            <div class="field-group"><label>Marca</label><input type="text" class="inst-brand" value="${data.brand || ''}"></div>
            <div class="field-group"><label>N° Serie</label><input type="text" class="inst-serie" value="${data.serie || ''}"></div>
        `;
        div.querySelector('.remove-instrument').onclick = () => div.remove();
        document.getElementById('instrumentsContainer').appendChild(div);
    }

    async function handleExcelUpload(file) {
        const reader = new FileReader();
        reader.onload = ev => {
            const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
            allSheetsData = {}; sheetSelector.innerHTML = '';
            wb.SheetNames.forEach(name => {
                allSheetsData[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' });
                const opt = document.createElement('option'); opt.value = opt.textContent = name;
                sheetSelector.appendChild(opt);
            });
            currentClinic = wb.SheetNames[0]; fileLabel.textContent = `✅ ${file.name}`;
            db.transaction('appData', 'readwrite').objectStore('appData').put({ id: 'lastExcel', filename: file.name, allSheetsData, sheetNames: wb.SheetNames, currentClinic });
            mainContent.classList.remove('hidden'); document.getElementById('configActions').classList.remove('hidden');
            renderTable();
        };
        reader.readAsArrayBuffer(file);
    }

    async function renderTable() {
        await fetchCalibrations();
        const rows = allSheetsData[currentClinic] || [];
        const search = serieFilter.value.toUpperCase();
        equiposTableBody.innerHTML = '';
        let stats = { total: 0, ok: 0 };
        rows.forEach(row => {
            const keys = Object.keys(row);
            const serieKey = keys.find(k => k.toLowerCase().includes('serie') || k.toLowerCase().includes('n°') || k.toLowerCase().includes('sensor'));
            if (!serieKey) return;
            const serie = String(row[serieKey] || '').toUpperCase().trim();
            if (!serie) return;
            if (search && !serie.includes(search)) return;
            stats.total++;
            const cal = calibrationDates[serie];
            if (cal) stats.ok++;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row['Equipo'] || row['Nombre'] || row['Ubicacion'] || 'N/A'}</td>
                <td>${serie}</td>
                <td>${cal ? cal.date : '-'}</td>
                <td>${cal ? cal.technician : '-'}</td>
                <td>${cal?.certName ? `<button class="btn btn-secondary btn-small" onclick="viewCertificate('${serie}')">📄</button>` : '-'}</td>
                <td><span class="status-badge ${cal ? 'status-ok' : ''}">${cal ? 'OK' : 'Pendiente'}</span></td>
                <td><button class="btn btn-secondary btn-small" onclick="openEditModal('${serie}')">✏️ Editar</button></td>
            `;
            equiposTableBody.appendChild(tr);
        });
        document.getElementById('totalEquipos').querySelector('.val').textContent = stats.total;
    }

    window.viewCertificate = (serie) => {
        const cal = calibrationDates[serie];
        if (cal?.certificate) {
            const url = (cal.certificate instanceof Blob) ? URL.createObjectURL(cal.certificate) : cal.certificate;
            window.open(url, '_blank');
        }
    };

    window.openEditModal = (serie) => {
        selectedSerieForEdit = serie;
        const cal = calibrationDates[serie] || {};
        const rows = allSheetsData[currentClinic] || [];
        const serieKey = Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes('serie') || k.toLowerCase().includes('n°') || k.toLowerCase().includes('sensor'));
        const eq = rows.find(r => String(r[serieKey] || '').toUpperCase().trim() === serie) || {};

        document.getElementById('equipmentNameInput').value = cal.editedName || eq['Equipo'] || eq['Nombre'] || eq['Ubicacion'] || '';
        document.getElementById('modalSerieInput').value = serie;
        document.getElementById('brandInput').value = cal.brand || eq['Marca'] || '';
        document.getElementById('modelInput').value = cal.model || eq['Modelo'] || '';
        document.getElementById('calibDateInput').value = cal.date || '';
        document.getElementById('ordenMInput').value = cal.ordenM || '';
        document.getElementById('technicianInput').value = cal.technician || '';
        document.getElementById('commentsInput').value = cal.comments || '';
        document.getElementById('certStatus').textContent = cal.certName ? `Certificado: ${cal.certName}` : 'Sin certificado';

        renderInspectionPoints(cal.inspections || {});
        renderEvaluationStatus(cal.evaluations || {});
        instrumentsContainer.innerHTML = '';
        if (cal.instruments?.length) cal.instruments.forEach(i => createInstrumentRow(i));
        sensorsContainer.innerHTML = '';
        if (cal.sensors?.length) cal.sensors.forEach(s => createSensorBlock(s)); else createSensorBlock();
        ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
        if (cal.signature) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0); img.src = cal.signature; }
        editModal.classList.remove('hidden');
    };

    function renderInspectionPoints(saved) {
        const cont = document.getElementById('inspectionPointsContainer'); cont.innerHTML = '';
        SCHEMA_81.forEach(item => {
            const val = saved[item.code] || 'na';
            const row = document.createElement('div'); row.className = 'inspection-row';
            row.innerHTML = `<div class="inspection-label"><span>${item.code}</span> ${item.label}</div>
                <div class="inspection-options" data-code="${item.code}">
                    ${['P', 'F', 'na'].map(v => `<div class="inspection-opt ${val === v ? 'selected' : ''}" data-val="${v}">${v === 'na' ? 'N/A' : v}</div>`).join('')}
                </div>`;
            row.querySelectorAll('.inspection-opt').forEach(opt => opt.onclick = () => {
                row.querySelectorAll('.inspection-opt').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
            });
            cont.appendChild(row);
        });
    }

    function renderEvaluationStatus(saved) {
        const cont = document.getElementById('evaluationStatusContainer'); cont.innerHTML = '';
        EVALUATION_SCHEMA.forEach(item => {
            const val = saved[item.label] || '';
            const row = document.createElement('div'); row.className = 'inspection-row';
            row.innerHTML = `<div class="inspection-label">${item.label}</div>
                <div class="inspection-options" data-label="${item.label}">
                    ${['SI', 'NA'].map(v => `<div class="inspection-opt ${val === v ? 'selected' : ''}" data-val="${v}">${v}</div>`).join('')}
                </div>`;
            row.querySelectorAll('.inspection-opt').forEach(opt => opt.onclick = () => {
                row.querySelectorAll('.inspection-opt').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
            });
            cont.appendChild(row);
        });
    }

    async function saveCalibration() {
        try {
            const serie = selectedSerieForEdit;
            const sensorBlocks = Array.from(sensorsContainer.querySelectorAll('.sensor-block')).map(b => ({
                sensorId: b.querySelector('.sensor-id').value,
                location: b.querySelector('.sensor-location').value,
                s1: parseFloat(b.querySelectorAll('.s-val')[0].value) || null,
                p1: parseFloat(b.querySelectorAll('.p-val')[0].value) || null,
                s2: parseFloat(b.querySelectorAll('.s-val')[1].value) || null,
                p2: parseFloat(b.querySelectorAll('.p-val')[1].value) || null,
                s3: parseFloat(b.querySelectorAll('.s-val')[2].value) || null,
                p3: parseFloat(b.querySelectorAll('.p-val')[2].value) || null,
            }));
            const inspections = {}; document.querySelectorAll('#inspectionPointsContainer .inspection-options').forEach(g => inspections[g.dataset.code] = g.querySelector('.selected')?.dataset.val);
            const evaluations = {}; document.querySelectorAll('#evaluationStatusContainer .inspection-options').forEach(g => evaluations[g.dataset.label] = g.querySelector('.selected')?.dataset.val);
            const fixed = {
                up70: parseFloat(document.getElementById('fixedUp70').value), up20: parseFloat(document.getElementById('fixedUp20').value),
                up29: parseFloat(document.getElementById('fixedUp29').value), rp: parseFloat(document.getElementById('fixedRp').value),
                rx: parseFloat(document.getElementById('fixedRx').value),
            };
            const instruments = Array.from(instrumentsContainer.querySelectorAll('.instrument-item')).map(div => ({
                name: div.querySelector('.inst-name').value, brand: div.querySelector('.inst-brand').value, serie: div.querySelector('.inst-serie').value
            }));

            let certFile = certFileInput.files[0];
            const selectedTmplId = templateSelector.value;
            const tmpl = savedTemplates.find(t => String(t.id) === String(selectedTmplId));

            let finalCert = calibrationDates[serie]?.certificate || null;
            let certName = calibrationDates[serie]?.certName || '';

            if (certFile) {
                finalCert = certFile; certName = certFile.name;
                if (certFile.name.endsWith('.xlsx') || certFile.name.endsWith('.xls')) {
                    finalCert = await updateExcelCertificate(certFile, {
                        date: document.getElementById('calibDateInput').value, ordenM: document.getElementById('ordenMInput').value,
                        technician: document.getElementById('technicianInput').value, sensors: sensorBlocks, inspections, evaluations, fixed,
                        signature: signatureCanvas.toDataURL(), brand: document.getElementById('brandInput').value, model: document.getElementById('modelInput').value,
                        editedName: document.getElementById('equipmentNameInput').value, editedSerie: serie
                    });
                }
            } else if (tmpl) {
                finalCert = await updateExcelCertificate(tmpl.blob, {
                    date: document.getElementById('calibDateInput').value, ordenM: document.getElementById('ordenMInput').value,
                    technician: document.getElementById('technicianInput').value, sensors: sensorBlocks, inspections, evaluations, fixed,
                    signature: signatureCanvas.toDataURL(), brand: document.getElementById('brandInput').value, model: document.getElementById('modelInput').value,
                    editedName: document.getElementById('equipmentNameInput').value, editedSerie: serie
                });
                certName = `Certificado_${serie}.xlsx`;
            }

            const data = {
                serie, date: document.getElementById('calibDateInput').value, technician: document.getElementById('technicianInput').value,
                ordenM: document.getElementById('ordenMInput').value, comments: document.getElementById('commentsInput').value,
                brand: document.getElementById('brandInput').value, model: document.getElementById('modelInput').value,
                editedName: document.getElementById('equipmentNameInput').value, sensors: sensorBlocks, inspections, evaluations,
                fixed, instruments, signature: signatureCanvas.toDataURL(), certificate: finalCert, certName: certName
            };

            const tx = db.transaction('calibrations', 'readwrite');
            tx.objectStore('calibrations').put(data);
            tx.oncomplete = () => { alert('✅ Registro Mondis2 guardado.'); editModal.classList.add('hidden'); renderTable(); };
            tx.onerror = e => alert('Error DB: ' + e.target.error);
        } catch (err) {
            console.error(err); alert('Error al guardar: ' + err.message);
        }
    }

    async function updateExcelCertificate(tmplBlob, d) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await tmplBlob.arrayBuffer());
        // Robusta detección de la hoja requerida
        const ws = wb.getWorksheet('Certificado') || wb.getWorksheet(1) || wb.worksheets[0];
        if (!ws) throw new Error('No se encontró una hoja válida en la plantilla.');
        ws.getCell('H8').value = d.date; ws.getCell('H9').value = d.ordenM; ws.getCell('H10').value = d.technician;
        // Inyectar datos básicos
        ws.getCell('H5').value = d.editedName; ws.getCell('H6').value = d.brand; ws.getCell('H7').value = d.model;

        SCHEMA_81.forEach(item => { const val = d.inspections[item.code] || ''; ws.getCell(`K${item.row}`).value = val === 'P' ? 'x' : (val === 'F' ? 'F' : 'NA'); });
        d.sensors.forEach((s, i) => {
            const baseRow = 43 + (i * 3); ws.getCell('A' + baseRow).value = s.location; ws.getCell('C' + baseRow).value = s.sensorId;
            ws.getCell('H' + baseRow).value = s.s1; ws.getCell('I' + baseRow).value = s.p1;
            ws.getCell('H' + (baseRow + 1)).value = s.s2; ws.getCell('I' + (baseRow + 1)).value = s.p2;
            ws.getCell('H' + (baseRow + 2)).value = s.s3; ws.getCell('I' + (baseRow + 2)).value = s.p3;
            const stats = calculateStats([s.s1, s.s2, s.s3].filter(x => x !== null), [s.p1, s.p2, s.p3].filter(x => x !== null), d.fixed);
            ws.getCell('K' + baseRow).value = stats.Uc; ws.getCell('L' + baseRow).value = stats.ES;
            ws.getCell('M' + baseRow).value = stats.ETtx; ws.getCell('N' + baseRow).value = stats.Corr;
        });
        if (d.signature) {
            const imageId = wb.addImage({ base64: d.signature, extension: 'png' });
            ws.addImage(imageId, { tl: { col: 13, row: 13 }, ext: { width: 100, height: 40 } });
        }
        const buffer = await wb.xlsx.writeBuffer();
        return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    async function fetchCalibrations() {
        const tx = db.transaction('calibrations', 'readonly');
        const cals = await new Promise(r => { const q = tx.objectStore('calibrations').getAll(); q.onsuccess = () => r(q.result); });
        calibrationDates = {}; cals.forEach(c => calibrationDates[c.serie] = c);
        updateInstrumentsBank();
    }

    async function exportBackup() {
        const backup = { calibrations: [], templates: [] };
        const tx1 = db.transaction('calibrations', 'readonly');
        backup.calibrations = await new Promise(r => { const q = tx1.objectStore('calibrations').getAll(); q.onsuccess = () => r(q.result); });
        // Convert Blobs to Base64 for backup
        for (let c of backup.calibrations) {
            if (c.certificate instanceof Blob) {
                c._certBase64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(c.certificate); });
                delete c.certificate;
            }
        }
        const tx2 = db.transaction('templates', 'readonly');
        backup.templates = await new Promise(r => { const q = tx2.objectStore('templates').getAll(); q.onsuccess = () => r(q.result); });
        for (let t of backup.templates) {
            if (t.blob instanceof Blob) {
                t._blobBase64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(t.blob); });
                delete t.blob;
            }
        }
        const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'backup_mondis2.json'; a.click();
    }

    async function importBackup(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = async ev => {
            const backup = JSON.parse(ev.target.result);
            const txC = db.transaction('calibrations', 'readwrite');
            for (let c of backup.calibrations) {
                if (c._certBase64) {
                    const res = await fetch(c._certBase64); c.certificate = await res.blob(); delete c._certBase64;
                }
                txC.objectStore('calibrations').put(c);
            }
            const txT = db.transaction('templates', 'readwrite');
            for (let t of backup.templates) {
                if (t._blobBase64) {
                    const res = await fetch(t._blobBase64); t.blob = await res.blob(); delete t._blobBase64;
                }
                txT.objectStore('templates').put(t);
            }
            alert('✅ Backup importado.'); location.reload();
        };
        reader.readAsText(file);
    }

    init();
});
