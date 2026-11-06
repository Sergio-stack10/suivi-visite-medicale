/* ============================================================
   Suivi des Visites Médicales — Application (SPA)
   Portage fidèle de suivi_visite.py (Streamlit) vers JavaScript
   ============================================================ */
'use strict';

/* ==================== Helpers DOM ==================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg, type = 'ok', ms = 5000) {
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'error' ? ' error' : type === 'warn' ? ' warn' : '');
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), ms);
}
function showLoading(txt = 'Chargement…') { $('#loading-txt').textContent = txt; $('#loading').classList.remove('hidden'); }
function hideLoading() { $('#loading').classList.add('hidden'); }

/* ==================== État global ==================== */
const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const S = {
  user: null,
  weeks: [],
  currentWeek: null,
  plannings: {},        // { 'S34': [rows] }
  medical: null,        // [rows] ou null
  rta: null,            // [rows] ou null
  files: { planning: [], liste: null, rta: null },
  t2Filters: { projet: [], prio: [] },
  t7Filter: null,       // projets sélectionnés dashboard (null = tous)
  rapportDate: null,
};
const isAdmin = () => S.user && S.user.role === 'admin';

/* ==================== API ==================== */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin'
  });
  if (res.status === 401) { showLogin(); throw new Error('Session expirée, reconnectez-vous.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Erreur ' + res.status));
  return data;
}

/* ==================== Utilitaires dates / heures ==================== */
function str(v) { return v === null || v === undefined ? '' : String(v); }
function pad2(n) { return String(n).padStart(2, '0'); }

function dateToISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function isoToDate(s) { return new Date(s + 'T00:00:00'); }
function fmtDateFR(iso) {
  if (!iso) return '';
  const m = str(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : str(iso);
}
function parseFRDate(s) { // 'JJ/MM/AAAA' -> 'AAAA-MM-JJ' ou null
  const m = str(s).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  return 1 + Math.round((t - firstThu) / (7 * 86400000));
}
function mondayOfISOWeek(year, week) {
  const j4 = new Date(Date.UTC(year, 0, 4));
  const day = (j4.getUTCDay() + 6) % 7;
  const monday = new Date(j4);
  monday.setUTCDate(j4.getUTCDate() - day + 1);
  monday.setUTCDate(monday.getUTCDate() + (week - 1) * 7);
  return new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate());
}
function getDatesFromWeek(weekName) { // {Lundi: Date, ...}
  const m = str(weekName).match(/\d+/);
  const year = new Date().getFullYear();
  if (m) {
    const num = parseInt(m[0], 10);
    if (num >= 1 && num <= 53) {
      const monday = mondayOfISOWeek(year, num);
      const out = {};
      JOURS.forEach((j, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); out[j] = d; });
      return out;
    }
  }
  const out = {};
  JOURS.forEach((j) => { out[j] = new Date(); });
  return out;
}

/* -- conversions des valeurs Excel (port de get_time_obj / is_planned) -- */
const EMPTY_TIMES = ['', '*', 'nan', 'none', 'nat', '0', '0:00', '00:00', '0:00:00', '00:00:00'];

function valToTimeMin(v) { // -> minutes depuis minuit ou null
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (v.getFullYear() < 1901) return v.getHours() * 60 + v.getMinutes() + (v.getSeconds() ? v.getSeconds() / 60 : 0);
    return v.getHours() * 60 + v.getMinutes();
  }
  if (typeof v === 'number') {
    if (v > 0 && v < 1) return Math.round(v * 86400) / 60;
    return null;
  }
  const s = str(v).trim();
  if (s === '' || EMPTY_TIMES.includes(s.toLowerCase())) return null;
  const tm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (tm) return (+tm[1]) * 60 + (+tm[2]) + (tm[3] ? +tm[3] / 60 : 0);
  const num = parseFloat(s);
  if (!isNaN(num) && num > 0 && num < 1) return Math.round(num * 86400) / 60;
  const d = new Date(s);
  if (!isNaN(d)) return d.getHours() * 60 + d.getMinutes();
  return null;
}
function isPlanned(v) { // port de is_planned()
  if (v === null || v === undefined || typeof v === 'boolean') return false;
  if (typeof v === 'number') return v > 0;
  const s = str(v).trim();
  if (s === '' || ['*', 'nan', 'none', '0', '0:00', '00:00', '0:00:00', '00:00:00'].includes(s.toLowerCase())) return false;
  const t = valToTimeMin(v);
  if (t !== null) return t !== 0;
  if (/[a-df-z]/i.test(s)) return false; // lettre autre que le motif horaire
  const f = parseFloat(s);
  return !isNaN(f) && f > 0;
}
function minToHM(mins) { const h = Math.floor(mins / 60), m = Math.round(mins % 60); return pad2(h) + ':' + pad2(m); }
function fmtTimeDisplay(v) { const t = valToTimeMin(v); return t === null ? '' : minToHM(t); }
function fmtDuration(mins) {
  if (mins === null || mins === undefined || isNaN(mins) || mins === 0) return '0min';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}
function calculateAnciennete(hireIso) {
  if (!hireIso) return '';
  const hd = isoToDate(hireIso);
  const today = new Date();
  let months = (today.getFullYear() - hd.getFullYear()) * 12 + (today.getMonth() - hd.getMonth());
  if (months < 0) return '0 mois';
  const years = Math.floor(months / 12), rem = months % 12;
  return years > 0 ? `${years} an(s) ${rem} mois` : `${rem} mois`;
}
function calculateAncienneteNum(hireIso) {
  if (!hireIso) return 0;
  const hd = isoToDate(hireIso);
  const today = new Date();
  return Math.max(0, (today.getFullYear() - hd.getFullYear()) * 12 + (today.getMonth() - hd.getMonth()));
}
function getFinalStatus(row) {
  const statut = str(row['Statut Visite']).toLowerCase().trim();
  const com = str(row['Commentaire']).toLowerCase();
  if (com.includes('ok')) return 'Visite effectuée';
  if (com.includes('absent') || com.includes('report')) return 'Absent/Reporté';
  if (statut === 'planifié' || statut === 'planifie') return 'Planifié';
  return 'Non Planifié';
}

/* ==================== Mappage des projets (identique au Python) ==================== */
const PROJET_NUM_MAP = {
  '18431': 'ORG ATH', '16187': 'BTL AT', '18354': 'AC', '16294': 'TE FOC', '21548': 'BKM POLY',
  '17042': 'CPR', '17439': 'FB', '25641': 'SHI', '16152': 'ORG HD', '22280': 'AY', '16315': 'MF',
  '18142': 'BB', '16872': 'CST', '16334': 'C+ INT', '12777': 'PF', '16873': 'BF', '17139': 'LP',
  '17056': 'ZAL TMM', '21565': 'SBX', '17057': 'VP SC', '16808': 'RRG', '16669': 'IZI',
  '17178': 'BKM', '17060': 'AUC', '11836': 'DRM', '11834': '3DS', '16966': 'LC', '16643': 'ZAL TNR',
  '24323': 'LYX', '16950': 'DB TMM', '17534': 'TRP', '17914': 'ZP', '16999': 'TII', '16412': 'HP',
  '16952': 'BTL DIG', '17429': 'GRA', '18175': 'RCI MG', '17230': 'JTR', '21550': 'CPR BE',
  '18338': 'MZ', '17130': 'MO', '24158': 'YK', '12480': 'C+ FR', '11753': 'VAL', '13966': 'H&H',
  '17401': '24S', '16571': 'TRK', '25659': 'ZAL DE', '11733': 'BF POLY', '23126': 'STC',
  '24474': 'CNX', '23404': 'C2B', '17567': 'POL', '26711': 'ADV', '24241': 'OPEX', '17043': 'DB TNR',
  '16827': 'LBC', '18013': 'BA', '16897': 'LC ANT', '16953': 'STY', '16437': 'ORG PRT',
  '18418': 'RIV TMM', '16352': 'RIV UK TMM', '17131': 'FLT', '18345': 'RIV ANT', '16351': 'RIV UK ANT',
  '26044': 'CNX', '980005758': 'LEAD', '980010299': 'ZPL', '2517': 'RECRU'
};
const PROJET_STR_MAP = {
  'depot bingo polyglot': 'DEPOT BINGO POLYGLOT', 'gallinée': 'GALLINÉE', 'direct energie boc': 'DIRECT ENERGIE BOC',
  'hostnfly': 'HOSTNFLY', 'tk home solutions': 'TK HOME SOLUTIONS', '4165 piana': 'PIANA',
  'hellowork': 'HELLOWORK', 'lydia': 'LYDIA', 'club funding': 'CLUB FUNDING', 'wengo': 'WENGO',
  'califrais': 'CALIFRAIS', 'joko': 'JOKO CUSTOMER CARE', 'worlremit': 'WORLREMIT',
  '4132 sendwave': 'SENDWAVE', 'tiiko': 'TIIKO', 'colisee': 'COLISEE', 'eni sc': 'ENI SC', 'omeo': 'OMEO',
  'worldr sendwave': 'WORLDR SENDWAVE', 'gpasplus': 'GPASPLUS', 'footovision': 'FOOTOVISION',
  'sika webhelp': 'SIKA WEBHELP OD', 'tuffy wall': 'TUFFY WALL', 'domiserve': 'DOMISERVE',
  '22409 - pnp': 'PNP TMM', '22432 - other': 'OTHER', '22409 - other': 'OTHER',
  '21317 - legalplace': 'LEGALPLACE', '16679 - gexel': 'GEXEL', '2921 - originenergy': 'ORIGINENERGY',
  '23330 - opexother': 'OPEXOTHER', '23776 - other': 'OTHER', '14309 - bytedance': 'BYTEDANCE',
  '4125 - ceaa': 'CEAA', '24818 - power fleet': 'POWERFLEET', '12229 - other': 'OTHER',
  '12230 - other': 'OTHER', 'whfr157 - p_dms': 'BYTEL DIGITAL', 'whfr2857 - p_4073': 'RIVER DE',
  'whus012 - p_gexel': 'GEXEL', 'whfr2962 - piana': 'PIANA', 'whcrit225 - a540 p_al': 'VEEPEE SC',
  'whfr894 - p_tls sgs': 'SGS', 'whnl287 - basic-fit': 'BASIC FIT NL', 'whfr2963 - colis privac': 'COLIS PRIVÉ'
};
function getMappedProject(projet) {
  const p = str(projet);
  for (const [k, v] of Object.entries(PROJET_NUM_MAP)) {
    if (p.startsWith(k)) return v;
  }
  const pl = p.toLowerCase();
  for (const [k, v] of Object.entries(PROJET_STR_MAP)) {
    if (pl.includes(k)) return v;
  }
  return p;
}

