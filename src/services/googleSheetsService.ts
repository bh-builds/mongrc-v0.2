import {
  AppConfiguration,
  SatkerData,
  UserProfile,
  UserRole,
} from '../types/mongrc';
import {
  normalizeCategoryLabel,
  normalizeTextToken,
  recalculateSatkerScores,
} from '../utils/grcCalculations';

export const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbwqFCh8G26f0xMUT1Ip9tCV7f_wLtTIyrHXnnNaTu36EjMBLuYcRGUtE9iVjVqPejAVYg/exec';

const DEPRECATED_APPS_SCRIPT_URLS = new Set([
  'https://script.google.com/macros/s/AKfycbzoZdr-hj50E11OrjXY0y77I9k5v4d5lG3xehu9UQBTyYTwyYlg2cAxuhWjlqf-5iY/exec',
  'https://script.google.com/macros/s/AKfycbyYm43wOWuTZTUGIORPEa80xPbuPYlTrgvXdbNHVjCi3A-j7Zgo34JqBmeGK9uXySS8/exec',
  'https://script.google.com/macros/s/AKfycbwtbnnwlfKzVWUrUrTxllF7-KhLQEtJ1cSPbdnqPc6he7gKnqmp4xdqXi_Jqu8iqvZp/exec',
]);

const APPS_SCRIPT_STORAGE_KEY = 'mongrc_apps_script_url_v3';
const LEGACY_STORAGE_KEYS = ['mongrc_storage_url_v2', 'mongrc_apps_script_url_v1'];

export const FALLBACK_SHEET_NAMES = {
  data: 'Data',
  users: 'Users',
  config: 'Configuration',
  audit: 'Audit_Logs',
  comments: 'Comments',
} as const;

export const DEFAULT_APP_CONFIG: AppConfiguration = {
  spreadsheetEditLocked: true,
  evaluationYear: String(new Date().getFullYear()),
  evaluationPeriod: 'Triwulan IV',
  appTitle: 'MonGRC Ditjen P2',
  dataSheetName: FALLBACK_SHEET_NAMES.data,
  usersSheetName: FALLBACK_SHEET_NAMES.users,
  configSheetName: FALLBACK_SHEET_NAMES.config,
  auditSheetName: FALLBACK_SHEET_NAMES.audit,
  commentsSheetName: FALLBACK_SHEET_NAMES.comments,
};

export function getStoredAppsScriptUrl(): string {
  try {
    const savedV3 = localStorage.getItem(APPS_SCRIPT_STORAGE_KEY)?.trim();
    if (savedV3 && savedV3.startsWith('https://script.google.com/')) {
      return savedV3;
    }

    for (const legacyKey of LEGACY_STORAGE_KEYS) {
      const legacy = localStorage.getItem(legacyKey)?.trim();
      if (
        legacy &&
        legacy.startsWith('https://script.google.com/') &&
        !DEPRECATED_APPS_SCRIPT_URLS.has(legacy)
      ) {
        localStorage.setItem(APPS_SCRIPT_STORAGE_KEY, legacy);
        return legacy;
      }
    }
  } catch {
    // ignore storage read error
  }
  return DEFAULT_APPS_SCRIPT_URL;
}

export function setStoredAppsScriptUrl(url: string): string {
  const clean = url.trim() || DEFAULT_APPS_SCRIPT_URL;
  try {
    localStorage.setItem(APPS_SCRIPT_STORAGE_KEY, clean);
  } catch {
    // ignore storage write error
  }
  return clean;
}

export interface SatkerRow extends Record<string, unknown> {
  KodeSatker: number;
  Year: string;
  EvaluationPeriod: string;
  SatkerLongName: string;
  SatkerShortName: string;
  No: number;
  Tahun: string;
  'Periode Evaluasi': string;
  'Unit Kerja / Satuan Kerja': string;
  SATKER: string;
  Kategori: string;
  SKI: number;
  SPIP: number;
  MRI: number;
  IEPK: number;
  SPIPT: number;
  'WBK/RB': number;
  SAKIP: number;
  NKA: number;
  IKPA: number;
  'IP-ASN': number;
  ARSIP: number;
  PEKPPP: number | '';
  PSKI: number;
  PSPIP: number;
  PMRI: number;
  PIEPK: number;
  PWBKRB: number;
  PSAKIP: number;
  PNKA: number;
  PIKPA: number;
  PIPASN: number;
  PARSIP: number;
  PPEKPPP: number;
  AVERAGE: number;
  'Terakhir Diubah Oleh': string;
  'Waktu Update': string;
}

export interface UserAccount extends Record<string, unknown> {
  ID: string;
  Username: string;
  Email: string;
  NIP: string;
  'Nama Lengkap': string;
  'Peran (Role)': UserRole;
  Instansi: string;
  'Satker Ditugaskan': string;
  'No Satker': number | '';
  Inisial: string;
  Status: 'active' | 'inactive';
  Password?: string;
  'Login Terakhir': string;
  'Dibuat Pada'?: string;
}

function parseOptionalNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const cleaned = String(val).replace(',', '.').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRequiredNumber(val: unknown, fallback = 0): number {
  const num = parseOptionalNumber(val);
  return num !== null ? num : fallback;
}

function normalizeUserRole(raw: unknown): UserRole {
  const text = String(raw || '').trim().toLowerCase();
  if (text === 'admin') return 'Admin';
  if (text === 'auditor') return 'Auditor';
  if (text === 'viewer') return 'Viewer';
  return 'Satker PIC';
}

