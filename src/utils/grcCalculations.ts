import { INDICATOR_METAS } from '../data/baselineData';
import {
  AppConfiguration,
  IndicatorMeta,
  SatkerCategory,
  SatkerData,
  SummaryThresholdResult,
  UserProfile,
} from '../types/mongrc';

export const NORMALIZED_INDICATOR_METAS: IndicatorMeta[] = INDICATOR_METAS.filter(
  (m) => m.pKey !== null
);

export const INDICATOR_META_BY_KEY: ReadonlyMap<string, IndicatorMeta> = new Map(
  INDICATOR_METAS.map((m) => [m.key, m])
);

const PERIOD_SORT_PRIORITY = new Map<string, number>([
  ['triwulan i', 1],
  ['triwulan 1', 1],
  ['q1', 1],
  ['triwulan ii', 2],
  ['triwulan 2', 2],
  ['q2', 2],
  ['triwulan iii', 3],
  ['triwulan 3', 3],
  ['q3', 3],
  ['triwulan iv', 4],
  ['triwulan 4', 4],
  ['q4', 4],
  ['semester i', 5],
  ['semester 1', 5],
  ['semester ii', 6],
  ['semester 2', 6],
  ['tahunan', 7],
]);

export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function getDimensionMaxScore(meta: Pick<IndicatorMeta, 'scale'>): number {
  return meta.scale === '5-scale' ? 5 : 100;
}

export function calculateNormalizedPercentage(
  meta: Pick<IndicatorMeta, 'scale'>,
  rawValue: number | null | undefined
): number {
  if (rawValue === null || rawValue === undefined || Number.isNaN(rawValue)) return 0;
  const maxScore = getDimensionMaxScore(meta);
  return round2((rawValue / maxScore) * 100);
}

/**
 * Recalculate normalized P-scores and composite AVERAGE dynamically from INDICATOR_METAS.
 */
export function recalculateSatkerScores(satker: Partial<SatkerData>): SatkerData {
  const normalizedScores: Partial<Record<NonNullable<IndicatorMeta['pKey']>, number>> = {};
  let pSum = 0;
  const divisor = NORMALIZED_INDICATOR_METAS.length || 1;

  for (let i = 0; i < NORMALIZED_INDICATOR_METAS.length; i++) {
    const meta = NORMALIZED_INDICATOR_METAS[i];
    const rawVal = satker[meta.key] as number | null | undefined;
    const pScore =
      rawVal !== null && rawVal !== undefined && !Number.isNaN(rawVal)
        ? calculateNormalizedPercentage(meta, rawVal)
        : 0;
    if (meta.pKey) {
      normalizedScores[meta.pKey] = pScore;
      pSum += pScore;
    }
  }

  const average = round2(pSum / divisor);

  return {
    no: satker.no ?? 1,
    unitKerja: satker.unitKerja ?? 'Satker Baru',
    satker: satker.satker ?? 'Satker',
    category: satker.category ?? 'Balai Kelas I',
    year: satker.year,
    evaluationPeriod: satker.evaluationPeriod,
    sheetRowNumber: satker.sheetRowNumber,
    ski: satker.ski ?? 0,
    spip: satker.spip ?? 0,
    mri: satker.mri ?? 0,
    iepk: satker.iepk ?? 0,
    spipt: satker.spipt ?? 0,
    wbkRb: satker.wbkRb ?? 0,
    sakip: satker.sakip ?? 0,
    nka: satker.nka ?? 0,
    ikpa: satker.ikpa ?? 0,
    ipAsn: satker.ipAsn ?? 0,
    arsip: satker.arsip ?? 0,
    pekppp: satker.pekppp ?? null,
    pSki: normalizedScores.pSki ?? 0,
    pSpip: normalizedScores.pSpip ?? 0,
    pMri: normalizedScores.pMri ?? 0,
    pIepk: normalizedScores.pIepk ?? 0,
    pWbkRb: normalizedScores.pWbkRb ?? 0,
    pSakip: normalizedScores.pSakip ?? 0,
    pNka: normalizedScores.pNka ?? 0,
    pIkpa: normalizedScores.pIkpa ?? 0,
    pIpAsn: normalizedScores.pIpAsn ?? 0,
    pArsip: normalizedScores.pArsip ?? 0,
    pPekppp: normalizedScores.pPekppp ?? 0,
    average,
    notes: satker.notes,
    lastUpdatedBy: satker.lastUpdatedBy,
    lastUpdatedAt: satker.lastUpdatedAt,
  };
}

