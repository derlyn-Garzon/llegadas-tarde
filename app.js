/**
 * HabitualFree - Statistical Habitual Free Time Model & Core Logic
 */

// Global State
let rawAppointments = [];
let processedAnalysis = null;

// Day mapping (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const SHORT_DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * Generates sample CSV data with realistic recurring appointment patterns
 */
function generateSampleCSV() {
    const headers = "Asunto,Fecha Inicio,Hora Inicio,Fecha Fin,Hora Fin\n";
    const rows = [];

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 28);

    for (let d = 0; d < 28; d++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + d);

        const dayOfWeek = currentDate.getDay();
        const dateStr = currentDate.toISOString().split('T')[0];

        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        if (dayOfWeek === 1) {
            rows.push(`"Reunión Semanal Planificación",${dateStr},09:00,${dateStr},10:30`);
            rows.push(`"Revisión de Proyectos",${dateStr},14:00,${dateStr},15:00`);
        }

        if (dayOfWeek === 3) {
            rows.push(`"Standup & Sync de Equipo",${dateStr},10:00,${dateStr},12:00`);
            rows.push(`"Sesión de Capacitación",${dateStr},15:00,${dateStr},16:30`);
        }

        if (dayOfWeek === 5) {
            rows.push(`"Demo de Producto",${dateStr},11:00,${dateStr},12:00`);
            rows.push(`"Retrospectiva y Cierre",${dateStr},16:00,${dateStr},17:30`);
        }

        if (dayOfWeek === 4 && d % 2 === 0) {
            rows.push(`"Sesión 1 a 1",${dateStr},11:00,${dateStr},12:00`);
        }
    }

    return headers + rows.join("\n");
}

/**
 * Parses CSV Text into standardized appointment objects
 */
function parseCSV(csvText) {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());

    let startDateIdx = header.findIndex(h => h.includes('start date') || h.includes('fecha inicio') || h.includes('fecha') || h.includes('date'));
    let startTimeIdx = header.findIndex(h => h.includes('start time') || h.includes('hora inicio') || h.includes('hora') || h.includes('time'));
    let endDateIdx = header.findIndex(h => h.includes('end date') || h.includes('fecha fin'));
    let endTimeIdx = header.findIndex(h => h.includes('end time') || h.includes('hora fin'));

    let startDTIdx = header.findIndex(h => h.includes('start') || h.includes('inicio'));

    const appointments = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = parseCSVLine(lines[i]);

        let startObj = null;
        let endObj = null;

        try {
            if (startDateIdx !== -1 && startTimeIdx !== -1) {
                const dateStr = cols[startDateIdx];
                const timeStr = cols[startTimeIdx];
                startObj = parseDateTimeString(dateStr, timeStr);

                if (endDateIdx !== -1 && endTimeIdx !== -1) {
                    endObj = parseDateTimeString(cols[endDateIdx], cols[endTimeIdx]);
                } else if (endTimeIdx !== -1) {
                    endObj = parseDateTimeString(dateStr, cols[endTimeIdx]);
                } else {
                    endObj = new Date(startObj.getTime() + 60 * 60 * 1000);
                }
            } else if (startDTIdx !== -1) {
                startObj = new Date(cols[startDTIdx]);
                if (endTimeIdx !== -1) {
                    endObj = new Date(cols[endTimeIdx]);
                } else {
                    endObj = new Date(startObj.getTime() + 60 * 60 * 1000);
                }
            } else if (cols.length >= 2) {
                startObj = new Date(cols[0]);
                endObj = new Date(cols[1]);
            }

            if (startObj && !isNaN(startObj.getTime()) && endObj && !isNaN(endObj.getTime())) {
                appointments.push({
                    start: startObj,
                    end: endObj,
                    subject: cols[0] || 'Cita'
                });
            }
        } catch (e) {
            console.warn(`Error al parsear línea ${i}:`, lines[i], e);
        }
    }

    return appointments;
}