function normalizeUserStatus(raw: unknown): 'active' | 'inactive' {
  const text = String(raw || '').trim().toLowerCase();
  if (text === 'inactive' || text === 'nonaktif' || text === 'disabled') {
    return 'inactive';
  }
  return 'active';
}

function pickField(raw: Record<string, unknown>, aliases: string[]): unknown {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined && raw[key] !== '') {
      return raw[key];
    }
  }
  const normalizedEntries = Object.entries(raw);
  const aliasSet = new Set(aliases.map((a) => normalizeTextToken(a)));
  for (const [k, v] of normalizedEntries) {
    if (aliasSet.has(normalizeTextToken(k)) && v !== undefined && v !== '') {
      return v;
    }
  }
  return undefined;
}

function normalizeTextField(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

export function mapSheetRowToSatker(
  raw: Record<string, unknown>,
  sheetRowNumber?: number
): SatkerData | null {
  const no = Math.trunc(
    parseRequiredNumber(pickField(raw, ['KodeSatker', 'No', 'no', 'Nomor', 'kodeSatker']), 0)
  );
  if (!no || no <= 0) return null;

  const unitKerja =
    normalizeTextField(
      pickField(raw, [
        'SatkerLongName',
        'Unit Kerja / Satuan Kerja',
        'Unit Kerja',
        'Satuan Kerja',
        'unitKerja',
      ])
    ) || `Satker ${no}`;
  const satker =
    normalizeTextField(pickField(raw, ['SatkerShortName', 'SATKER', 'satker', 'Unit'])) ||
    unitKerja;
  const category = normalizeCategoryLabel(
    pickField(raw, ['Kategori', 'category', 'Kelas']) ?? unitKerja
  );

  const yearRaw = normalizeTextField(
    pickField(raw, ['Year', 'Tahun', 'Tahun Evaluasi', 'evaluationYear', 'evaluation_year', 'thn'])
  );
  const periodRaw = normalizeTextField(
    pickField(raw, [
      'EvaluationPeriod',
      'Periode Evaluasi',
      'Periode',
      'Evaluation Period',
      'Period',
      'Triwulan',
      'evaluationPeriod',
      'evaluation_period',
      'quarterly_period',
    ])
  );

  const lastUpdatedByRaw = normalizeTextField(
    pickField(raw, ['Terakhir Diubah Oleh', 'Diubah Oleh', 'lastUpdatedBy', 'UpdatedBy'])
  );
  const lastUpdatedAtRaw = normalizeTextField(
    pickField(raw, ['Waktu Update', 'Terakhir Diupdate', 'lastUpdatedAt', 'UpdatedAt'])
  );

  const pekppp = parseOptionalNumber(pickField(raw, ['PEKPPP', 'pekppp']));

  const draft: Partial<SatkerData> = {
    no,
    unitKerja,
    satker,
    category,
    year: yearRaw || undefined,
    evaluationPeriod: periodRaw || undefined,
    sheetRowNumber:
      sheetRowNumber ??
      (typeof raw.__rowNumber === 'number' ? raw.__rowNumber : undefined),
    ski: parseRequiredNumber(pickField(raw, ['SKI', 'ski'])),
    spip: parseRequiredNumber(pickField(raw, ['SPIP', 'spip'])),
    mri: parseRequiredNumber(pickField(raw, ['MRI', 'mri'])),
    iepk: parseRequiredNumber(pickField(raw, ['IEPK', 'iepk'])),
    spipt: parseRequiredNumber(pickField(raw, ['SPIPT', 'spipt'])),
    wbkRb: parseRequiredNumber(pickField(raw, ['WBK/RB', 'wbkRb', 'WBK'])),
    sakip: parseRequiredNumber(pickField(raw, ['SAKIP', 'sakip'])),
    nka: parseRequiredNumber(pickField(raw, ['NKA', 'nka'])),
    ikpa: parseRequiredNumber(pickField(raw, ['IKPA', 'ikpa'])),
    ipAsn: parseRequiredNumber(pickField(raw, ['IP-ASN', 'IP ASN', 'ipAsn'])),
    arsip: parseRequiredNumber(pickField(raw, ['ARSIP', 'arsip'])),
    pekppp,
    lastUpdatedBy: lastUpdatedByRaw || undefined,
    lastUpdatedAt: lastUpdatedAtRaw || undefined,
  };

  return recalculateSatkerScores(draft);
}

export function serializeSatkerToSheetRow(
  satker: SatkerData,
  fallbackConfig?: Pick<AppConfiguration, 'evaluationYear' | 'evaluationPeriod'>
): SatkerRow {
  const kodeSatker = Math.trunc(satker.no);
  const yearVal = satker.year || fallbackConfig?.evaluationYear || '';
  const periodVal = satker.evaluationPeriod || fallbackConfig?.evaluationPeriod || '';
  const categoryVal = satker.category === 'Direktorat' ? 'Pusat' : satker.category;

  return {
    KodeSatker: kodeSatker,
    Year: yearVal,
    EvaluationPeriod: periodVal,
    SatkerLongName: satker.unitKerja,
    SatkerShortName: satker.satker,
    No: kodeSatker,
    Tahun: yearVal,
    'Periode Evaluasi': periodVal,
    'Unit Kerja / Satuan Kerja': satker.unitKerja,
    SATKER: satker.satker,
    Kategori: categoryVal,
    SKI: satker.ski,
    SPIP: satker.spip,
    MRI: satker.mri,
    IEPK: satker.iepk,
    SPIPT: satker.spipt,
    'WBK/RB': satker.wbkRb,
    SAKIP: satker.sakip,
    NKA: satker.nka,
    IKPA: satker.ikpa,
    'IP-ASN': satker.ipAsn,
    ARSIP: satker.arsip,
    PEKPPP: satker.pekppp ?? '',
    PSKI: satker.pSki,
    PSPIP: satker.pSpip,
    PMRI: satker.pMri,
    PIEPK: satker.pIepk,
    PWBKRB: satker.pWbkRb,
    PSAKIP: satker.pSakip,
    PNKA: satker.pNka,
    PIKPA: satker.pIkpa,
    PIPASN: satker.pIpAsn,
    PARSIP: satker.pArsip,
    PPEKPPP: satker.pPekppp,
    AVERAGE: satker.average,
    'Terakhir Diubah Oleh': satker.lastUpdatedBy || '',
    'Waktu Update': satker.lastUpdatedAt || '',
  };
}

export function mapSheetRowToUser(
  raw: Record<string, unknown>
): { user: UserProfile; password?: string } | null {
  const username = normalizeTextField(pickField(raw, ['Username', 'username']));
  const email = normalizeTextField(pickField(raw, ['Email', 'email'])).toLowerCase();
  const id = normalizeTextField(pickField(raw, ['ID', 'id']));

  if (!username && !email) {
    return null;
  }

  const name =
    normalizeTextField(pickField(raw, ['Nama Lengkap', 'name', 'Nama'])) ||
    username ||
    email;
  const role = normalizeUserRole(pickField(raw, ['Peran (Role)', 'Peran', 'Role', 'role']));
  const assignedSatkerRaw = normalizeTextField(
    pickField(raw, ['Satker Ditugaskan', 'assignedSatker', 'Satker'])
  );
  const assignedSatkerNoRaw = parseOptionalNumber(
    pickField(raw, ['No Satker', 'assignedSatkerNo', 'No'])
  );

  const initialsRaw = normalizeTextField(pickField(raw, ['Inisial', 'avatarInitials']));
  const avatarInitials =
    initialsRaw ||
    name
      .split(/\s+/)
      .filter((w) => w && !w.includes('.') && !w.includes(','))
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') ||
    'US';

  const lastLoginRaw = normalizeTextField(pickField(raw, ['Login Terakhir', 'lastLogin']));
  const createdAtRaw = normalizeTextField(pickField(raw, ['Dibuat Pada', 'createdAt']));
  const passwordRaw = normalizeTextField(pickField(raw, ['Password', 'password']));

  const user: UserProfile = {
    id: id || `user-${username || email}`,
    username: username || email.split('@')[0],
    email,
    nip: normalizeTextField(pickField(raw, ['NIP', 'nip'])) || '-',
    name,
    role,
    agency:
      normalizeTextField(pickField(raw, ['Instansi', 'agency'])) ||
      'Ditjen P2 Kemenkes RI',
    assignedSatker: assignedSatkerRaw || undefined,
    assignedSatkerNo:
      assignedSatkerNoRaw !== null && assignedSatkerNoRaw > 0
        ? Math.trunc(assignedSatkerNoRaw)
        : undefined,
    avatarInitials,
    status: normalizeUserStatus(pickField(raw, ['Status', 'status'])),
    lastLogin: lastLoginRaw || undefined,
    createdAt: createdAtRaw || new Date().toLocaleString('id-ID'),
  };

  return {
    user,
    password: passwordRaw || undefined,
  };
}

export function serializeUserToSheetAccount(
  user: UserProfile,
  password?: string
): UserAccount {
  return {
    ID: user.id,
    Username: user.username,
    Email: user.email.trim().toLowerCase(),
    NIP: user.nip,
    'Nama Lengkap': user.name,
    'Peran (Role)': user.role,
    Instansi: user.agency,
    'Satker Ditugaskan': user.assignedSatker || '',
    'No Satker': user.assignedSatkerNo ?? '',
    Inisial: user.avatarInitials,
    Status: user.status,
    ...(password ? { Password: password } : {}),
    'Login Terakhir': user.lastLogin || '',
    'Dibuat Pada': user.createdAt || '',
  };
}

function parseBooleanFlag(val: unknown, fallback: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  const text = String(val ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'ya' || text === 'yes' || text === 'terkunci') {
    return true;
  }
  if (text === 'false' || text === '0' || text === 'tidak' || text === 'no' || text === 'terbuka') {
    return false;
  }
  return fallback;
}

function mapRawConfigMapToAppConfig(
  kvMap: Record<string, unknown>,
  meta?: { updatedBy?: string; updatedAt?: string }
): { config: Partial<AppConfiguration>; hasKnownKey: boolean } {
  const parsed: Partial<AppConfiguration> = {};
  let hasKnownKey = false;

  const titleVal = kvMap['app_title'] ?? kvMap['appTitle'];
  if (titleVal !== undefined && String(titleVal).trim()) {
    parsed.appTitle = String(titleVal).trim();
    hasKnownKey = true;
  }

  const evalYearVal = kvMap['evaluation_year'] ?? kvMap['evaluationYear'];
  const evalPeriodVal = kvMap['evaluation_period'] ?? kvMap['evaluationPeriod'];
  const quarterlyPeriodVal = kvMap['quarterly_period'] ?? kvMap['quarterlyPeriod'];

  if (quarterlyPeriodVal !== undefined && String(quarterlyPeriodVal).trim()) {
    parsed.evaluationPeriod = String(quarterlyPeriodVal).trim();
    hasKnownKey = true;
    const yearCandidate = evalYearVal ?? evalPeriodVal;
    if (yearCandidate !== undefined && String(yearCandidate).trim()) {
      parsed.evaluationYear = String(yearCandidate).trim();
    }
  } else {
    if (evalYearVal !== undefined && String(evalYearVal).trim()) {
      parsed.evaluationYear = String(evalYearVal).trim();
      hasKnownKey = true;
    }
    if (evalPeriodVal !== undefined && String(evalPeriodVal).trim()) {
      const text = String(evalPeriodVal).trim();
      if (/^\d{4}$/.test(text) && !parsed.evaluationYear) {
        parsed.evaluationYear = text;
      } else {
        parsed.evaluationPeriod = text;
      }
      hasKnownKey = true;
    }
  }

  const lockVal = kvMap['spreadsheet_edit_locked'] ?? kvMap['spreadsheetEditLocked'];
  if (lockVal !== undefined) {
    parsed.spreadsheetEditLocked = parseBooleanFlag(
      lockVal,
      DEFAULT_APP_CONFIG.spreadsheetEditLocked
    );
    hasKnownKey = true;
  }

  const dataSheetVal = kvMap['data_sheet_name'] ?? kvMap['dataSheetName'];
  if (dataSheetVal !== undefined && String(dataSheetVal).trim()) {
    parsed.dataSheetName = String(dataSheetVal).trim();
  }
  const usersSheetVal = kvMap['users_sheet_name'] ?? kvMap['usersSheetName'];
  if (usersSheetVal !== undefined && String(usersSheetVal).trim()) {
    parsed.usersSheetName = String(usersSheetVal).trim();
  }
  const configSheetVal = kvMap['config_sheet_name'] ?? kvMap['configSheetName'];
  if (configSheetVal !== undefined && String(configSheetVal).trim()) {
    parsed.configSheetName = String(configSheetVal).trim();
  }
  const auditSheetVal = kvMap['audit_sheet_name'] ?? kvMap['auditSheetName'];
  if (auditSheetVal !== undefined && String(auditSheetVal).trim()) {
    parsed.auditSheetName = String(auditSheetVal).trim();
  }
  const commentsSheetVal = kvMap['comments_sheet_name'] ?? kvMap['commentsSheetName'];
  if (commentsSheetVal !== undefined && String(commentsSheetVal).trim()) {
    parsed.commentsSheetName = String(commentsSheetVal).trim();
  }

  if (meta?.updatedBy) parsed.updatedBy = meta.updatedBy;
  if (meta?.updatedAt) parsed.updatedAt = meta.updatedAt;

  return { config: parsed, hasKnownKey };
}

// ============================================================================
// GOOGLE APPS SCRIPT TRANSPORT
// ============================================================================

export async function fetchSatkersFromAppsScript(
  url: string,
  signal?: AbortSignal
): Promise<SatkerData[]> {
  const targetUrl = (url || DEFAULT_APPS_SCRIPT_URL).trim();
  const response = await fetch(targetUrl, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Gagal memuat data Google Apps Script (HTTP ${response.status}).`);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      'Respons Google Apps Script bukan JSON yang valid. Pastikan Web App di-deploy untuk akses publik.'
    );
  }

  const rowsRaw = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
    ? (parsed as { data: unknown[] }).data
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
    ? (parsed as { rows: unknown[] }).rows
    : null;

  if (!rowsRaw) {
    const errMsg =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message?: unknown }).message)
        : 'Format respons Google Apps Script tidak dikenali.';
    throw new Error(errMsg);
  }

  const mapped = rowsRaw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item, idx) => mapSheetRowToSatker(item, idx + 2))
    .filter((item): item is SatkerData => item !== null)
    .sort((a, b) => a.no - b.no);

  if (mapped.length === 0) {
    throw new Error('Data Satker pada endpoint Apps Script kosong atau format kolom tidak sesuai.');
  }

  return mapped;
}

export interface FetchUsersResult {
  users: UserProfile[];
  passwords: Record<string, string>;
  usersSheetSupported: boolean;
}

export async function fetchUsersFromAppsScript(
  url: string,
  signal?: AbortSignal
): Promise<FetchUsersResult> {
  const targetUrl = (url || DEFAULT_APPS_SCRIPT_URL).trim();
  const separator = targetUrl.includes('?') ? '&' : '?';
  const response = await fetch(`${targetUrl}${separator}sheet=Users`, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Gagal memuat tab Users dari Apps Script (HTTP ${response.status}).`);
  }

  const json = (await response.json()) as {
    status?: string;
    data?: unknown[];
    message?: string;
  };

  if (json.status !== 'success' || !Array.isArray(json.data)) {
    throw new Error(json.message || 'Respons tab Users Google Apps Script tidak valid.');
  }

  const rawItems = json.data.filter(
    (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')
  );

  const looksLikeDataSheet =
    rawItems.length > 0 &&
    !('Username' in rawItems[0]) &&
    !('Email' in rawItems[0]) &&
    ('SATKER' in rawItems[0] || 'SatkerShortName' in rawItems[0] || 'SKI' in rawItems[0]);

  if (looksLikeDataSheet) {
    return {
      users: [],
      passwords: {},
      usersSheetSupported: false,
    };
  }

  const users: UserProfile[] = [];
  const passwords: Record<string, string> = {};

  for (const row of rawItems) {
    const mapped = mapSheetRowToUser(row);
    if (!mapped) continue;
    users.push(mapped.user);
    if (mapped.password && mapped.user.email) {
      passwords[mapped.user.email.trim().toLowerCase()] = mapped.password;
    }
  }

  return {
    users,
    passwords,
    usersSheetSupported: true,
  };
}

export interface AppsScriptWriteResult {
  ok: boolean;
  doPostMissing?: boolean;
  unsupportedAction?: boolean;
  message?: string;
}

async function postToAppsScript(
  url: string,
  payload: Record<string, unknown>
): Promise<AppsScriptWriteResult> {
  const targetUrl = (url || DEFAULT_APPS_SCRIPT_URL).trim();
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `Gagal menulis ke endpoint Apps Script (HTTP ${response.status}).`,
      };
    }

    const text = await response.text();

    if (
      text.includes('Script function not found: doPost') ||
      text.includes('Fungsi skrip tidak ditemukan: doPost')
    ) {
      return {
        ok: false,
        doPostMissing: true,
        message:
          'Google Apps Script belum memiliki fungsi doPost(e) untuk menyimpan pembaruan. Perubahan tetap tersimpan di sesi lokal.',
      };
    }

    try {
      const result = JSON.parse(text) as { status?: string; message?: string; error?: string };
      if (result.status !== 'success') {
        const msg = result.message || result.error || 'Google Apps Script menolak pembaruan data.';
        return {
          ok: false,
          unsupportedAction: msg.toLowerCase().includes('unknown action'),
          message: msg,
        };
      }
      return { ok: true };
    } catch {
      if (text.toLowerCase().includes('error') || text.trim().startsWith('<')) {
        return {
          ok: false,
          doPostMissing: text.toLowerCase().includes('dopost'),
          message: 'Respons tulis Google Apps Script tidak berbentuk JSON sukses.',
        };
      }
      return { ok: true };
    }
  } catch {
    return {
      ok: false,
      message:
        'Tidak dapat menghubungi endpoint Google Apps Script. Periksa koneksi jaringan atau izin deploy Web App.',
    };
  }
}