export function formatNumber(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '-';
  return val.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function isIndicatorTercapai(
  indicator: IndicatorMeta,
  value: number | null | undefined
): boolean {
  if (value === null || value === undefined) return false;
  return value >= indicator.threshold;
}

export function normalizeCategoryLabel(raw: unknown): SatkerCategory {
  const text = String(raw || '').trim().toLowerCase();
  if (text === 'balai besar') return 'Balai Besar';
  if (text === 'balai kelas i') return 'Balai Kelas I';
  if (text === 'balai kelas ii') return 'Balai Kelas II';
  if (text === 'loka') return 'Loka';
  if (text === 'pusat' || text === 'direktorat') return 'Pusat';
  if (text.startsWith('balai besar')) return 'Balai Besar';
  if (text.includes('kelas i') && !text.includes('kelas ii')) return 'Balai Kelas I';
  if (text.includes('kelas ii')) return 'Balai Kelas II';
  if (text.startsWith('loka')) return 'Loka';
  if (text.startsWith('direktorat') || text.startsWith('sekretariat')) return 'Pusat';
  return 'Balai Kelas I';
}

export function computeCategoryOptions(
  satkers: SatkerData[],
  allPrefix = 'Semua'
): Array<{ key: string; label: string; count: number }> {
  const counts: Record<string, number> = {
    'Balai Besar': 0,
    'Balai Kelas I': 0,
    'Balai Kelas II': 0,
    Loka: 0,
    Pusat: 0,
  };

  for (let i = 0; i < satkers.length; i++) {
    const cat = satkers[i].category === 'Direktorat' ? 'Pusat' : satkers[i].category;
    counts[cat] = (counts[cat] || 0) + 1;
  }

  return [
    { key: 'ALL', label: `${allPrefix} (${satkers.length})`, count: satkers.length },
    ...Object.entries(counts).map(([key, count]) => ({
      key,
      label: `${key} (${count})`,
      count,
    })),
  ];
}

export function filterSatkers(
  satkers: SatkerData[],
  selectedCategory: string,
  searchQuery: string
): SatkerData[] {
  const q = searchQuery.trim().toLowerCase();
  return satkers.filter((s) => {
    const matchCat =
      selectedCategory === 'ALL' ||
      s.category === selectedCategory ||
      (selectedCategory === 'Pusat' && (s.category === 'Pusat' || s.category === 'Direktorat'));
    const matchSearch =
      !q ||
      s.satker.toLowerCase().includes(q) ||
      s.unitKerja.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });
}

export function normalizeTextToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function compareEvaluationPeriods(a: string, b: string): number {
  const pa = PERIOD_SORT_PRIORITY.get(normalizeTextToken(a));
  const pb = PERIOD_SORT_PRIORITY.get(normalizeTextToken(b));
  if (pa !== undefined && pb !== undefined) return pa - pb;
  if (pa !== undefined) return -1;
  if (pb !== undefined) return 1;
  return a.localeCompare(b, 'id');
}

export function extractAvailableYearsAndPeriods(
  allSatkers: SatkerData[],
  config?: Pick<AppConfiguration, 'evaluationYear' | 'evaluationPeriod'>
): {
  years: string[];
  periods: string[];
  periodsByYear: Record<string, string[]>;
} {
  const yearSet = new Set<string>();
  const periodSet = new Set<string>();
  const periodsByYearMap = new Map<string, Set<string>>();

  const fallbackYear = config?.evaluationYear?.trim();
  const fallbackPeriod = config?.evaluationPeriod?.trim();

  for (let i = 0; i < allSatkers.length; i++) {
    const row = allSatkers[i];
    const yr = row.year?.trim() || fallbackYear;
    const pd = row.evaluationPeriod?.trim() || fallbackPeriod;
    if (yr) yearSet.add(yr);
    if (pd) periodSet.add(pd);
    if (yr && pd) {
      let set = periodsByYearMap.get(yr);
      if (!set) {
        set = new Set<string>();
        periodsByYearMap.set(yr, set);
      }
      set.add(pd);
    }
  }

  if (fallbackYear) yearSet.add(fallbackYear);
  if (fallbackPeriod) periodSet.add(fallbackPeriod);

  const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const periods = Array.from(periodSet).sort(compareEvaluationPeriods);
  const periodsByYear: Record<string, string[]> = {};
  for (const [yr, set] of periodsByYearMap.entries()) {
    periodsByYear[yr] = Array.from(set).sort(compareEvaluationPeriods);
  }

  return { years, periods, periodsByYear };
}

export function filterSatkersByPeriod(
  allSatkers: SatkerData[],
  year: string,
  period: string,
  fallbackYear?: string,
  fallbackPeriod?: string
): SatkerData[] {
  const targetYear = normalizeTextToken(year);
  const targetPeriod = normalizeTextToken(period);

  const matched = allSatkers.filter((s) => {
    const rowYear = normalizeTextToken(s.year || fallbackYear || year);
    const rowPeriod = normalizeTextToken(s.evaluationPeriod || fallbackPeriod || period);
    const yearMatches = !targetYear || !rowYear || rowYear === targetYear;
    const periodMatches = !targetPeriod || !rowPeriod || rowPeriod === targetPeriod;
    return yearMatches && periodMatches;
  });

  // Deduplicate by satker.no within the selected period, keeping the latest/last row
  const byNo = new Map<number, SatkerData>();
  for (let i = 0; i < matched.length; i++) {
    byNo.set(matched[i].no, matched[i]);
  }
  return Array.from(byNo.values()).sort((a, b) => a.no - b.no);
}

/**
 * Check whether a user has organizational unit edit permission for a specific Satker.
 */
export function canUserEditSatker(user: UserProfile | null, satker: SatkerData): boolean {
  if (!user || user.status === 'inactive' || user.role === 'Viewer' || user.role === 'Auditor') {
    return false;
  }
  if (user.role === 'Admin') return true;
  if (user.role === 'Satker PIC') {
    if (user.assignedSatkerNo !== undefined && user.assignedSatkerNo === satker.no) {
      return true;
    }
    const assigned = normalizeTextToken(user.assignedSatker);
    if (assigned) {
      return (
        assigned === normalizeTextToken(satker.satker) ||
        assigned === normalizeTextToken(satker.unitKerja)
      );
    }
    const agency = normalizeTextToken(user.agency);
    if (agency) {
      return (
        agency === normalizeTextToken(satker.unitKerja) ||
        agency === normalizeTextToken(satker.satker)
      );
    }
  }
  return false;
}

/**
 * Single-pass calculation of dynamic summary statistics (TERCAPAI, TIDAK TERCAPAI, Averages).
 */
export function calculateSummaryStats(satkers: SatkerData[]) {
  const count = satkers.length;
  if (count === 0) {
    return {
      nationalAverage: 0,
      tercapaiSummary: [] as SummaryThresholdResult[],
      rawAverages: {} as Record<string, number>,
      pAverages: {} as Record<string, number>,
    };
  }

  const metricCount = INDICATOR_METAS.length;
  const rawSums = new Float64Array(metricCount);
  const validCounts = new Uint32Array(metricCount);
  const pSums = new Float64Array(metricCount);
  const tercapaiCounts = new Uint32Array(metricCount);
  const tidakTercapaiCounts = new Uint32Array(metricCount);
  let totalAvgSum = 0;

  for (let sIdx = 0; sIdx < count; sIdx++) {
    const s = satkers[sIdx];
    totalAvgSum += s.average;

    for (let mIdx = 0; mIdx < metricCount; mIdx++) {
      const meta = INDICATOR_METAS[mIdx];
      const v = s[meta.key];
      if (typeof v === 'number' && !Number.isNaN(v)) {
        rawSums[mIdx] += v;
        validCounts[mIdx] += 1;
        if (v >= meta.threshold) {
          tercapaiCounts[mIdx] += 1;
        } else {
          tidakTercapaiCounts[mIdx] += 1;
        }
        if (meta.pKey) {
          pSums[mIdx] += calculateNormalizedPercentage(meta, v);
        }
      }
    }
  }

  const rawAverages: Record<string, number> = {};
  const pAverages: Record<string, number> = {};
  const tercapaiSummary: SummaryThresholdResult[] = new Array(metricCount);

  for (let mIdx = 0; mIdx < metricCount; mIdx++) {
    const meta = INDICATOR_METAS[mIdx];
    const valid = validCounts[mIdx];
    const tercapai = tercapaiCounts[mIdx];
    const tidakTercapai = tidakTercapaiCounts[mIdx];

    rawAverages[meta.key] = valid > 0 ? round2(rawSums[mIdx] / valid) : 0;
    if (meta.pKey) {
      pAverages[meta.pKey] = round2(pSums[mIdx] / count);
    }

    tercapaiSummary[mIdx] = {
      indicatorKey: meta.key,
      label: meta.label,
      threshold: meta.threshold,
      tercapaiCount: tercapai,
      tidakTercapaiCount: tidakTercapai,
      totalEvaluated: valid,
      achievementRate: valid > 0 ? round2((tercapai / valid) * 100) : 0,
    };
  }

  return {
    nationalAverage: round2(totalAvgSum / count),
    tercapaiSummary,
    rawAverages,
    pAverages,
  };
}

/**
 * Generate CSV string compliant with the MonGRC format (including Year & Evaluation Period).
 */
export function exportSatkersToCSV(
  satkers: SatkerData[],
  contextMeta?: { year?: string; evaluationPeriod?: string }
): string {
  const headers = [
    'No',
    'Tahun',
    'Periode Evaluasi',
    'Unit Kerja / Satuan Kerja',
    'SATKER',
    'Kategori',
    ...INDICATOR_METAS.map((m) => m.label),
    ...NORMALIZED_INDICATOR_METAS.map((m) => `P${m.label.replace('/', '')}`),
    'AVERAGE',
  ];

  const escapeCSV = (val: string | number | null | undefined): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') {
      return `"${formatNumber(val, 2)}"`;
    }
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = satkers.map((s) =>
    [
      s.no,
      escapeCSV(s.year || contextMeta?.year || ''),
      escapeCSV(s.evaluationPeriod || contextMeta?.evaluationPeriod || ''),
      escapeCSV(s.unitKerja),
      escapeCSV(s.satker),
      escapeCSV(s.category),
      ...INDICATOR_METAS.map((m) => escapeCSV(s[m.key] as number | null)),
      ...NORMALIZED_INDICATOR_METAS.map((m) => escapeCSV(s[m.pKey!] as number)),
      escapeCSV(s.average),
    ].join(',')
  );

  const summary = calculateSummaryStats(satkers);
  const pCount = NORMALIZED_INDICATOR_METAS.length;

  const avgRow = [
    '',
    '',
    '',
    '"Rata-Rata Satker"',
    'RATA-RATA',
    '',
    ...INDICATOR_METAS.map((m) => escapeCSV(summary.rawAverages[m.key])),
    ...NORMALIZED_INDICATOR_METAS.map((m) => escapeCSV(summary.pAverages[m.pKey!])),
    escapeCSV(summary.nationalAverage),
  ].join(',');

  const tercapaiHeader = [
    '',
    '',
    '',
    '',
    '',
    '',
    ...INDICATOR_METAS.map((m) => m.label),
    ...Array(pCount + 1).fill(''),
  ].join(',');

  const tercapaiCounts = [
    '',
    '',
    '',
    '',
    'TERCAPAI',
    '',
    ...summary.tercapaiSummary.map((t) => t.tercapaiCount),
    ...Array(pCount + 1).fill(''),
  ].join(',');

  const tidakTercapaiCounts = [
    '',
    '',
    '',
    '',
    'TIDAK TERCAPAI',
    '',
    ...summary.tercapaiSummary.map((t) => t.tidakTercapaiCount),
    ...Array(pCount + 1).fill(''),
  ].join(',');

  return [
    headers.join(','),
    ...rows,
    avgRow,
    Array(headers.length - 1).fill('').join(','),
    tercapaiHeader,
    tercapaiCounts,
    tidakTercapaiCounts,
  ].join('\n');
}