function parseCSVLine(line) {
    const result = [];
    let insideQuote = false;
    let entry = '';

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
            insideQuote = !insideQuote;
        } else if (char === ',' && !insideQuote) {
            result.push(entry.trim().replace(/^["']|["']$/g, ''));
            entry = '';
        } else {
            entry += char;
        }
    }
    result.push(entry.trim().replace(/^["']|["']$/g, ''));
    return result;
}

function parseDateTimeString(dateStr, timeStr) {
    if (!dateStr) return null;

    let cleanDate = dateStr.trim();
    let year, month, day;

    if (cleanDate.includes('-')) {
        const parts = cleanDate.split('-');
        if (parts[0].length === 4) {
            [year, month, day] = parts.map(Number);
        } else {
            [day, month, year] = parts.map(Number);
        }
    } else if (cleanDate.includes('/')) {
        const parts = cleanDate.split('/');
        if (parts[2] && parts[2].length === 4) {
            [day, month, year] = parts.map(Number);
        } else if (parts[0].length === 4) {
            [year, month, day] = parts.map(Number);
        }
    }

    let hours = 9, minutes = 0;
    if (timeStr) {
        const cleanTime = timeStr.trim().toLowerCase();
        const isPM = cleanTime.includes('pm');
        const isAM = cleanTime.includes('am');
        const timeDigits = cleanTime.replace(/[^\d:]/g, '');
        const timeParts = timeDigits.split(':');

        hours = parseInt(timeParts[0] || 0, 10);
        minutes = parseInt(timeParts[1] || 0, 10);

        if (isPM && hours < 12) hours += 12;
        if (isAM && hours === 12) hours = 0;
    }

    if (year && month && day) {
        return new Date(year, month - 1, day, hours, minutes);
    }

    return new Date(`${dateStr} ${timeStr || ''}`);
}

/**
 * STATISTICAL MODEL ENGINE
 */
function analyzeHabitualFreeTime(appointments, config) {
    const { workStart, workEnd, slotDurationMinutes, habitThreshold, selectedDays } = config;

    if (!appointments || appointments.length === 0) return null;

    let minDate = new Date(Math.min(...appointments.map(a => a.start)));
    let maxDate = new Date(Math.max(...appointments.map(a => a.end)));

    const totalDaysDiff = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));
    const totalWeeksObserved = Math.max(1, Math.ceil(totalDaysDiff / 7));

    const [startH, startM] = workStart.split(':').map(Number);
    const [endH, endM] = workEnd.split(':').map(Number);
    const dayStartMinutes = startH * 60 + startM;
    const dayEndMinutes = endH * 60 + endM;

    const timeSlots = [];
    for (let m = dayStartMinutes; m < dayEndMinutes; m += slotDurationMinutes) {
        const slotEnd = Math.min(m + slotDurationMinutes, dayEndMinutes);
        timeSlots.push({
            startMins: m,
            endMins: slotEnd,
            label: `${formatMinutesToTime(m)} - ${formatMinutesToTime(slotEnd)}`
        });
    }

    const busyMatrix = {};
    const weekCountPerDay = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    let cur = new Date(minDate);
    cur.setHours(0,0,0,0);
    const endBound = new Date(maxDate);
    endBound.setHours(23,59,59,999);

    while (cur <= endBound) {
        const d = cur.getDay();
        weekCountPerDay[d]++;
        cur.setDate(cur.getDate() + 1);
    }

    for (let day = 0; day < 7; day++) {
        busyMatrix[day] = {};
        timeSlots.forEach((slot, idx) => {
            busyMatrix[day][idx] = 0;
        });
    }

    appointments.forEach(app => {
        const appDate = new Date(app.start);
        const dayOfWeek = appDate.getDay();

        const appStartMins = app.start.getHours() * 60 + app.start.getMinutes();
        const appEndMins = app.end.getHours() * 60 + app.end.getMinutes();

        timeSlots.forEach((slot, slotIdx) => {
            if (appStartMins < slot.endMins && appEndMins > slot.startMins) {
                busyMatrix[dayOfWeek][slotIdx] += 1;
            }
        });
    });

    const slotResults = [];
    const heatmapData = [];

    timeSlots.forEach((slot, slotIdx) => {
        const row = { slotLabel: slot.label, slotIdx, days: {} };

        for (let day = 0; day < 7; day++) {
            const totalObserved = Math.max(1, weekCountPerDay[day]);
            const busyCount = Math.min(totalObserved, busyMatrix[day][slotIdx]);
            const freeCount = totalObserved - busyCount;
            const freeProbability = (freeCount / totalObserved) * 100;

            row.days[day] = {
                dayOfWeek: day,
                dayName: DAY_NAMES[day],
                freeProbability: Math.round(freeProbability),
                freeWeeks: freeCount,
                totalWeeks: totalObserved,
                isHabitual: freeProbability >= habitThreshold && selectedDays.includes(day)
            };

            if (selectedDays.includes(day)) {
                slotResults.push({
                    dayOfWeek: day,
                    dayName: DAY_NAMES[day],
                    shortDayName: SHORT_DAY_NAMES[day],
                    slotLabel: slot.label,
                    startMins: slot.startMins,
                    endMins: slot.endMins,
                    freeProbability: Math.round(freeProbability),
                    freeWeeks: freeCount,
                    totalWeeks: totalObserved,
                    isHabitual: freeProbability >= habitThreshold
                });
            }
        }
        heatmapData.push(row);
    });

    const habitualSlots = slotResults
        .filter(s => s.freeProbability >= habitThreshold)
        .sort((a, b) => b.freeProbability - a.freeProbability || a.dayOfWeek - b.dayOfWeek || a.startMins - b.startMins);

    const totalHabitualHours = (habitualSlots.length * slotDurationMinutes) / 60;
    const bestSlot = habitualSlots.length > 0 ? `${habitualSlots[0].shortDayName} ${habitualSlots[0].slotLabel}` : 'Ninguno';

    return {
        totalWeeksObserved,
        totalAppointments: appointments.length,
        timeSlots,
        heatmapData,
        habitualSlots,
        totalHabitualHours: totalHabitualHours.toFixed(1),
        bestSlot
    };
}

function formatMinutesToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// UI Setup & Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('file-info');
    const fileNameSpan = document.getElementById('file-name');
    const fileSizeSpan = document.getElementById('file-size');
    const btnRemoveFile = document.getElementById('btn-remove-file');
    const btnSampleData = document.getElementById('btn-sample-data');
    const habitThresholdInput = document.getElementById('habit-threshold');
    const thresholdValueBadge = document.getElementById('threshold-value');
    const configForm = document.getElementById('config-form');
    const btnExportCSV = document.getElementById('btn-export-csv');
    const btnExportICS = document.getElementById('btn-export-ics');

    // Tab buttons handling
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    // Custom Event listener for analysis ready
    document.addEventListener('analysisReady', (e) => {
        const analysis = e.detail;
        renderHabitualSlotsCards(analysis.habitualSlots);
        renderHeatmapGrid(analysis);
    });

    // Drag and Drop handlers
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    btnRemoveFile.addEventListener('click', () => {
        resetFileState();
    });

    btnSampleData.addEventListener('click', () => {
        const sampleCSV = generateSampleCSV();
        displayFileInfo('citas_ejemplo_habitual.csv', (sampleCSV.length / 1024).toFixed(1) + ' KB');
        processCSVContent(sampleCSV);
    });

    habitThresholdInput.addEventListener('input', (e) => {
        thresholdValueBadge.textContent = `${e.target.value}%`;
        triggerReanalysis();
    });

    configForm.addEventListener('change', () => {
        triggerReanalysis();
    });

    // Export Handlers
    btnExportCSV.addEventListener('click', () => {
        if (!processedAnalysis || !processedAnalysis.habitualSlots.length) {
            alert('No hay tiempos libres habituales para exportar.');
            return;
        }
        exportSlotsToCSV(processedAnalysis.habitualSlots);
    });

    btnExportICS.addEventListener('click', () => {
        if (!processedAnalysis || !processedAnalysis.habitualSlots.length) {
            alert('No hay tiempos libres habituales para exportar.');
            return;
        }
        exportSlotsToICS(processedAnalysis.habitualSlots);
    });

    function handleFileSelect(file) {
        if (!file.name.endsWith('.csv')) {
            alert('Por favor selecciona un archivo con extensión .csv');
            return;
        }

        displayFileInfo(file.name, (file.size / 1024).toFixed(1) + ' KB');

        const reader = new FileReader();
        reader.onload = (e) => {
            processCSVContent(e.target.result);
        };
        reader.readAsText(file);
    }

    function displayFileInfo(name, sizeStr) {
        fileNameSpan.textContent = name;
        fileSizeSpan.textContent = sizeStr;
        dropZone.classList.add('hidden');
        fileInfo.classList.remove('hidden');
    }

    function resetFileState() {
        rawAppointments = [];
        processedAnalysis = null;
        fileInput.value = '';
        dropZone.classList.remove('hidden');
        fileInfo.classList.add('hidden');
        document.getElementById('empty-state').classList.remove('hidden');
        document.getElementById('summary-section').classList.add('hidden');
        document.getElementById('results-section').classList.add('hidden');
    }
});