/* ==================== Lecture Excel (SheetJS) ==================== */
async function readWorkbook(file) {
  const buf = await file.arrayBuffer();
  return XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
}
function sheetMatrix(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
}
function cleanId(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && isFinite(v)) return String(Math.round(v));
  let s = str(v).replace(/ /g, '').replace(/\.0(?!\d)/g, '').toUpperCase();
  return s;
}
function excelDateToISO(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (v.getFullYear() < 1901) return null; // heure seule
    return dateToISO(v);
  }
  if (typeof v === 'number' && v > 1) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return dateToISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = str(v).trim();
  if (!s || s === '*') return null;
  const fr = parseFRDate(s);
  if (fr) return fr;
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const d = new Date(s);
  if (!isNaN(d) && d.getFullYear() > 1901) return dateToISO(d);
  return null;
}
function timeValToHMS(v) { // -> 'HH:MM:SS' ou null
  const t = valToTimeMin(v);
  if (t === null) return null;
  const h = Math.floor(t / 60), m = Math.floor(t % 60), s = Math.round((t - Math.floor(t)) * 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
function dtValToHMS(v) { // datetime complet -> 'HH:MM:SS'
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return timeValToHMS(v);
  const s = str(v).trim();
  if (!s) return null;
  const tm = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (tm) return `${pad2(+tm[1])}:${pad2(+tm[2])}:${pad2(+(tm[3] || 0))}`;
  return null;
}
function getWeekNumberFromWorkbook(wb) {
  try {
    for (const name of wb.SheetNames) {
      const rows = sheetMatrix(wb.Sheets[name]);
      for (let i = 0; i < Math.min(5, rows.length); i++) {
        const row = rows[i] || [];
        for (let j = 0; j < Math.min(15, row.length); j++) {
          const v = row[j];
          if (v === null || v === undefined || v === '') continue;
          let d = null;
          if (v instanceof Date) d = v;
          else if (typeof v === 'number' && v > 1 && v < 60000) d = new Date(Math.round((v - 25569) * 86400000));
          else if (typeof v === 'string') {
            const fr = parseFRDate(v); const iso = v.match(/(\d{4})-(\d{2})-(\d{2})/);
            if (fr) d = isoToDate(fr); else if (iso) d = isoToDate(iso[0]); else { const dd = new Date(v); if (!isNaN(dd)) d = dd; }
          }
          if (d && d.getFullYear() > 1980) return 'S' + pad2(isoWeek(d));
        }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/* ==================== Parseurs (ports de parse_*.py) ==================== */
async function parsePlanningFiles(files) {
  const all = [];
  for (const file of files) {
    const wb = await readWorkbook(file);
    let rows = null;
    const name1 = wb.SheetNames.find((n) => n.trim() === 'Tout (WFO+WFH)');
    const name2 = wb.SheetNames.find((n) => n.includes('TMM'));
    const buildRow = (r, cols) => {
      const g = (i) => (cols && cols[i] !== undefined ? r[cols[i]] : null);
      const row = {
        'TRANSPORT': str(g(0)).trim(),
        'WORKDAY ID': cleanId(g(1)),
        'Paid ID': str(g(2)).replace(/ /g, '').toUpperCase(),
        'Nom': str(g(3)).trim(),
        'Projet': str(g(4)).trim(),
        'Statut': str(g(5)).trim(),
      };
      for (let d = 0; d < 7; d++) {
        row[JOURS[d] + '_DE'] = timeValToHMS(g(6 + d * 3)) || null;
        row[JOURS[d] + '_A'] = timeValToHMS(g(7 + d * 3)) || null;
        row[JOURS[d] + '_Pause'] = timeValToHMS(g(8 + d * 3)) || null;
      }
      for (let d = 0; d < 7; d++) row[JOURS[d] + '_Flag'] = isPlanned(row[JOURS[d] + '_DE']) ? 1 : 0;
      return row;
    };
    if (name1) {
      const matrix = sheetMatrix(wb.Sheets[name1]);
      const cols = [3, 4, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17, 19, 20, 21, 23, 24, 25, 27, 28, 29, 31, 32, 33, 35, 36, 37];
      rows = matrix.slice(3).map((r) => buildRow(r, cols)).filter(Boolean);
    } else if (name2) {
      const matrix = sheetMatrix(wb.Sheets[name2]);
      let headerRow = -1, transCol = 0;
      for (let i = 0; i < Math.min(10, matrix.length); i++) {
        const row = (matrix[i] || []).map((c) => str(c).trim());
        const idx = row.indexOf('Transport');
        if (idx !== -1) { headerRow = i; transCol = idx; break; }
      }
      if (headerRow !== -1) {
        const o = transCol;
        const cols = [o, o + 4, o + 2, o + 5, o + 8, o + 10];
        for (let d = 0; d < 7; d++) cols.push(o + 11 + d * 6, o + 12 + d * 6, o + 13 + d * 6);
        rows = matrix.slice(headerRow + 1).map((r) => buildRow(r, cols)).filter(Boolean);
      }
    } else { continue; }
    rows = rows.filter((r) => /[A-Z0-9]/.test(r['WORKDAY ID']) && !['NAN', 'NONE', '*', ''].includes(r['WORKDAY ID']));
    all.push(...rows);
  }
  // déduplication sur WORKDAY ID (dernier conservé comme pandas ? pandas garde le premier)
  const seen = new Set(); const out = [];
  for (const r of all) { if (!seen.has(r['WORKDAY ID'])) { seen.add(r['WORKDAY ID']); out.push(r); } }
  return out;
}

function parseListeVisite(wb) {
  try {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const matrix = sheetMatrix(ws);
    if (!matrix.length) return null;
    const headers = (matrix[0] || []).map((c) => str(c).trim().toUpperCase());
    let idCol = -1, nomCol = -1, prenomCol = -1, projetCol = -1, visiteCol = -1, hireCol = -1, paidCol = -1, statutCol = -1;
    headers.forEach((c, i) => {
      if (/WORKDAY|EMPLOYEE|MATRICULE/.test(c)) idCol = i;
      if (/LAST/.test(c) && /NAME/.test(c)) nomCol = i; else if (/NOM/.test(c) && nomCol === -1) nomCol = i;
      if (/FIRST/.test(c) && /NAME/.test(c)) prenomCol = i;
      if (/PROJET|PROJECT/.test(c)) projetCol = i;
      if (/VISITE|TYPE/.test(c)) visiteCol = i;
      if (/HIRE/.test(c) && /DATE/.test(c)) hireCol = i;
      if (/PREVIOUS PAYROLL|PAID ID|PAYROLL ID/.test(c)) paidCol = i;
      if (/STATUT|POSTE|JOB|TITLE|POSITION|ROLE/.test(c)) statutCol = i;
    });
    if (idCol === -1) return null;
    const out = [];
    for (let r = 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const g = (i) => (i >= 0 ? row[i] : null);
      const wid = cleanId(g(idCol));
      if (!/[A-Z0-9]/.test(wid) || ['NAN', 'NONE', '*', ''].includes(wid)) continue;
      const hire = excelDateToISO(g(hireCol));
      const rawStatut = str(g(statutCol)).toUpperCase();
      out.push({
        'WORKDAY ID': wid,
        'Payroll ID': paidCol >= 0 ? str(g(paidCol)).trim() : '',
        'Nom': nomCol >= 0 ? str(g(nomCol)).trim() : '',
        'Prénom': prenomCol >= 0 ? str(g(prenomCol)).trim() : '',
        'Statut': statutCol >= 0 ? (/ADVISOR|CUSTOMER SERVICE|CC/.test(rawStatut) ? 'CC' : 'ENC') : 'ENC',
        "Date d'embauche": hire,
        'Ancienneté': calculateAnciennete(hire),
        'Ancienneté_num': calculateAncienneteNum(hire),
        'Projet': projetCol >= 0 ? str(g(projetCol)).trim() : 'N/A',
        'Priorité Visite': visiteCol >= 0 ? str(g(visiteCol)).trim() : 'N/A',
        'Statut Visite': 'Non Planifié',
        'Date Visite': null,
        'Créneau Visite': null,
        'Shift Début': '',
        'Shift Fin': '',
        'Heure Départ': null,
        'Heure Retour': null,
        'Commentaire': '',
      });
    }
    const seen = new Set(); const uniq = [];
    for (const row of out) { if (!seen.has(row['WORKDAY ID'])) { seen.add(row['WORKDAY ID']); uniq.push(row); } }
    return uniq;
  } catch (e) {
    toast('Erreur lors de la lecture du fichier Visite : ' + e.message, 'error');
    return null;
  }
}

function parseRtaFile(wb) {
  try {
    const name = wb.SheetNames.find((n) => n === 'Suivi') || wb.SheetNames[0];
    if (!name) return null;
    const matrix = sheetMatrix(wb.Sheets[name]);
    if (!matrix.length) return null;
    const headers = (matrix[0] || []).map((c) => str(c).trim().toUpperCase().replace(/[ÉÈÊ]/g, 'E').replace(/À/g, 'A'));
    const rename = {
      'WORKDAY ID': 'WORKDAY ID', 'NOM': 'Nom', 'PRENOM': 'Prénom', 'STATUT VISITE': 'Statut Visite',
      'DATE VISITE': 'Date Visite', 'HEURE DEPART': 'Heure Départ', 'HEURE RETOUR': 'Heure Retour',
      'COMMENTAIRES': 'Commentaire', 'DUREE': 'Durée', 'PROJET': 'Projet'
    };
    const colMap = {}; // index -> nom final
    headers.forEach((h, i) => { if (rename[h]) colMap[i] = rename[h]; });
    const rows = [];
    for (let r = 1; r < matrix.length; r++) {
      const src = matrix[r] || [];
      if (src.every((c) => c === null || c === undefined || str(c).trim() === '')) continue;
      const row = {};
      headers.forEach((h, i) => { row[h] = src[i]; });
      const out = {};
      for (const [i, finalName] of Object.entries(colMap)) {
        let v = row[Object.keys(row)[+i]]; // index
        v = src[+i];
        const junk = (x) => (x === null || x === undefined || ['*', '-', 'nan', 'none', ''].includes(str(x).trim().toLowerCase()));
        if (finalName === 'Date Visite') out[finalName] = junk(v) ? null : excelDateToISO(v);
        else if (finalName === 'Heure Départ' || finalName === 'Heure Retour') out[finalName] = junk(v) ? null : dtValToHMS(v);
        else if (finalName === 'WORKDAY ID') out[finalName] = junk(v) ? '' : cleanId(v);
        else out[finalName] = junk(v) ? '' : str(v).trim();
      }
      if (!out['WORKDAY ID'] && !out['Nom']) continue;
      rows.push(out);
    }
    return rows;
  } catch (e) {
    toast('Erreur lors de la lecture du fichier RTA : ' + e.message, 'error');
    return null;
  }
}

/* ==================== Logique métier ==================== */
function syncStatutWithPlannings(medical, plannings) {
  if (!medical || !medical.length) return medical;
  const byWid = new Map(), byPid = new Map();
  for (const rows of Object.values(plannings)) {
    for (const p of rows) {
      if (!byWid.has(p['WORKDAY ID'])) byWid.set(p['WORKDAY ID'], p['Statut']);
      if (p['Paid ID'] && !byPid.has(p['Paid ID'])) byPid.set(p['Paid ID'], p['Statut']);
    }
  }
  for (const m of medical) {
    let s = byWid.get(m['WORKDAY ID']);
    if (s === undefined && m['Payroll ID']) s = byPid.get(m['Payroll ID']);
    if (s === undefined) s = 'ENC';
    const su = str(s).toUpperCase();
    m['Statut'] = /ADVISOR|CUSTOMER SERVICE|CC/.test(su) ? 'CC' : 'ENC';
  }
  return medical;
}

function enrichShifts(rows) { // ajoute Shift Début / Shift Fin depuis les plannings
  for (const r of rows) {
    r['Shift Début'] = ''; r['Shift Fin'] = '';
    const dv = r['Date Visite'];
    if (!dv) continue;
    const d = isoToDate(dv);
    const weekNum = isoWeek(d);
    const dayName = JOURS[(d.getDay() + 6) % 7];
    for (const [wName, pRows] of Object.entries(S.plannings)) {
      if (str(wName).includes(pad2(weekNum))) {
        const p = pRows.find((x) => x['WORKDAY ID'] === r['WORKDAY ID']);
        if (p) {
          r['Shift Début'] = fmtTimeDisplay(p[dayName + '_DE']);
          r['Shift Fin'] = fmtTimeDisplay(p[dayName + '_A']);
        }
        break;
      }
    }
  }
  return rows;
}

function generatePlanning(configs) {
  const medical = S.medical, planning = S.plannings[S.currentWeek];
  if (!medical || !planning) return 0;
  let total = 0;
  for (const cfg of configs) {
    if (!cfg.actif) continue;
    const dateObj = isoToDate(cfg.date);
    const dayIdx = (dateObj.getDay() + 6) % 7;
    const selDay = JOURS[dayIdx];
    const deCol = selDay + '_DE', aCol = selDay + '_A';

    const pByWid = new Map(), pByPid = new Map();
    for (const p of planning) {
      if (p['WORKDAY ID'] && !pByWid.has(p['WORKDAY ID'])) pByWid.set(p['WORKDAY ID'], p);
      if (p['Paid ID'] && !pByPid.has(p['Paid ID'])) pByPid.set(p['Paid ID'], p);
    }
    let working = [];
    for (const m of medical) {
      const p = pByWid.get(m['WORKDAY ID']) || (m['Payroll ID'] ? pByPid.get(m['Payroll ID']) : null);
      if (!p) continue;
      working.push({ ref: m, de: p[deCol], a: p[aCol] });
    }
    working = working.filter((w) => isPlanned(w.de));
    const cDebut = valToTimeMin(cfg.debut), cFin = valToTimeMin(cfg.fin);
    working = working.filter((w) => {
      const sd = valToTimeMin(w.de), sf = valToTimeMin(w.a);
      if (sd === null || sf === null) return false;
      return sd < cFin && sf > cDebut;
    });
    if (cfg.statutFilter && cfg.statutFilter !== 'Tous') {
      working = working.filter((w) => str(w.ref['Statut']).toUpperCase() === cfg.statutFilter.toUpperCase());
    }
    working = working.filter((w) => !['planifié', 'planifie', 'visite faite'].includes(str(w.ref['Statut Visite']).toLowerCase()));
    for (const w of working) {
      const sv = str(w.ref['Statut Visite']).toLowerCase(), com = str(w.ref['Commentaire']).toLowerCase();
      w.replan = sv.includes('absent') || sv.includes('report') || com.includes('absent') || com.includes('report');
      w.prio = cfg.prio !== 'Aucune priorité' && str(w.ref['Priorité Visite']).trim().toLowerCase() === cfg.prio.toLowerCase();
    }
    working.sort((a, b) => (b.replan - a.replan) || (b.prio - a.prio) || (b.ref['Ancienneté_num'] - a.ref['Ancienneté_num']));
    const isRiver = (w) => /river|amazon/i.test(str(w.ref['Projet']));
    const dfRiver = working.filter(isRiver), dfOthers = working.filter((w) => !isRiver(w));

    const slots = [];
    for (let t = cDebut; t <= cFin - 30; t += 30) slots.push(t);
    const slotCounts = {};
    slots.forEach((s) => { slotCounts[s] = 0; });

    const assign = (group, qty) => {
      let picked = 0;
      for (const w of group) {
        if (picked >= qty) break;
        const sd = valToTimeMin(w.de);
        let sf = valToTimeMin(w.a);
        if (sd === null || sf === null) continue;
        const sfEval = sf < sd ? 23 * 60 + 59 : sf;
        let assigned = null;
        for (const slot of slots) {
          if (sd <= slot && sfEval >= slot + 30 && slotCounts[slot] < 4) { assigned = slot; break; }
        }
        if (assigned === null) continue;
        const m = w.ref;
        m['Statut Visite'] = 'Planifié';
        m['Date Visite'] = cfg.date;
        m['Créneau Visite'] = cfg.date + 'T' + minToHM(assigned) + ':00';
        const medComment = str(m['Commentaire']).toLowerCase();
        if (medComment.includes('absent') || medComment.includes('report')) {
          m['Commentaire'] = ''; m['Heure Départ'] = null; m['Heure Retour'] = null;
        }
        slotCounts[assigned]++; picked++;
      }
      return picked;
    };
    total += assign(dfRiver, cfg.qtyRiver);
    total += assign(dfOthers, cfg.qtyOthers);
  }
  return total;
}

/* ==================== Chargement des données ==================== */
async function refreshStateSummary() {
  const st = await api('/api/state');
  S.weeks = st.weeks;
  if (!S.weeks.includes(S.currentWeek)) S.currentWeek = S.weeks.length ? S.weeks[0] : null;
}
async function loadMedical() {
  const data = await api('/api/state/medical');
  S.medical = data === 'null' ? null : data;
  if (S.medical) {
    for (const m of S.medical) {
      if (m['Créneau Visite'] === undefined) m['Créneau Visite'] = null;
      if (m['Ancienneté_num'] === undefined) m['Ancienneté_num'] = calculateAncienneteNum(m["Date d'embauche"]);
      if (!m['Ancienneté']) m['Ancienneté'] = calculateAnciennete(m["Date d'embauche"]);
    }
    S.medical = syncStatutWithPlannings(S.medical, S.plannings);
  }
}
async function loadRta() {
  const data = await api('/api/state/rta');
  S.rta = data === 'null' ? null : data;
}
async function ensurePlanning(week) {
  if (!week || S.plannings[week]) return;
  const data = await api('/api/state/planning/' + encodeURIComponent(week));
  S.plannings[week] = data === 'null' ? [] : data;
}

/* ==================== Sauvegarde ==================== */
async function saveMedical() {
  await api('/api/state/medical', { method: 'PUT', body: S.medical });
}
async function savePlanning(week) {
  await api('/api/state/planning/' + encodeURIComponent(week), { method: 'PUT', body: S.plannings[week] });
}
async function saveRta() {
  await api('/api/state/rta', { method: 'PUT', body: S.rta });
}

/* ==================== Exports Excel ==================== */
function exportExcel(rows, cols, filename) {
  if (!rows || !rows.length) { toast('Aucune donnée à exporter.', 'warn'); return; }
  const data = rows.map((r) => {
    const o = {};
    cols.forEach((c) => { o[c] = r[c] === null || r[c] === undefined ? '' : r[c]; });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: cols });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, filename);
}

/* ==================== Composant multi-sélection ==================== */
function multiselect(container, placeholder, options, selected, onChange) {
  container.classList.add('msel');
  container.innerHTML = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const updateBtn = () => {
    btn.textContent = selected.length === 0 ? placeholder
      : selected.length === 1 ? selected[0]
      : `${selected.length} sélectionnés`;
  };
  const renderPanel = () => {
    panel.innerHTML = '';
    options.forEach((opt) => {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = selected.includes(opt);
      cb.addEventListener('change', () => {
        if (cb.checked) { if (!selected.includes(opt)) selected.push(opt); }
        else { const i = selected.indexOf(opt); if (i > -1) selected.splice(i, 1); }
        updateBtn(); onChange(selected);
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(opt));
      panel.appendChild(lab);
    });
    const actions = document.createElement('div');
    actions.className = 'actions';
    const bAll = document.createElement('button'); bAll.type = 'button'; bAll.className = 'btn btn-ghost btn-sm'; bAll.textContent = 'Tout';
    bAll.addEventListener('click', () => { selected.length = 0; options.forEach((o) => selected.push(o)); updateBtn(); renderPanel(); onChange(selected); });
    const bNone = document.createElement('button'); bNone.type = 'button'; bNone.className = 'btn btn-ghost btn-sm'; bNone.textContent = 'Aucun';
    bNone.addEventListener('click', () => { selected.length = 0; updateBtn(); renderPanel(); onChange(selected); });
    actions.appendChild(bAll); actions.appendChild(bNone);
    panel.appendChild(actions);
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = container.classList.contains('open');
    $$('.msel.open').forEach((m) => m.classList.remove('open'));
    if (!wasOpen) { renderPanel(); container.classList.add('open'); }
  });
  document.addEventListener('click', () => container.classList.remove('open'));
  panel.addEventListener('click', (e) => e.stopPropagation());
  updateBtn();
  container.appendChild(btn); container.appendChild(panel);
  return { refresh: renderPanel };
}

/* ==================== Rendu : navigation ==================== */
const TABS = [
  { id: 'tab-1', label: '📄 1. Planning MC & River' },
  { id: 'tab-2', label: '👥 2. Liste de collaborateurs' },
  { id: 'tab-3', label: '📅 3. Génération planning visite' },
  { id: 'tab-4', label: '📋 4. Planning visite' },
  { id: 'tab-5', label: '✅ 5. Import fichier Suivi' },
  { id: 'tab-6', label: '🚫 6. Absences' },
  { id: 'tab-7', label: '📊 7. Dashboard & Extractions' },
  { id: 'tab-8', label: '⚙️ Paramètres', admin: true },
];
function buildTabs() {
  const nav = $('#tabs-nav');
  nav.innerHTML = '';
  TABS.forEach((t) => {
    if (t.admin && !isAdmin()) return;
    const b = document.createElement('button');
    b.textContent = t.label;
    b.dataset.tab = t.id;
    b.addEventListener('click', () => switchTab(t.id));
    nav.appendChild(b);
  });
}
function switchTab(tabId) {
  $$('.tab-content').forEach((s) => s.classList.add('hidden'));
  $('#' + tabId).classList.remove('hidden');
  $$('#tabs-nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
  if (tabId === 'tab-1') renderTab1();
  if (tabId === 'tab-2') renderTab2();
  if (tabId === 'tab-3') renderTab3();
  if (tabId === 'tab-4') renderTab4();
  if (tabId === 'tab-5') renderTab5();
  if (tabId === 'tab-6') renderTab6();
  if (tabId === 'tab-7') renderTab7();
  if (tabId === 'tab-8') renderTab8();
}

/* ==================== Rendu : sélecteurs de semaine ==================== */
function fillWeekSelect(sel) {
  sel.innerHTML = '';
  if (!S.weeks.length) {
    const o = document.createElement('option'); o.textContent = '— aucune semaine —'; sel.appendChild(o); sel.disabled = true;
    return;
  }
  sel.disabled = false;
  S.weeks.forEach((w) => {
    const o = document.createElement('option'); o.value = w; o.textContent = w;
    if (w === S.currentWeek) o.selected = true;
    sel.appendChild(o);
  });
}

/* ==================== ONGLET 1 : Planning MC & River ==================== */
async function renderTab1() {
  fillWeekSelect($('#t1-week'));
  $('#t1-del-week').style.display = isAdmin() ? '' : 'none';
  $('#t1-hint').textContent = isAdmin() ? '' : '🔒 import réservé aux administrateurs';
  $('#t1-import').style.display = isAdmin() ? '' : 'none';
  $('#t1-table').innerHTML = '';
  const week = S.currentWeek;
  if (!week) { $('#t1-table').innerHTML = '<div class="info-box">Aucune semaine chargée. Importez un planning ci-dessus.</div>'; return; }
  showLoading('Chargement du planning ' + week + '…');
  try { await ensurePlanning(week); } finally { hideLoading(); }
  const planning = S.plannings[week] || [];
  const dates = getDatesFromWeek(week);

  const cols = ['TRANSPORT', 'WORKDAY ID', 'Paid ID', 'Nom', 'Projet'];
  if (planning.length && planning[0]['Statut'] !== undefined) cols.push('Statut');
  const dayCols = [];
  for (const j of JOURS) {
    const ds = dates[j].getDate() + '/' + (dates[j].getMonth() + 1) + '/' + dates[j].getFullYear();
    const dstr = pad2(dates[j].getDate()) + '/' + pad2(dates[j].getMonth() + 1) + '/' + dates[j].getFullYear();
    cols.push(`${dstr} - Début`, `${dstr} - Fin`, `${dstr} - Présent`);
    dayCols.push({ de: j + '_DE', a: j + '_A', flag: j + '_Flag', dstr });
  }
  const rowsHtml = planning.map((r) => {
    let h = '<tr>';
    h += `<td>${esc(r['TRANSPORT'])}</td><td>${esc(r['WORKDAY ID'])}</td><td>${esc(r['Paid ID'])}</td><td>${esc(r['Nom'])}</td><td>${esc(r['Projet'])}</td>`;
    if (planning.length && planning[0]['Statut'] !== undefined) h += `<td>${esc(r['Statut'])}</td>`;
    for (const dc of dayCols) {
      h += `<td>${fmtTimeDisplay(r[dc.de])}</td><td>${fmtTimeDisplay(r[dc.a])}</td>`;
      h += `<td>${r[dc.flag] ? '✔' : ''}</td>`;
    }
    h += '</tr>';
    return h;
  }).join('');
  $('#t1-table').innerHTML =
    `<div class="table-wrap"><table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
  $('#t1-export').onclick = () => {
    const display = planning.map((r) => {
      const o = {};
      ['TRANSPORT', 'WORKDAY ID', 'Paid ID', 'Nom', 'Projet'].forEach((c) => { o[c] = r[c]; });
      if (r['Statut'] !== undefined) o['Statut'] = r['Statut'];
      for (const dc of dayCols) {
        o[`${dc.dstr} - Début`] = fmtTimeDisplay(r[dc.de]);
        o[`${dc.dstr} - Fin`] = fmtTimeDisplay(r[dc.a]);
        o[`${dc.dstr} - Présent`] = r[dc.flag] ? 1 : 0;
      }
      return o;
    });
    exportExcel(display, Object.keys(display[0]), `planning_${week}.xlsx`);
  };
}
function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function importPlanning() {
  if (!S.files.planning.length) { toast('Veuillez importer au moins un fichier de Planning dans le menu de gauche.', 'error'); return; }
  let weekName = $('#t1-week-name').value.trim();
  if (!weekName) {
    showLoading('Détection de la semaine…');
    try {
      for (const f of S.files.planning) {
        const wb = await readWorkbook(f);
        const wk = getWeekNumberFromWorkbook(wb);
        if (wk) { weekName = wk; break; }
      }
    } finally { hideLoading(); }
    if (!weekName) weekName = 'S' + pad2(isoWeek(new Date()));
  }
  showLoading('Traitement des fichiers en cours…');
  try {
    const df = await parsePlanningFiles(S.files.planning);
    if (!df.length) { toast('Aucun planning reconnu dans les fichiers (feuilles « Tout (WFO+WFH) » ou « TMM » attendues).', 'error'); return; }
    S.plannings[weekName] = df;
    if (!S.weeks.includes(weekName)) { S.weeks.push(weekName); S.weeks.sort(); }
    if (S.medical) syncStatutWithPlannings(S.medical, S.plannings);
    await savePlanning(weekName);
    if (S.medical) await saveMedical();
    S.currentWeek = weekName;
    toast(`Semaine ${weekName} chargée et sauvegardée avec succès (${df.length} lignes) !`);
    renderTab1();
  } finally { hideLoading(); }
}

/* ==================== ONGLET 2 : Liste de collaborateurs ==================== */
function renderTab2() {
  $('#t2-load').style.display = isAdmin() ? '' : 'none';
  $('#t2-danger').style.display = isAdmin() ? '' : 'none';
  const cont = $('#t2-filters');
  const table = $('#t2-table');
  if (!S.medical) {
    cont.innerHTML = ''; table.innerHTML = '<div class="warn-box">Aucune liste chargée. Utilisez « Charger le fichier » (fichier PLANIFICATION VISITE SYSTEMATIQUE dans le menu de gauche).</div>';
    $('#t2-export').disabled = true;
    return;
  }
  $('#t2-export').disabled = false;
  const projets = [...new Set(S.medical.map((m) => str(m['Projet'] || 'N/A')))].sort();
  const prios = [...new Set(S.medical.map((m) => str(m['Priorité Visite'])).filter((x) => x))].sort();
  cont.innerHTML = '';
  const c1 = document.createElement('div'); const l1 = document.createElement('div'); l1.className = 'muted'; l1.textContent = 'Filtrer par Projet'; c1.appendChild(l1);
  const m1 = document.createElement('div'); c1.appendChild(m1);
  const c2 = document.createElement('div'); const l2 = document.createElement('div'); l2.className = 'muted'; l2.textContent = 'Filtrer par Priorité'; c2.appendChild(l2);
  const m2 = document.createElement('div'); c2.appendChild(m2);
  cont.appendChild(c1); cont.appendChild(c2);
  multiselect(m1, 'Tous les projets', projets, S.t2Filters.projet, () => renderTab2Table());
  multiselect(m2, 'Toutes priorités', prios, S.t2Filters.prio, () => renderTab2Table());
  renderTab2Table();
}
function renderTab2Table() {
  let rows = S.medical || [];
  if (S.t2Filters.projet.length) rows = rows.filter((r) => S.t2Filters.projet.includes(str(r['Projet'])));
  if (S.t2Filters.prio.length) rows = rows.filter((r) => S.t2Filters.prio.includes(str(r['Priorité Visite'])));
  const cols = ['WORKDAY ID', 'Payroll ID', 'Nom', 'Prénom', 'Statut', "Date d'embauche", 'Ancienneté', 'Projet', 'Priorité Visite'];
  const html = rows.map((r) => '<tr>' + cols.map((c) => {
    let v = r[c];
    if (c === "Date d'embauche") v = fmtDateFR(v);
    return `<td>${esc(v)}</td>`;
  }).join('') + '</tr>').join('');
  $('#t2-table').innerHTML = `<div class="muted" style="margin-bottom:6px">${rows.length} collaborateurs</div>
    <div class="table-wrap"><table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${html}</tbody></table></div>`;
  $('#t2-export').onclick = () => {
    const display = rows.map((r) => { const o = {}; cols.forEach((c) => { o[c] = c === "Date d'embauche" ? fmtDateFR(r[c]) : r[c]; }); return o; });
    exportExcel(display, cols, 'export_liste_visite.xlsx');
  };
}
async function loadListeFile() {
  if (!S.files.liste) { toast('Veuillez importer le fichier PLANIFICATION VISITE SYSTEMATIQUE dans le menu de gauche.', 'error'); return; }
  showLoading('Lecture du fichier…');
  try {
    const wb = await readWorkbook(S.files.liste);
    const rows = parseListeVisite(wb);
    if (rows === null) { toast('Fichier non reconnu : colonne WORKDAY/EMPLOYEE/MATRICULE introuvable.', 'error'); return; }
    syncStatutWithPlannings(rows, S.plannings);
    S.medical = rows;
    await saveMedical();
    toast(`${rows.length} collaborateurs chargés avec succès !`);
    renderTab2();
  } finally { hideLoading(); }
}

/* ==================== ONGLET 3 : Génération ==================== */
function renderTab3() {
  fillWeekSelect($('#t3-week'));
  const form = $('#t3-form');
  if (!S.medical) {
    form.innerHTML = '<div class="warn-box">Veuillez charger la liste des visiteurs (onglet 2).</div>';
    $('#t3-edit-table').innerHTML = ''; $('#t3-result').innerHTML = '';
    return;
  }
  if (!S.weeks.length) {
    form.innerHTML = '<div class="warn-box">Veuillez importer un planning sur l\'onglet 1.</div>';
    $('#t3-edit-table').innerHTML = ''; $('#t3-result').innerHTML = '';
    return;
  }
  const year = new Date().getFullYear();
  const m = str(S.currentWeek).match(/\d+/);
  const weekNum = m ? parseInt(m[0], 10) : isoWeek(new Date());
  const monday = mondayOfISOWeek(year, weekNum);
  const days = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  let html = '<div class="days-grid">';
  days.forEach((d, i) => {
    const dt = new Date(monday); dt.setDate(monday.getDate() + i);
    html += `
      <div class="day-card" data-day="${i}">
        <h4><input type="checkbox" class="dc-actif" checked> ${d}</h4>
        <label>Date</label><input type="date" class="dc-date" value="${dateToISO(dt)}" disabled>
        <div class="row2">
          <div><label>Début</label><input type="time" class="dc-debut" value="09:00"></div>
          <div><label>Fin</label><input type="time" class="dc-fin" value="16:00"></div>
        </div>
        <div class="row2">
          <div><label>Nb River</label><input type="number" class="dc-river" min="0" max="100" value="5"></div>
          <div><label>Nb Autres</label><input type="number" class="dc-others" min="0" max="100" value="20"></div>
        </div>
        <label>Prioriser</label>
        <select class="dc-prio">
          <option>Aucune priorité</option>
          <option>Visite systématique</option>
          <option>Visite d'embauche</option>
        </select>
        <label>Statut</label>
        <select class="dc-statut"><option>Tous</option><option>CC</option><option>ENC</option></select>
      </div>`;
  });
  html += '</div>';
  form.innerHTML = html;
  renderPlannedWeek();
  renderEditTable();
}
async function doGenerate() {
  if (!isAdmin()) { toast('🔒 Action réservée aux administrateurs.', 'warn'); return; }
  const cards = $$('#t3-form .day-card');
  const configs = cards.map((card, i) => ({
    actif: card.querySelector('.dc-actif').checked,
    date: card.querySelector('.dc-date').value,
    debut: card.querySelector('.dc-debut').value || '09:00',
    fin: card.querySelector('.dc-fin').value || '16:00',
    qtyRiver: +card.querySelector('.dc-river').value || 0,
    qtyOthers: +card.querySelector('.dc-others').value || 0,
    prio: card.querySelector('.dc-prio').value,
    statutFilter: card.querySelector('.dc-statut').value,
  }));
  showLoading('Génération de la planification…');
  try {
    await ensurePlanning(S.currentWeek);
    const total = generatePlanning(configs);
    await saveMedical();
    if (total > 0) toast(`✅ ${total} collaborateurs planifiés au total sur les jours actifs !`);
    else toast('Aucun collaborateur ne correspond aux critères pour les jours actifs (créneaux ou shifts incompatibles).', 'warn');
    renderPlannedWeek();
    renderEditTable();
  } finally { hideLoading(); }
}
function plannedThisWeek() {
  const m = str(S.currentWeek).match(/\d+/);
  if (!m || !S.medical) return [];
  const year = new Date().getFullYear();
  const monday = mondayOfISOWeek(year, parseInt(m[0], 10));
  const end = new Date(monday); end.setDate(monday.getDate() + 6);
  return S.medical.filter((r) => {
    if (r['Statut Visite'] !== 'Planifié' || !r['Date Visite']) return false;
    const d = isoToDate(r['Date Visite']);
    return d >= monday && d <= end;
  });
}
function renderPlannedWeek() {
  const cont = $('#t3-result');
  if (!S.currentWeek || !S.medical) { cont.innerHTML = ''; return; }
  const planned = enrichShifts(plannedThisWeek().map((r) => ({ ...r })));
  let html = `<h3 style="margin-top:18px">📋 Personnes planifiées pour ${esc(S.currentWeek)}</h3>`;
  if (!planned.length) {
    html += '<div class="info-box">Aucune personne planifiée pour cette semaine pour le moment.</div>';
  } else {
    const cols = ['WORKDAY ID', 'Payroll ID', 'Nom', 'Projet', 'Date Visite', 'Créneau Visite', 'Shift Début', 'Shift Fin', 'Priorité Visite'];
    html += '<div class="table-wrap"><table class="data"><thead><tr>' + cols.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
      planned.map((r) => '<tr>' + cols.map((c) => {
        let v = r[c];
        if (c === 'Date Visite') v = fmtDateFR(v);
        if (c === 'Créneau Visite') v = str(v).match(/T(\d{2}:\d{2})/) ? str(v).match(/T(\d{2}:\d{2})/)[1] : '';
        return `<td>${esc(v)}</td>`;
      }).join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  if (isAdmin() && planned.length) {
    html += `<div class="toolbar" style="margin-top:10px"><button class="btn btn-danger btn-sm" id="t3-unplan-week">🗑️ Tout déplanifier (cette semaine)</button></div>`;
  }
  cont.innerHTML = html;
  const btn = $('#t3-unplan-week');
  if (btn) btn.addEventListener('click', async () => {
    if (!confirm('Supprimer toutes les planifications de la semaine ' + S.currentWeek + ' ?')) return;
    for (const r of plannedThisWeek()) {
      r['Statut Visite'] = 'Non Planifié'; r['Date Visite'] = null; r['Créneau Visite'] = null;
      r['Heure Départ'] = null; r['Heure Retour'] = null; r['Commentaire'] = '';
    }
    await saveMedical();
    toast('Toutes les planifications de la semaine ont été supprimées.');
    renderPlannedWeek(); renderEditTable();
  });
}
function renderEditTable() {
  const cont = $('#t3-edit-table');
  if (!S.medical) { cont.innerHTML = ''; return; }
  const q = ($('#t3-search').value || '').toLowerCase();
  let rows = S.medical;
  if (q) rows = rows.filter((r) => [r['WORKDAY ID'], r['Nom'], r['Prénom'], r['Projet'], r['Statut Visite']].some((v) => str(v).toLowerCase().includes(q)));
  const statutOptions = ['Non Planifié', 'Planifié', 'Visite Faite', 'Absent', 'Reporté'];
  const rowsHtml = rows.slice(0, 2000).map((r) => {
    const idx = S.medical.indexOf(r);
    const cr = str(r['Créneau Visite']).match(/T(\d{2}:\d{2})/);
    return `<tr data-idx="${idx}">
      <td>${esc(r['WORKDAY ID'])}</td><td>${esc(r['Nom'])}</td><td>${esc(r['Projet'])}</td>
      <td><input type="text" list="statut-list" class="ed-statut" value="${esc(r['Statut Visite'])}"></td>
      <td><input type="date" class="ed-date" value="${r['Date Visite'] || ''}"></td>
      <td><input type="time" class="ed-creneau" value="${cr ? cr[1] : ''}"></td>
    </tr>`;
  }).join('');
  cont.innerHTML = `<div class="muted" style="margin-bottom:6px">${Math.min(rows.length, 2000)} lignes affichées${rows.length > 2000 ? ' (sur ' + rows.length + ' — affinez la recherche)' : ''}</div>
    <datalist id="statut-list">${statutOptions.map((s) => `<option value="${s}">`).join('')}</datalist>
    <div class="table-wrap"><table class="data"><thead><tr><th>WORKDAY ID</th><th>Nom</th><th>Projet</th><th>Statut Visite</th><th>Date Visite</th><th>Créneau Visite</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>`;
}
async function saveEdits() {
  if (!isAdmin()) { toast('🔒 Action réservée aux administrateurs.', 'warn'); return; }
  const trs = $$('#t3-edit-table tbody tr');
  for (const tr of trs) {
    const idx = +tr.dataset.idx;
    const r = S.medical[idx];
    if (!r) continue;
    const statut = tr.querySelector('.ed-statut').value.trim();
    const date = tr.querySelector('.ed-date').value || null;
    const creneau = tr.querySelector('.ed-creneau').value || null;
    if (statut.toLowerCase() === 'non planifié') {
      r['Statut Visite'] = 'Non Planifié'; r['Date Visite'] = null; r['Créneau Visite'] = null;
    } else {
      r['Statut Visite'] = statut;
      r['Date Visite'] = date;
      r['Créneau Visite'] = date && creneau ? date + 'T' + creneau + ':00' : null;
    }
  }
  showLoading('Sauvegarde…');
  try {
    await saveMedical();
    toast('Modifications manuelles sauvegardées avec succès !');
    renderPlannedWeek();
  } finally { hideLoading(); }
}

/* ==================== ONGLET 4 : Planning visite global ==================== */
function renderTab4() {
  $('#t4-danger').style.display = isAdmin() ? '' : 'none';
  const cont = $('#t4-table');
  if (!S.medical) { cont.innerHTML = '<div class="warn-box">Aucune donnée disponible. Importez la liste (onglet 2).</div>'; $('#t4-export').disabled = true; return; }
  const planned = S.medical.filter((r) => r['Statut Visite'] === 'Planifié');
  if (!planned.length) { cont.innerHTML = '<div class="info-box">Aucune visite planifiée pour le moment.</div>'; $('#t4-export').disabled = true; return; }
  $('#t4-export').disabled = false;
  enrichShifts(planned);
  const cols = ['WORKDAY ID', 'Payroll ID', 'Nom', 'Prénom', 'Statut', "Date d'embauche", 'Ancienneté', 'Projet', 'Priorité Visite', 'Statut Visite', 'Date Visite', 'Créneau Visite', 'Shift Début', 'Shift Fin'];
  cont.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr>' + cols.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
    planned.map((r) => '<tr>' + cols.map((c) => {
      let v = r[c];
      if (c === 'Date Visite' || c === "Date d'embauche") v = fmtDateFR(v);
      if (c === 'Créneau Visite') v = str(v).match(/T(\d{2}:\d{2})/) ? str(v).match(/T(\d{2}:\d{2})/)[1] : '';
      return `<td>${esc(v)}</td>`;
    }).join('') + '</tr>').join('') + '</tbody></table></div>';
  $('#t4-export').onclick = () => {
    const display = planned.map((r) => { const o = {}; cols.forEach((c) => {
      let v = r[c];
      if (c === 'Date Visite' || c === "Date d'embauche") v = fmtDateFR(v);
      if (c === 'Créneau Visite') v = str(v).match(/T(\d{2}:\d{2})/) ? str(v).match(/T(\d{2}:\d{2})/)[1] : '';
      o[c] = v; }); return o; });
    exportExcel(display, cols, 'planification_globale.xlsx');
  };
}

/* ==================== ONGLET 5 : Import Suivi (RTA) ==================== */
function renderTab5() {
  $('#t5-import').style.display = isAdmin() ? '' : 'none';
  $('#t5-del').style.display = isAdmin() && S.rta ? '' : 'none';
  const cont = $('#t5-table');
  if (!S.rta) { cont.innerHTML = '<div class="info-box">Aucune donnée RTA importée pour le moment.</div>'; return; }
  const payrollMap = new Map();
  if (S.medical) for (const m of S.medical) { if (!payrollMap.has(m['WORKDAY ID'])) payrollMap.set(m['WORKDAY ID'], m['Payroll ID']); }
  const cols = ['WORKDAY ID', 'Payroll ID', 'Nom complet', 'Projet', 'Statut Visite', 'Date Visite', 'Heure Départ', 'Heure Retour', 'Durée', 'Commentaire'];
  const rows = S.rta.map((r) => {
    const nomComplet = (str(r['Nom']) + ' ' + str(r['Prénom'])).trim();
    return {
      'WORKDAY ID': r['WORKDAY ID'],
      'Payroll ID': payrollMap.get(r['WORKDAY ID']) || '',
      'Nom complet': nomComplet,
      'Projet': r['Projet'] || '',
      'Statut Visite': r['Statut Visite'] || '',
      'Date Visite': fmtDateFR(r['Date Visite']),
      'Heure Départ': fmtTimeDisplay(r['Heure Départ']),
      'Heure Retour': fmtTimeDisplay(r['Heure Retour']),
      'Durée': r['Durée'] || '',
      'Commentaire': r['Commentaire'] || '',
    };
  });
  cont.innerHTML = `<div class="muted" style="margin-bottom:6px">${rows.length} lignes (feuille « Suivi »)</div>
    <div class="table-wrap"><table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => '<tr>' + cols.map((c) => `<td>${esc(r[c])}</td>`).join('') + '</tr>').join('')}</tbody></table></div>`;
}
async function importRta() {
  if (!S.files.rta) { toast('Veuillez importer le fichier RTA dans le menu de gauche.', 'error'); return; }
  showLoading('Mise à jour des données…');
  try {
    const wb = await readWorkbook(S.files.rta);
    const rows = parseRtaFile(wb);
    if (rows === null || !rows.length) { toast('Aucune donnée lue dans le fichier RTA.', 'error'); return; }
    S.rta = rows;
    await saveRta();
    toast('✅ Données RTA importées avec succès !');
    renderTab5();
  } finally { hideLoading(); }
}

/* ==================== ONGLET 6 : Absences ==================== */
function absenceRows() {
  if (!S.rta) return [];
  return S.rta.filter((r) => {
    const sv = str(r['Statut Visite']).toLowerCase();
    const com = str(r['Commentaire']).toLowerCase();
    return /absent|reporté|reporte/.test(sv) || /absent|reporté|reporte/.test(com);
  });
}
function renderTab6() {
  const cont = $('#t6-table');
  const rows = absenceRows();
  if (!S.rta) { cont.innerHTML = '<div class="warn-box">Aucune donnée disponible. Veuillez importer le fichier RTA (onglet 5).</div>'; $('#t6-export').disabled = true; return; }
  $('#t6-export').disabled = rows.length === 0;
  const cols = ['WORKDAY ID', 'Nom complet', 'Projet', 'Priorité Visite', 'Statut Visite', 'Date Visite', 'Commentaire'];
  cont.innerHTML = rows.length === 0
    ? '<div class="info-box">Aucune absence détectée (commentaire ou statut contenant « absent / reporté »).</div>'
    : '<div class="table-wrap"><table class="data"><thead><tr>' + cols.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + cols.map((c) => {
        let v = c === 'Nom complet' ? (str(r['Nom']) + ' ' + str(r['Prénom'])).trim() : (c === 'Priorité Visite' ? r['PRIORITE VISITE'] || r['Priorité Visite'] : r[c]);
        if (c === 'Date Visite') v = fmtDateFR(v);
        return `<td>${esc(v)}</td>`;
      }).join('') + '</tr>').join('') + '</tbody></table></div>';
  $('#t6-export').onclick = () => {
    const display = rows.map((r) => { const o = {}; cols.forEach((c) => {
      let v = c === 'Nom complet' ? (str(r['Nom']) + ' ' + str(r['Prénom'])).trim() : (c === 'Priorité Visite' ? r['PRIORITE VISITE'] || r['Priorité Visite'] : r[c]);
      if (c === 'Date Visite') v = fmtDateFR(v);
      o[c] = v; }); return o; });
    exportExcel(display, cols, 'absences_visites.xlsx');
  };
}

/* ==================== ONGLET 7 : Dashboard ==================== */
function buildDashboardData() {
  if (!S.rta) return null;
  const payrollMap = new Map();
  if (S.medical) for (const m of S.medical) { if (!payrollMap.has(m['WORKDAY ID'])) payrollMap.set(m['WORKDAY ID'], m['Payroll ID']); }
  const rows = S.rta.map((r) => {
    const dep = valToTimeMin(r['Heure Départ']);
    const ret = valToTimeMin(r['Heure Retour']);
    let dureeMin = null;
    if (dep !== null && ret !== null) { const d = ret - dep; if (d >= 0) dureeMin = d; }
    return {
      'WORKDAY ID': r['WORKDAY ID'],
      'Payroll ID': r['Payroll ID'] || payrollMap.get(r['WORKDAY ID']) || '',
      'Nom': r['Nom'] || '', 'Prénom': r['Prénom'] || '',
      'Projet_Affichage': getMappedProject(r['Projet'] || ''),
      'Statut Visite': r['Statut Visite'] || '',
      'Date Visite': r['Date Visite'] || null,
      'Heure Départ': fmtTimeDisplay(r['Heure Départ']),
      'Heure Retour': fmtTimeDisplay(r['Heure Retour']),
      'Durée (min)': dureeMin,
      'Commentaire': r['Commentaire'] || '',
      'Graph Status': getFinalStatus(r),
    };
  });
  return rows;
}
function plotLayout(extra) {
  return Object.assign({
    paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Segoe UI, Roboto, Helvetica, Arial, sans-serif', size: 12 },
    margin: { t: 30, b: 90, l: 50, r: 20 },
  }, extra || {});
}
function renderTab7() {
  const body = $('#t7-body');
  const data = buildDashboardData();
  if (!data) {
    body.innerHTML = '<div class="warn-box">Aucune donnée disponible. Veuillez importer le fichier RTA (onglet 5).</div>';
    return;
  }
  const allProjets = [...new Set(data.map((r) => r['Projet_Affichage']))].sort();
  if (S.t7Filter === null) S.t7Filter = [...allProjets];
  S.t7Filter = S.t7Filter.filter((p) => allProjets.includes(p));

  body.innerHTML = `
    <div class="toolbar"><div class="muted">Filtrer par Projet&nbsp;:</div><div id="t7-msel"></div></div>
    <div class="metrics">
      <div class="metric"><span class="lbl">Total à passer</span><span class="val" id="m-total">–</span></div>
      <div class="metric"><span class="lbl">Visites effectuées</span><span class="val" id="m-fait">–</span><span class="delta" id="m-fait-pct"></span></div>
      <div class="metric"><span class="lbl">Planifiés</span><span class="val" id="m-plan">–</span></div>
      <div class="metric"><span class="lbl">Absents / Reportés</span><span class="val" id="m-abs">–</span></div>
    </div>
    <h3>1. Total à passer vs Planifié</h3><div id="chart1" class="chart"></div>
    <hr class="side-sep">
    <h3>2. Planifié vs Visite effectuée vs Absents/Reporté</h3><div id="chart2" class="chart"></div>
    <hr class="side-sep">
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:20px">
      <div><h3>Avancement Global</h3><div id="chart-donut" class="chart" style="min-height:340px"></div></div>
      <div><h3>Durée moyenne par jour</h3><div id="t7-avg"></div></div>
    </div>
    <hr class="side-sep">
    <h3>Top 5 des durées les plus élevées</h3><div id="t7-top5"></div>
    <hr class="side-sep">
    <h3>✅ Liste des visites effectuées</h3><div id="t7-done"></div>
    <hr class="side-sep">
    <h3>📅 Extraction du Rapport Journalier</h3>
    <div class="card">
      <div class="toolbar">
        <input type="date" id="t7-date" value="${S.rapportDate || dateToISO(new Date())}">
        <button class="btn btn-primary btn-sm" id="t7-rap-btn">Générer le rapport du jour</button>
        <span class="muted" id="t7-rap-info"></span>
        <div class="spacer"></div>
        <button class="btn btn-secondary btn-sm hidden" id="t7-rap-dl">📥 Télécharger le rapport journalier (Excel)</button>
      </div>
    </div>
    <hr class="side-sep">
    <h3>📥 Extraction complète (Format Export)</h3>
    <button class="btn btn-secondary" id="t7-export-all">Télécharger le suivi global (Format Export)</button>
  `;

  multiselect($('#t7-msel'), '— choisir des projets —', allProjets, S.t7Filter, (sel) => { S.t7Filter = sel; renderTab7(); });

  let med = data.filter((r) => S.t7Filter.includes(r['Projet_Affichage']));
  const total = med.length;
  const fait = med.filter((r) => r['Graph Status'] === 'Visite effectuée').length;
  const plan = med.filter((r) => ['planifié', 'planifie'].includes(str(r['Statut Visite']).toLowerCase())).length;
  const abs = med.filter((r) => r['Graph Status'] === 'Absent/Reporté').length;
  $('#m-total').textContent = total;
  $('#m-fait').textContent = fait;
  $('#m-fait-pct').textContent = total > 0 ? (fait / total * 100).toFixed(1) + '%' : '0%';
  $('#m-plan').textContent = plan;
  $('#m-abs').textContent = abs;

  // --- Graphique 1 : overlay Total vs Planifié ---
  const byProj = {};
  med.forEach((r) => {
    const p = r['Projet_Affichage'];
    byProj[p] = byProj[p] || { total: 0, plan: 0, fait: 0, abs: 0 };
    byProj[p].total++;
    if (['planifié', 'planifie'].includes(str(r['Statut Visite']).toLowerCase())) byProj[p].plan++;
    const com = str(r['Commentaire']).toLowerCase();
    if (com.includes('ok')) byProj[p].fait++;
    if (com.includes('absent') || com.includes('report')) byProj[p].abs++;
  });
  const order = Object.entries(byProj).sort((a, b) => b[1].total - a[1].total).map((e) => e[0]);
  if (window.Plotly && order.length) {
    Plotly.newPlot('chart1', [
      { type: 'bar', x: order, y: order.map((p) => byProj[p].total), name: 'Total', marker: { color: '#747474' }, text: order.map((p) => byProj[p].total), textposition: 'outside' },
      { type: 'bar', x: order, y: order.map((p) => byProj[p].plan), name: 'Planifié', marker: { color: '#003D5B' }, text: order.map((p) => byProj[p].plan), textposition: 'auto' },
    ], plotLayout({ barmode: 'overlay', legend: { title: { text: 'Légende' } }, yaxis: { range: [0, Math.max(...order.map((p) => byProj[p].total)) * 1.15] } }), { responsive: true });

    // --- Graphique 2 : groupé ---
    const order2 = Object.entries(byProj).filter(([, v]) => v.plan + v.fait + v.abs > 0)
      .sort((a, b) => b[1].plan - a[1].plan).map((e) => e[0]);
    Plotly.newPlot('chart2', [
      { type: 'bar', name: 'Planifié', x: order2, y: order2.map((p) => byProj[p].plan), marker: { color: '#003D5B' } },
      { type: 'bar', name: 'Visite effectuée', x: order2, y: order2.map((p) => byProj[p].fait), marker: { color: '#25E2CC' } },
      { type: 'bar', name: 'Absent/Reporté', x: order2, y: order2.map((p) => byProj[p].abs), marker: { color: '#FBCA18' } },
    ], plotLayout({ barmode: 'group', yaxis: { range: [0, Math.max(1, ...order2.flatMap((p) => [byProj[p].plan, byProj[p].fait, byProj[p].abs])) * 1.15] } }), { responsive: true });

    // --- Donut ---
    const reste = Math.max(0, plan - fait);
    const nonPlan = Math.max(0, total - plan);
    const labels = [], values = [], colors = [], pull = [], texts = [];
    const pctPlan = total > 0 ? plan / total * 100 : 0;
    const pctFait = total > 0 ? fait / total * 100 : 0;
    if (fait > 0) { labels.push('Visite effectuée'); values.push(fait); colors.push('#25E2CC'); pull.push(0.05); texts.push(`Visite effectuée<br>${fait} (${pctFait.toFixed(1)}%)`); }
    if (reste > 0) { labels.push('Reste Planifié'); values.push(reste); colors.push('#003D5B'); pull.push(0.05); texts.push(`Total Planifié<br>${plan} (${pctPlan.toFixed(1)}%)`); }
    if (nonPlan > 0) { labels.push('Non Planifié'); values.push(nonPlan); colors.push('#747474'); pull.push(0); texts.push(' '); }
    if (values.length) {
      Plotly.newPlot('chart-donut', [{
        type: 'pie', labels, values, hole: 0.6, marker: { colors }, pull, sort: false, direction: 'clockwise',
        text: texts, textinfo: 'text', textposition: 'outside', outsidetextfont: { size: 12 },
      }], plotLayout({ showlegend: false, margin: { t: 40, b: 20, l: 20, r: 20 } }), { responsive: true });
    }
  } else if (!window.Plotly) {
    $('#chart1').innerHTML = '<div class="warn-box">Graphiques indisponibles : librairie Plotly non chargée (connexion internet requise au premier chargement).</div>';
  }

  // --- Durée moyenne par jour ---
  const byDate = {};
  med.forEach((r) => {
    if (r['Durée (min)'] !== null && r['Date Visite']) {
      byDate[r['Date Visite']] = byDate[r['Date Visite']] || { sum: 0, n: 0 };
      byDate[r['Date Visite']].sum += r['Durée (min)']; byDate[r['Date Visite']].n++;
    }
  });
  const avgRows = Object.entries(byDate).sort((a, b) => a[0] < b[0] ? -1 : 1)
    .map(([d, v]) => ({ 'Date': fmtDateFR(d), 'Durée Moyenne': fmtDuration(v.sum / v.n) }));
  $('#t7-avg').innerHTML = avgRows.length
    ? '<div class="table-wrap" style="max-height:340px"><table class="data"><thead><tr><th>Date</th><th>Durée Moyenne</th></tr></thead><tbody>' +
      avgRows.map((r) => `<tr><td>${r['Date']}</td><td>${r['Durée Moyenne']}</td></tr>`).join('') + '</tbody></table></div>'
    : '<div class="info-box">Aucune donnée de durée disponible pour le moment.</div>';

  // --- Top 5 durées ---
  const top5 = med.filter((r) => r['Durée (min)'] !== null).sort((a, b) => b['Durée (min)'] - a['Durée (min)']).slice(0, 5);
  $('#t7-top5').innerHTML = top5.length
    ? '<div class="table-wrap"><table class="data"><thead><tr><th>WORKDAY ID</th><th>Nom Complet</th><th>Projet</th><th>Heure Départ</th><th>Heure Retour</th><th>Durée</th></tr></thead><tbody>' +
      top5.map((r) => `<tr><td>${esc(r['WORKDAY ID'])}</td><td>${esc(r['Nom'] + ' ' + r['Prénom'])}</td><td>${esc(r['Projet_Affichage'])}</td><td>${r['Heure Départ']}</td><td>${r['Heure Retour']}</td><td>${fmtDuration(r['Durée (min)'])}</td></tr>`).join('') + '</tbody></table></div>'
    : '<div class="info-box">Aucune donnée de durée disponible pour le moment.</div>';

  // --- Visites effectuées ---
  const done = med.filter((r) => str(r['Commentaire']).toLowerCase().includes('ok'));
  $('#t7-done').innerHTML = done.length
    ? '<div class="table-wrap" style="max-height:400px"><table class="data"><thead><tr><th>WORKDAY ID</th><th>Payroll ID</th><th>Nom complet</th><th>Projet</th><th>Statut visite</th></tr></thead><tbody>' +
      done.map((r) => `<tr><td>${esc(r['WORKDAY ID'])}</td><td>${esc(r['Payroll ID'])}</td><td>${esc(r['Nom'] + ' ' + r['Prénom'])}</td><td>${esc(r['Projet_Affichage'])}</td><td>Done</td></tr>`).join('') + '</tbody></table></div>'
    : '<div class="info-box">Aucune visite effectuée (commentaire OK) pour le moment.</div>';

  // --- Rapport journalier ---
  $('#t7-rap-btn').onclick = () => {
    const d = $('#t7-date').value;
    S.rapportDate = d;
    const rows = med.filter((r) => r['Date Visite'] === d);
    $('#t7-rap-info').textContent = `${rows.length} collaborateurs concernés le ${fmtDateFR(d)}`;
    const btnDl = $('#t7-rap-dl');
    if (!rows.length) { btnDl.classList.add('hidden'); toast('Aucune visite planifiée pour cette date.', 'warn'); return; }
    btnDl.classList.remove('hidden');
    btnDl.onclick = () => {
      const cols = ['WORKDAY ID', 'Nom', 'Projet_Affichage', 'Heure Départ', 'Heure Retour', 'Statut Visite', 'Commentaire'];
      exportExcel(rows.map((r) => { const o = {}; cols.forEach((c) => { o[c] = r[c]; }); return o; }), cols, `rapport_visite_${d.replace(/-/g, '')}.xlsx`);
    };
  };
  $('#t7-export-all').onclick = () => {
    const cols = ['WORKDAY ID', 'Nom', 'Projet_Affichage', 'Statut Visite', 'Date Visite'];
    exportExcel(med.map((r) => { const o = {}; cols.forEach((c) => { o[c] = c === 'Date Visite' ? fmtDateFR(r[c]) : r[c]; }); return o; }), cols, 'export_visites_medicales.xlsx');
  };
}

/* ==================== ONGLET 8 : Paramètres ==================== */
async function renderTab8() {
  if (!isAdmin()) return;
  const cont = $('#t8-users');
  showLoading('Chargement des utilisateurs…');
  try {
    const data = await api('/api/users');
    cont.innerHTML = '<div class="table-wrap" style="max-height:300px"><table class="data users-table"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>Créé le</th><th>Actions</th></tr></thead><tbody>' +
      data.users.map((u) => `<tr>
        <td><b>${esc(u.username)}</b>${u.username === S.user.username ? ' <span class="badge planifie">vous</span>' : ''}</td>
        <td><select data-user="${esc(u.username)}" class="u-role">
          <option value="consultation" ${u.role !== 'admin' ? 'selected' : ''}>Consultation</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select></td>
        <td>${esc(str(u.created_at))}</td>
        <td>
          <button class="btn btn-ghost btn-sm u-pass" data-user="${esc(u.username)}">🔑 Mot de passe</button>
          <button class="btn btn-danger btn-sm u-del" data-user="${esc(u.username)}">🗑️</button>
        </td></tr>`).join('') + '</tbody></table></div>';
    cont.querySelectorAll('.u-role').forEach((sel) => sel.addEventListener('change', async () => {
      try { await api('/api/users/' + encodeURIComponent(sel.dataset.user), { method: 'PUT', body: { role: sel.value } }); toast('Rôle mis à jour.'); }
      catch (e) { toast(e.message, 'error'); renderTab8(); }
    }));
    cont.querySelectorAll('.u-pass').forEach((btn) => btn.addEventListener('click', async () => {
      const pw = prompt('Nouveau mot de passe pour « ' + btn.dataset.user + ' » (min. 4 caractères) :');
      if (!pw) return;
      if (pw.length < 4) { toast('Mot de passe trop court (4 caractères minimum).', 'error'); return; }
      try { await api('/api/users/' + encodeURIComponent(btn.dataset.user), { method: 'PUT', body: { password: pw } }); toast('Mot de passe mis à jour.'); }
      catch (e) { toast(e.message, 'error'); }
    }));
    cont.querySelectorAll('.u-del').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement l\'utilisateur « ' + btn.dataset.user + ' » ?')) return;
      try { await api('/api/users/' + encodeURIComponent(btn.dataset.user), { method: 'DELETE' }); toast('Utilisateur supprimé.'); renderTab8(); }
      catch (e) { toast(e.message, 'error'); }
    }));
  } catch (e) {
    cont.innerHTML = '<div class="danger-box">' + esc(e.message) + '</div>';
  } finally { hideLoading(); }

  $('#t8-export').onclick = async () => {
    showLoading('Préparation de la sauvegarde…');
    try {
      const raw = await api('/api/export');
      const bundle = {
        app: raw.app, version: raw.version, exported_at: raw.exported_at,
        medical_list: raw.medical_list_raw ? JSON.parse(raw.medical_list_raw) : null,
        rta_data: raw.rta_raw ? JSON.parse(raw.rta_raw) : null,
        plannings: {},
      };
      for (const [w, s] of Object.entries(raw.plannings_raw || {})) bundle.plannings[w] = JSON.parse(s);
      const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sauvegarde_visites_medicales_' + dateToISO(new Date()).replace(/-/g, '') + '.json';
      a.click();
    } finally { hideLoading(); }
  };
  $('#t8-import-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (!confirm('ATTENTION : l\'import REMPLACE toutes les données actuelles par celles du fichier. Continuer ?')) { ev.target.value = ''; return; }
    showLoading('Import de la sauvegarde…');
    const prog = $('#t8-import-progress');
    try {
      const bundle = JSON.parse(await file.text());
      const steps = [];
      if (bundle.medical_list) steps.push(['liste des collaborateurs', () => api('/api/state/medical', { method: 'PUT', body: bundle.medical_list })]);
      if (bundle.rta_data) steps.push(['suivi RTA', () => api('/api/state/rta', { method: 'PUT', body: bundle.rta_data })]);
      for (const [w, rows] of Object.entries(bundle.plannings || {})) {
        steps.push(['planning ' + w, () => api('/api/state/planning/' + encodeURIComponent(w), { method: 'PUT', body: rows })]);
      }
      let done = 0;
      for (const [name, fn] of steps) {
        prog.textContent = `Import de ${name}… (${done + 1}/${steps.length})`;
        await fn();
        done++;
      }
      prog.textContent = '';
      toast(`✅ Import terminé (${steps.length} blocs de données).`);
      // recharger l'état
      S.plannings = {}; S.medical = null; S.rta = null;
      await refreshStateSummary();
      if (S.weeks.length) { S.currentWeek = S.weeks[0]; }
      showLoading('Rechargement…');
      try { await loadMedical(); await loadRta(); } finally { hideLoading(); }
      switchTab('tab-2');
    } catch (e) {
      prog.textContent = '';
      toast('Erreur d\'import : ' + e.message, 'error');
    } finally { hideLoading(); ev.target.value = ''; }
  };
  $('#t8-add').onclick = async () => {
    const u = $('#t8-new-user').value.trim(), p = $('#t8-new-pass').value, r = $('#t8-new-role').value;
    if (!u || !p) { toast('Nom d\'utilisateur et mot de passe requis.', 'error'); return; }
    try { await api('/api/users', { method: 'POST', body: { username: u, password: p, role: r } }); toast('Utilisateur ajouté.'); renderTab8(); }
    catch (e) { toast(e.message, 'error'); }
  };
}

/* ==================== Authentification / démarrage ==================== */
function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
}
function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#sb-user').textContent = S.user.username;
  $('#sb-role').textContent = S.user.role === 'admin' ? 'Admin' : 'Consultation';
  $('#side-imports').classList.toggle('hidden', !isAdmin());
  $('#side-lock').classList.toggle('hidden', isAdmin());
  buildTabs();
  switchTab('tab-1');
}
async function boot() {
  try {
    S.user = await api('/api/me');
  } catch (e) { showLogin(); return; }
  showApp();
  showLoading('Chargement des données…');
  try {
    await refreshStateSummary();
    const jobs = [loadMedical(), loadRta()];
    if (S.currentWeek) jobs.push(ensurePlanning(S.currentWeek));
    await Promise.all(jobs);
    switchTab('tab-1');
  } catch (e) {
    toast(e.message, 'error');
  } finally { hideLoading(); }
}

/* ==================== Événements ==================== */
document.addEventListener('DOMContentLoaded', () => {
  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#login-error').textContent = '';
    try {
      const data = await api('/api/login', { method: 'POST', body: { username: $('#login-user').value, password: $('#login-pass').value } });
      S.user = { username: data.username, role: data.role };
      showApp();
      showLoading('Chargement des données…');
      try {
        await refreshStateSummary();
        await loadMedical(); await loadRta();
        if (S.currentWeek) await ensurePlanning(S.currentWeek);
        switchTab('tab-1');
      } finally { hideLoading(); }
    } catch (e) {
      $('#login-error').textContent = '😕 ' + e.message;
    }
  });
  $('#btn-logout').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    S.user = null; S.medical = null; S.rta = null; S.plannings = {}; S.weeks = []; S.currentWeek = null;
    showLogin();
  });
  $('#btn-burger').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  // Fichiers sidebar
  $('#file-planning').addEventListener('change', (e) => {
    S.files.planning = Array.from(e.target.files);
    $('#fname-planning').textContent = S.files.planning.map((f) => f.name).join(', ');
  });
  $('#file-liste').addEventListener('change', (e) => {
    S.files.liste = e.target.files[0] || null;
    $('#fname-liste').textContent = S.files.liste ? S.files.liste.name : '';
  });
  $('#file-rta').addEventListener('change', (e) => {
    S.files.rta = e.target.files[0] || null;
    $('#fname-rta').textContent = S.files.rta ? S.files.rta.name : '';
  });

  // Onglet 1
  $('#t1-week').addEventListener('change', (e) => { S.currentWeek = e.target.value; $('#t3-week').value = S.currentWeek; renderTab1(); });
  $('#t1-import').addEventListener('click', importPlanning);
  $('#t1-del-week').addEventListener('click', async () => {
    if (!S.currentWeek) return;
    if (!confirm('Supprimer la semaine ' + S.currentWeek + ' ?')) return;
    await api('/api/state/planning/' + encodeURIComponent(S.currentWeek), { method: 'DELETE' });
    delete S.plannings[S.currentWeek];
    S.weeks = S.weeks.filter((w) => w !== S.currentWeek);
    S.currentWeek = S.weeks.length ? S.weeks[0] : null;
    toast('Semaine supprimée.');
    renderTab1();
  });

  // Onglet 2
  $('#t2-load').addEventListener('click', loadListeFile);
  $('#t2-confirm').addEventListener('change', (e) => { $('#t2-del-all').disabled = !e.target.checked; });
  $('#t2-del-all').addEventListener('click', async () => {
    if (!confirm('Supprimer DÉFINITIVEMENT la liste et tout l\'historique de suivi ?')) return;
    await api('/api/state/medical', { method: 'DELETE' });
    S.medical = null;
    toast('Liste supprimée avec succès.');
    renderTab2();
  });

  // Onglet 3
  $('#t3-week').addEventListener('change', (e) => { S.currentWeek = e.target.value; $('#t1-week').value = S.currentWeek; renderTab3(); });
  $('#t3-generate').addEventListener('click', doGenerate);
  $('#t3-search').addEventListener('input', renderEditTable);
  $('#t3-save-edits').addEventListener('click', saveEdits);

  // Onglet 4
  $('#t4-confirm').addEventListener('change', (e) => { $('#t4-del-all').disabled = !e.target.checked; });
  $('#t4-del-all').addEventListener('click', async () => {
    if (!confirm('Supprimer DÉFINITIVEMENT toutes les planifications de toutes les semaines ?')) return;
    for (const r of S.medical || []) {
      r['Statut Visite'] = 'Non Planifié'; r['Date Visite'] = null; r['Créneau Visite'] = null;
      r['Heure Départ'] = null; r['Heure Retour'] = null; r['Commentaire'] = '';
    }
    await saveMedical();
    toast('Toutes les planifications ont été supprimées.');
    renderTab4();
  });

  // Onglet 5
  $('#t5-import').addEventListener('click', importRta);
  $('#t5-del').addEventListener('click', async () => {
    if (!confirm('Supprimer les données RTA ?')) return;
    await api('/api/state/rta', { method: 'DELETE' });
    S.rta = null;
    toast('Données RTA supprimées.');
    renderTab5();
  });

  // Onglets 6 / 7
  $('#t6-refresh').addEventListener('click', async () => { showLoading('Actualisation…'); try { await loadRta(); } finally { hideLoading(); } renderTab6(); });
  $('#t7-refresh').addEventListener('click', async () => { showLoading('Actualisation…'); try { await loadRta(); await loadMedical(); } finally { hideLoading(); } renderTab7(); });

  boot();
});