/**
 * Parse an uploaded CSV text into SatkerData records using dynamic header detection
 * (with positional fallback for legacy CSVs without Tahun / Periode Evaluasi headers).
 */
export function parseCSVToSatkers(
  csvText: string,
  fallbackMeta?: { year?: string; evaluationPeriod?: string }
): { satkers: SatkerData[]; errors: string[] } {
  const errors: string[] = [];
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { satkers: [], errors: ['File CSV kosong atau tidak memiliki data.'] };
  }

  const parseLine = (line: string): string[] => {
    const res: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    res.push(cur.trim());
    return res;
  };

  const parseVal = (str: string | undefined): number | null => {
    if (!str) return null;
    const clean = str.replace(/"/g, '').replace(',', '.').trim();
    if (clean === '') return null;
    const n = parseFloat(clean);
    return isNaN(n) ? null : n;
  };

  const rawHeaders = parseLine(lines[0]).map((h) => h.replace(/"/g, '').trim().toLowerCase());
  const findCol = (aliases: string[]): number =>
    rawHeaders.findIndex((h) => aliases.includes(h));

  const colNo = findCol(['no', 'nomor']);
  const colYear = findCol(['tahun', 'year', 'tahun evaluasi', 'evaluation year']);
  const colPeriod = findCol(['periode evaluasi', 'periode', 'triwulan', 'evaluation period', 'period']);
  const colUnit = findCol(['unit kerja / satuan kerja', 'unit kerja', 'satuan kerja']);
  const colSatker = findCol(['satker']);
  const colCategory = findCol(['kategori', 'category']);

  const hasDynamicHeaders = colNo !== -1 && (colSatker !== -1 || colUnit !== -1);
  const indicatorCols: Record<string, number> = {};
  for (const meta of INDICATOR_METAS) {
    const idx = findCol([meta.label.toLowerCase(), meta.key.toLowerCase()]);
    if (idx !== -1) indicatorCols[meta.key] = idx;
  }

  const parsedSatkers: SatkerData[] = [];

  for (let idx = 1; idx < lines.length; idx++) {
    const parts = parseLine(lines[idx]);
    const noStr = hasDynamicHeaders ? parts[colNo] : parts[0];
    const noVal = parseInt(noStr, 10);
    const unitRaw = hasDynamicHeaders ? (colUnit !== -1 ? parts[colUnit] : '') : parts[1];
    const satkerRaw = hasDynamicHeaders ? (colSatker !== -1 ? parts[colSatker] : '') : parts[2];

    if (
      isNaN(noVal) ||
      unitRaw?.toLowerCase().includes('rata-rata') ||
      satkerRaw?.toLowerCase().includes('tercapai')
    ) {
      continue;
    }

    const unitKerja = unitRaw || `Satker ${noVal}`;
    const satker = satkerRaw || unitKerja;
    const categoryRaw = hasDynamicHeaders && colCategory !== -1 ? parts[colCategory] : unitKerja;
    const category = normalizeCategoryLabel(categoryRaw);

    const year =
      (colYear !== -1 ? parts[colYear]?.replace(/"/g, '').trim() : '') ||
      fallbackMeta?.year;
    const evaluationPeriod =
      (colPeriod !== -1 ? parts[colPeriod]?.replace(/"/g, '').trim() : '') ||
      fallbackMeta?.evaluationPeriod;

    const getMetricVal = (key: string, legacyPos: number): number | null => {
      const col = indicatorCols[key];
      if (col !== undefined) return parseVal(parts[col]);
      return hasDynamicHeaders ? null : parseVal(parts[legacyPos]);
    };

    const rawRecord: Partial<SatkerData> = {
      no: noVal,
      unitKerja,
      satker,
      category,
      year: year || undefined,
      evaluationPeriod: evaluationPeriod || undefined,
      ski: getMetricVal('ski', 3) ?? 0,
      spip: getMetricVal('spip', 4) ?? 0,
      mri: getMetricVal('mri', 5) ?? 0,
      iepk: getMetricVal('iepk', 6) ?? 0,
      spipt: getMetricVal('spipt', 7) ?? 0,
      wbkRb: getMetricVal('wbkRb', 8) ?? 0,
      sakip: getMetricVal('sakip', 9) ?? 0,
      nka: getMetricVal('nka', 10) ?? 0,
      ikpa: getMetricVal('ikpa', 11) ?? 0,
      ipAsn: getMetricVal('ipAsn', 12) ?? 0,
      arsip: getMetricVal('arsip', 13) ?? 0,
      pekppp: getMetricVal('pekppp', 14),
    };

    parsedSatkers.push(recalculateSatkerScores(rawRecord));
  }

  if (parsedSatkers.length === 0) {
    errors.push('Tidak dapat menemukan baris Satker valid dalam CSV.');
  }

  return { satkers: parsedSatkers, errors };
}