export async function handleSaveSatker(
  editedRow: SatkerRow,
  currentUser: string,
  url?: string,
  role?: string
): Promise<void> {
  const targetUrl = (url || DEFAULT_APPS_SCRIPT_URL).trim();
  const payload = {
    action: 'update',
    no: editedRow.KodeSatker,
    kodeSatker: editedRow.KodeSatker,
    year: editedRow.Year,
    evaluationPeriod: editedRow.EvaluationPeriod,
    satker: editedRow.SatkerShortName,
    ...(role ? { role } : {}),
    row: {
      ...editedRow,
      'Terakhir Diubah Oleh': currentUser,
      'Waktu Update': editedRow['Waktu Update'] || new Date().toLocaleString('id-ID'),
    },
  };

  const response = await fetch(targetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Gagal menulis ke Google Apps Script (HTTP ${response.status}).`);
  }

  const text = await response.text();
  if (
    text.includes('Script function not found: doPost') ||
    text.includes('Fungsi skrip tidak ditemukan: doPost')
  ) {
    throw new Error('Fungsi doPost(e) tidak ditemukan pada Google Apps Script.');
  }

  const result = JSON.parse(text) as { status?: string; message?: string };
  if (result.status !== 'success') {
    throw new Error(result.message || 'Gagal memperbarui data Satker melalui Google Apps Script.');
  }
}

export async function pushSatkerUpdateToAppsScript(
  url: string,
  satker: SatkerData,
  updatedBy: string,
  role?: string,
  config?: AppConfiguration
): Promise<AppsScriptWriteResult> {
  const editedRow = serializeSatkerToSheetRow(satker, config);
  try {
    await handleSaveSatker(editedRow, updatedBy, url, role);
    return { ok: true };
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Tidak dapat menghubungi endpoint Google Apps Script.';
    return {
      ok: false,
      doPostMissing: msg.toLowerCase().includes('dopost'),
      message: msg,
    };
  }
}

export async function pushBulkSatkersToAppsScript(
  url: string,
  satkers: SatkerData[],
  updatedBy: string,
  role?: string,
  config?: AppConfiguration
): Promise<AppsScriptWriteResult> {
  const rows = satkers.map((s) => serializeSatkerToSheetRow(s, config));
  return postToAppsScript(url, {
    action: 'bulkUpdate',
    ...(role ? { role } : {}),
    data: rows,
    rows,
    updatedBy,
    updatedAt: new Date().toISOString(),
  });
}

export async function handleUpdateUserInAppsScript(
  url: string,
  editedUser: UserAccount
): Promise<AppsScriptWriteResult> {
  return postToAppsScript(url, {
    sheet: 'Users',
    action: 'updateUser',
    id: editedUser.ID,
    user: editedUser,
  });
}

export async function handleCreateUserInAppsScript(
  url: string,
  newUser: Partial<UserAccount>
): Promise<AppsScriptWriteResult> {
  return postToAppsScript(url, {
    sheet: 'Users',
    action: 'createUser',
    user: newUser,
  });
}

export async function handleDeleteUserInAppsScript(
  url: string,
  userId: string
): Promise<AppsScriptWriteResult> {
  return postToAppsScript(url, {
    sheet: 'Users',
    action: 'deleteUser',
    id: userId,
  });
}

export async function recordUserLoginInAppsScript(
  url: string,
  userId: string
): Promise<void> {
  try {
    await postToAppsScript(url, {
      sheet: 'Users',
      action: 'updateLogin',
      id: userId,
    });
  } catch {
    // Non-blocking audit update
  }
}

export async function syncUsersToAppsScript(
  url: string,
  usersList: UserAccount[]
): Promise<AppsScriptWriteResult> {
  return postToAppsScript(url, {
    sheet: 'Users',
    action: 'syncUsers',
    users: usersList,
  });
}

export interface FetchConfigResult {
  config: Partial<AppConfiguration> | null;
  configSheetSupported: boolean;
  isEmpty: boolean;
}

export async function fetchConfigFromAppsScript(
  url: string,
  signal?: AbortSignal
): Promise<FetchConfigResult> {
  const targetUrl = (url || DEFAULT_APPS_SCRIPT_URL).trim();
  const separator = targetUrl.includes('?') ? '&' : '?';
  const response = await fetch(`${targetUrl}${separator}sheet=Configuration`, {
    method: 'GET',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Gagal memuat tab Configuration dari Apps Script (HTTP ${response.status}).`);
  }

  const json = (await response.json()) as {
    status?: string;
    data?: unknown[];
    config?: Record<string, unknown>;
    message?: string;
  };

  if (json.status !== 'success') {
    throw new Error(json.message || 'Respons tab Configuration Google Apps Script tidak valid.');
  }

  const rawItems = Array.isArray(json.data)
    ? json.data.filter(
        (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')
      )
    : [];

  const kvMap: Record<string, unknown> = {};
  let latestUpdatedBy = '';
  let latestUpdatedAt = '';

  if (rawItems.length > 0 && ('Key' in rawItems[0] || 'key' in rawItems[0])) {
    for (const row of rawItems) {
      const key = String(row['Key'] ?? row['key'] ?? '').trim();
      if (!key) continue;
      kvMap[key] = row['Value'] ?? row['value'];

      if (
        key === 'app_title' ||
        key === 'evaluation_year' ||
        key === 'evaluation_period' ||
        key === 'quarterly_period' ||
        key === 'spreadsheet_edit_locked'
      ) {
        const uBy = String(row['UpdatedBy'] ?? row['Updated By'] ?? row['updatedBy'] ?? '').trim();
        const uAt = String(row['UpdatedAt'] ?? row['Updated At'] ?? row['updatedAt'] ?? '').trim();
        if (uBy) latestUpdatedBy = uBy;
        if (uAt) latestUpdatedAt = uAt;
      }
    }
  }

  if (json.config && typeof json.config === 'object') {
    for (const [k, v] of Object.entries(json.config)) {
      kvMap[k] = v;
    }
  }

  const hasConfigObject = Boolean(json.config && typeof json.config === 'object');

  if (!hasConfigObject && rawItems.length > 0) {
    const first = rawItems[0];
    const looksLikeOtherSheet =
      ('SATKER' in first || 'SatkerShortName' in first || 'SKI' in first || 'Username' in first) &&
      !('Key' in first) &&
      !('key' in first);
    if (looksLikeOtherSheet) {
      return {
        config: null,
        configSheetSupported: false,
        isEmpty: false,
      };
    }
  }

  if (Object.keys(kvMap).length === 0) {
    return {
      config: null,
      configSheetSupported: hasConfigObject,
      isEmpty: true,
    };
  }

  const mapped = mapRawConfigMapToAppConfig(kvMap, {
    updatedBy: latestUpdatedBy || undefined,
    updatedAt: latestUpdatedAt || undefined,
  });

  return {
    config: mapped.hasKnownKey ? mapped.config : null,
    configSheetSupported: hasConfigObject || mapped.hasKnownKey,
    isEmpty: !mapped.hasKnownKey,
  };
}