function getConfigFromUI() {
    const workStart = document.getElementById('work-start').value || '08:00';
    const workEnd = document.getElementById('work-end').value || '18:00';
    const slotDurationMinutes = parseInt(document.getElementById('slot-duration').value, 10) || 60;
    const habitThreshold = parseInt(document.getElementById('habit-threshold').value, 10) || 70;

    const selectedDays = Array.from(document.querySelectorAll('input[name="days"]:checked'))
        .map(cb => parseInt(cb.value, 10));

    return { workStart, workEnd, slotDurationMinutes, habitThreshold, selectedDays };
}

function processCSVContent(csvText) {
    rawAppointments = parseCSV(csvText);
    triggerReanalysis();
}

function triggerReanalysis() {
    if (!rawAppointments || rawAppointments.length === 0) return;

    const config = getConfigFromUI();
    processedAnalysis = analyzeHabitualFreeTime(rawAppointments, config);

    if (processedAnalysis) {
        renderDashboard(processedAnalysis);
    }
}

function renderDashboard(analysis) {
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('summary-section').classList.remove('hidden');
    document.getElementById('results-section').classList.remove('hidden');

    document.getElementById('stat-weeks-count').textContent = analysis.totalWeeksObserved;
    document.getElementById('stat-appointments-count').textContent = analysis.totalAppointments;
    document.getElementById('stat-habitual-hours').textContent = `${analysis.totalHabitualHours}h`;
    document.getElementById('stat-best-slot').textContent = analysis.bestSlot;

    document.dispatchEvent(new CustomEvent('analysisReady', { detail: analysis }));
}