export async function saveConfigToAppsScript(
  url: string,
  config: AppConfiguration
): Promise<AppsScriptWriteResult> {
  return postToAppsScript(url, {
    sheet: 'Configuration',
    action: 'updateConfig',
    updatedBy: config.updatedBy || 'Admin',
    updates: {
      app_title: config.appTitle,
      evaluation_year: config.evaluationYear || DEFAULT_APP_CONFIG.evaluationYear,
      evaluation_period: config.evaluationYear || DEFAULT_APP_CONFIG.evaluationYear,
      quarterly_period: config.evaluationPeriod || DEFAULT_APP_CONFIG.evaluationPeriod,
      spreadsheet_edit_locked: Boolean(config.spreadsheetEditLocked),
    },
  });
}

export const APPS_SCRIPT_DO_POST_TEMPLATE = `const CONFIG_SHEET_NAME = 'Configuration';
const DATA_SHEET_NAME = 'Data';
const USERS_SHEET_NAME = 'Users';

const DEFAULT_CONFIG = {
  app_title: 'MonGRC Ditjen P2',
  evaluation_year: '2026',
  evaluation_period: '2026',
  quarterly_period: 'Triwulan IV',
  spreadsheet_edit_locked: true,
  data_sheet_name: DATA_SHEET_NAME,
  users_sheet_name: USERS_SHEET_NAME,
  config_sheet_name: CONFIG_SHEET_NAME,
  audit_sheet_name: 'Audit_Logs',
  comments_sheet_name: 'Comments'
};

const USER_HEADERS = [
  'ID', 'Username', 'Email', 'NIP', 'Nama Lengkap', 'Peran (Role)',
  'Instansi', 'Satker Ditugaskan', 'No Satker', 'Inisial',
  'Status', 'Password', 'Login Terakhir', 'Dibuat Pada'
];

function getAppConfig(ss) {
  const config = Object.assign({}, DEFAULT_CONFIG);
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!configSheet) return config;

  const values = configSheet.getDataRange().getValues();
  if (values.length < 2) return config;

  const headers = values[0];
  const keyColIdx = headers.indexOf('Key');
  const valColIdx = headers.indexOf('Value');
  if (keyColIdx === -1 || valColIdx === -1) return config;

  for (let i = 1; i < values.length; i++) {
    const key = String(values[i][keyColIdx]).trim();
    const rawVal = values[i][valColIdx];
    if (!key) continue;

    if (key === 'spreadsheet_edit_locked') {
      config[key] = rawVal === true || String(rawVal).trim().toUpperCase() === 'TRUE';
    } else {
      config[key] = String(rawVal).trim();
    }
  }
  return config;
}

function ensureUsersSheet(ss, usersSheetName) {
  const sheetName = usersSheetName || USERS_SHEET_NAME;
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findHeaderIndex(headers, aliases) {
  const normAliases = aliases.map((a) => a.toLowerCase());
  return headers.findIndex((h) => normAliases.indexOf(String(h).trim().toLowerCase()) !== -1);
}

function matchesSatkerPeriodRow(row, headers, targetNo, targetYear, targetPeriod) {
  const noColIdx = findHeaderIndex(headers, ['KodeSatker', 'No', 'Nomor']);
  if (noColIdx === -1 || Number(row[noColIdx]) !== Number(targetNo)) return false;
  const yearIdx = findHeaderIndex(headers, ['Year', 'Tahun', 'Tahun Evaluasi']);
  const periodIdx = findHeaderIndex(headers, ['EvaluationPeriod', 'Periode Evaluasi', 'Periode', 'Triwulan', 'Evaluation Period']);
  const rowYear = yearIdx !== -1 ? String(row[yearIdx] || '').trim() : '';
  const rowPeriod = periodIdx !== -1 ? String(row[periodIdx] || '').trim().toLowerCase() : '';
  const wantYear = String(targetYear || '').trim();
  const wantPeriod = String(targetPeriod || '').trim().toLowerCase();
  const yearOk = !rowYear || !wantYear || rowYear === wantYear;
  const periodOk = !rowPeriod || !wantPeriod || rowPeriod === wantPeriod;
  return yearOk && periodOk;
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const config = getAppConfig(ss);
    const paramSheet = (e && e.parameter && e.parameter.sheet) ? e.parameter.sheet : '';

    if (paramSheet === config.config_sheet_name && e.parameter.format === 'object') {
      return jsonResponse({ status: 'success', config: config });
    }

    const targetSheetName = paramSheet || config.data_sheet_name;
    const sheet = targetSheetName === config.users_sheet_name
      ? ensureUsersSheet(ss, config.users_sheet_name)
      : (ss.getSheetByName(targetSheetName) || ss.getSheets()[0]);

    if (!sheet) {
      return jsonResponse({ status: 'success', data: [], config: config });
    }
    const values = sheet.getDataRange().getValues();
    if (values.length < 2) {
      return jsonResponse({ status: 'success', data: [], config: config });
    }
    const headers = values[0];
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const rowObj = {};
      for (let j = 0; j < headers.length; j++) {
        rowObj[headers[j]] = values[i][j];
      }
      rows.push(rowObj);
    }
    return jsonResponse({ status: 'success', data: rows, config: config });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const config = getAppConfig(ss);
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || 'update';

    if (action === 'updateConfig' || payload.sheet === config.config_sheet_name) {
      const configSheet = ss.getSheetByName(config.config_sheet_name);
      if (!configSheet) {
        return jsonResponse({ status: 'error', message: 'Sheet Configuration tidak ditemukan' });
      }
      const cfgValues = configSheet.getDataRange().getValues();
      const cfgHeaders = cfgValues[0];
      const keyIdx = cfgHeaders.indexOf('Key');
      const valIdx = cfgHeaders.indexOf('Value');
      const updatedAtIdx = cfgHeaders.indexOf('UpdatedAt');
      const updatedByIdx = cfgHeaders.indexOf('UpdatedBy');

      const updates = payload.updates || (payload.key ? { [payload.key]: payload.value } : {});
      const updater = payload.updatedBy || 'System';
      const nowWIB = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd/MM/yyyy, HH.mm.ss');

      for (let i = 1; i < cfgValues.length; i++) {
        const rowKey = String(cfgValues[i][keyIdx]).trim();
        if (Object.prototype.hasOwnProperty.call(updates, rowKey)) {
          cfgValues[i][valIdx] = updates[rowKey];
          if (updatedAtIdx !== -1) cfgValues[i][updatedAtIdx] = nowWIB;
          if (updatedByIdx !== -1) cfgValues[i][updatedByIdx] = updater;
        }
      }
      configSheet.getRange(1, 1, cfgValues.length, cfgHeaders.length).setValues(cfgValues);
      return jsonResponse({ status: 'success', config: getAppConfig(ss) });
    }

    const isUserAction = ['updateUser', 'createUser', 'deleteUser', 'updateLogin', 'syncUsers'].indexOf(action) !== -1;
    const sheetName = payload.sheet || (isUserAction ? config.users_sheet_name : config.data_sheet_name);

    if (
      sheetName === config.data_sheet_name &&
      config.spreadsheet_edit_locked === true &&
      payload.role !== 'Admin' &&
      !payload.bypassLock
    ) {
      return jsonResponse({
        status: 'error',
        message: 'Pengeditan data Satker sedang dikunci oleh Admin (spreadsheet_edit_locked = TRUE).'
      });
    }

    const sheet = sheetName === config.users_sheet_name
      ? ensureUsersSheet(ss, config.users_sheet_name)
      : (ss.getSheetByName(sheetName) || ss.getSheets()[0]);

    const values = sheet.getDataRange().getValues();
    const headers = values[0];

    const mapObjectToRow = (obj, existingRow) => {
      return headers.map((header, colIdx) => {
        if (Object.prototype.hasOwnProperty.call(obj, header)) {
          if (header === 'Password' && !obj[header] && existingRow) {
            return existingRow[colIdx];
          }
          return obj[header];
        }
        return existingRow ? existingRow[colIdx] : '';
      });
    };

    if (action === 'update') {
      const record = payload.row || payload.data || payload;
      const targetNo = Number(payload.kodeSatker || payload.no || record.KodeSatker || record.No);
      const targetYear = payload.year || record.Year || record.Tahun || '';
      const targetPeriod = payload.evaluationPeriod || record.EvaluationPeriod || record['Periode Evaluasi'] || '';
      for (let i = 1; i < values.length; i++) {
        if (matchesSatkerPeriodRow(values[i], headers, targetNo, targetYear, targetPeriod)) {
          sheet.getRange(i + 1, 1, 1, headers.length).setValues([mapObjectToRow(record, values[i])]);
          return jsonResponse({ status: 'success', updatedRow: i + 1 });
        }
      }
      sheet.appendRow(mapObjectToRow(record, null));
      return jsonResponse({ status: 'success', appended: true });
    }

    if (action === 'bulkUpdate') {
      const records = payload.data || payload.rows || [];
      records.forEach((record) => {
        let found = false;
        const recNo = record.KodeSatker || record.No;
        const recYear = record.Year || record.Tahun;
        const recPeriod = record.EvaluationPeriod || record['Periode Evaluasi'];
        for (let i = 1; i < values.length; i++) {
          if (matchesSatkerPeriodRow(values[i], headers, recNo, recYear, recPeriod)) {
            values[i] = mapObjectToRow(record, values[i]);
            found = true;
            break;
          }
        }
        if (!found) {
          values.push(mapObjectToRow(record, null));
        }
      });
      sheet.getRange(1, 1, values.length, headers.length).setValues(values);
      return jsonResponse({ status: 'success', message: 'Bulk update completed' });
    }

    const idColIdx = headers.indexOf('ID');
    if (action === 'updateUser') {
      const targetId = String(payload.id || (payload.user && payload.user.ID) || '').trim();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idColIdx]).trim() === targetId) {
          sheet.getRange(i + 1, 1, 1, headers.length).setValues([mapObjectToRow(payload.user, values[i])]);
          return jsonResponse({ status: 'success', updatedRow: i + 1 });
        }
      }
      return jsonResponse({ status: 'error', message: 'User tidak ditemukan: ' + targetId });
    }

    if (action === 'createUser') {
      const newUser = payload.user || {};
      if (!newUser['Dibuat Pada']) {
        newUser['Dibuat Pada'] = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
      }
      sheet.appendRow(mapObjectToRow(newUser, null));
      return jsonResponse({ status: 'success', message: 'User ditambahkan' });
    }

    if (action === 'deleteUser') {
      const targetId = String(payload.id || '').trim();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idColIdx]).trim() === targetId) {
          sheet.deleteRow(i + 1);
          return jsonResponse({ status: 'success', deletedRow: i + 1 });
        }
      }
      return jsonResponse({ status: 'error', message: 'User tidak ditemukan: ' + targetId });
    }

    if (action === 'updateLogin') {
      const targetId = String(payload.id || '').trim();
      const loginColIdx = headers.indexOf('Login Terakhir');
      const nowWIB = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm');
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idColIdx]).trim() === targetId && loginColIdx !== -1) {
          sheet.getRange(i + 1, loginColIdx + 1).setValue(nowWIB);
          return jsonResponse({ status: 'success', loginTerakhir: nowWIB });
        }
      }
      return jsonResponse({ status: 'success' });
    }

    if (action === 'syncUsers' && Array.isArray(payload.users)) {
      const existingMap = {};
      for (let i = 1; i < values.length; i++) {
        existingMap[String(values[i][idColIdx]).trim()] = i;
      }
      payload.users.forEach((u) => {
        const idx = existingMap[String(u.ID).trim()];
        if (idx !== undefined) {
          values[idx] = mapObjectToRow(u, values[idx]);
        } else {
          values.push(mapObjectToRow(u, null));
        }
      });
      sheet.getRange(1, 1, values.length, headers.length).setValues(values);
      return jsonResponse({ status: 'success', total: payload.users.length });
    }

    return jsonResponse({ status: 'error', message: 'Unknown action: ' + action });
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;