/**
 * Render Top Habitual Free Time Cards
 */
function renderHabitualSlotsCards(habitualSlots) {
    const container = document.getElementById('habitual-slots-list');
    container.innerHTML = '';

    if (!habitualSlots || habitualSlots.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 2rem; color: var(--text-secondary);">
                <i data-lucide="info" style="margin-bottom: 0.5rem; width: 32px; height: 32px;"></i>
                <p>No se encontraron tiempos libres que superen el umbral configurado.</p>
                <p style="font-size: 0.85rem; margin-top: 0.25rem;">Intenta reducir el umbral de hábito libre (%) en la configuración.</p>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
    }

    habitualSlots.forEach(slot => {
        const card = document.createElement('div');
        card.className = 'slot-card';
        card.innerHTML = `
            <div class="slot-header">
                <span class="slot-day">${slot.dayName}</span>
                <span class="slot-score-badge">${slot.freeProbability}% Libre</span>
            </div>
            <div class="slot-time">
                <i data-lucide="clock" style="width: 18px; height: 18px;"></i>
                <span>${slot.slotLabel}</span>
            </div>
            <div class="slot-details">
                <span>Libre en ${slot.freeWeeks} de ${slot.totalWeeks} semanas analizadas</span>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${slot.freeProbability}%"></div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    if (window.lucide) lucide.createIcons();
}

/**
 * Render Interactive Weekly Heatmap Matrix Grid
 */
function renderHeatmapGrid(analysis) {
    const container = document.getElementById('heatmap-container');
    container.innerHTML = '';

    const { heatmapData, timeSlots } = analysis;
    const daysOrder = [1, 2, 3, 4, 5, 6, 0]; // Mon -> Sun

    const grid = document.createElement('div');
    grid.className = 'heatmap-grid';

    grid.appendChild(createCell('heatmap-header-cell', 'Hora'));
    daysOrder.forEach(dayIdx => {
        grid.appendChild(createCell('heatmap-header-cell', SHORT_DAY_NAMES[dayIdx]));
    });

    heatmapData.forEach(row => {
        grid.appendChild(createCell('heatmap-time-cell', row.slotLabel));

        daysOrder.forEach(dayIdx => {
            const dayData = row.days[dayIdx];
            const prob = dayData.freeProbability;

            let levelClass = 'level-0';
            if (prob >= 80) levelClass = 'level-3';
            else if (prob >= 60) levelClass = 'level-2';
            else if (prob >= 30) levelClass = 'level-1';

            const cell = document.createElement('div');
            cell.className = `heatmap-cell ${levelClass}`;
            cell.title = `${dayData.dayName} ${row.slotLabel}: ${prob}% libre (${dayData.freeWeeks}/${dayData.totalWeeks} semanas)`;
            cell.innerHTML = `<span>${prob}%</span>`;

            grid.appendChild(cell);
        });
    });

    container.appendChild(grid);
}

function createCell(className, text) {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    return div;
}

/**
 * Exports identified habitual slots to CSV download
 */
function exportSlotsToCSV(slots) {
    let csv = "Dia,Horario,Probabilidad_Libre_Pct,Semanas_Libres,Semanas_Totales\n";
    slots.forEach(s => {
        csv += `"${s.dayName}","${s.slotLabel}",${s.freeProbability},${s.freeWeeks},${s.totalWeeks}\n`;
    });

    downloadBlob(csv, 'tiempos_libres_habituales.csv', 'text/csv');
}

/**
 * Exports identified habitual slots as recurring iCalendar (.ics) file
 */
function exportSlotsToICS(slots) {
    let ics = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//HabitualFree//Detector Tiempos Libres//ES",
        "CALSCALE:GREGORIAN"
    ];

    const icsDays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

    slots.forEach((s, idx) => {
        const startH = String(Math.floor(s.startMins / 60)).padStart(2, '0');
        const startM = String(s.startMins % 60).padStart(2, '0');
        const endH = String(Math.floor(s.endMins / 60)).padStart(2, '0');
        const endM = String(s.endMins % 60).padStart(2, '0');

        ics.push(
            "BEGIN:VEVENT",
            `UID:habitual-free-${idx}-${Date.now()}@habitualfree.app`,
            `SUMMARY:Tiempo Libre Habitual (${s.freeProbability}% Frecuencia)`,
            `DESCRIPTION:Bloque de tiempo libre recurrente habitual detectado por HabitualFree.`,
            `RRULE:FREQ=WEEKLY;BYDAY=${icsDays[s.dayOfWeek]}`,
            `DTSTART:20250101T${startH}${startM}00`,
            `DTEND:20250101T${endH}${endM}00`,
            "END:VEVENT"
        );
    });

    ics.push("END:VCALENDAR");

    downloadBlob(ics.join("\r\n"), 'tiempos_libres_habituales.ics', 'text/calendar');
}

function downloadBlob(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
